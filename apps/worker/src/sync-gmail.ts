import { eq, inArray } from 'drizzle-orm';
import type { gmail_v1 } from 'googleapis';
import {
  applicationEvents,
  createDb,
  gmailSyncState,
  processedMessages,
  type Db,
} from '@apply-manager/db';
import { loadLlmEnv, type LlmEnv, type Stage } from '@apply-manager/shared';
import { createGmailClient, loadGmailEnv } from './gmail/client';
import { fetchMessageIds } from './gmail/fetch-messages';
import { parseMailContent, type ParsedMail } from './gmail/parse-mail';
import { classifyMail, CONFIDENCE_THRESHOLD, type MailExtraction } from './gmail/classify';
import {
  findOrCreateCompany,
  loadCompanyCache,
  matchApplication,
  type CompanyCache,
} from './gmail/match-application';
import { validateTransition } from './gmail/validate-transition';
import { persistEvent } from './gmail/persist';

/**
 * 메일 수집 워커 (스펙 6장).
 * fetchMessages → parseMailContent → classifyMail → matchApplication
 * → validateTransition → persistEvent, 처리 결과와 무관하게 processed_messages 기록,
 * 마지막에 history_id 갱신.
 */

/** 최초 실행(history_id 없음/만료) 시 검색할 기간 */
const INITIAL_SYNC_DAYS = Number(process.env.GMAIL_INITIAL_SYNC_DAYS ?? '14');

const SYNC_STATE_ID = 1; // gmail_sync_state 단일 행 관례

interface SyncStats {
  relevant: number;
  skipped: number;
  failed: number;
  review: number;
}

interface SyncContext {
  db: Db;
  gmail: gmail_v1.Gmail;
  llmEnv: LlmEnv;
  companyCache: CompanyCache;
  stats: SyncStats;
}

async function main(): Promise<void> {
  const llmEnv = loadLlmEnv();
  const gmail = createGmailClient(loadGmailEnv());
  const { db, client } = createDb();
  try {
    const [state] = await db
      .select()
      .from(gmailSyncState)
      .where(eq(gmailSyncState.id, SYNC_STATE_ID));

    const { messageIds, latestHistoryId } = await fetchMessageIds(
      gmail,
      state?.historyId ?? null,
      INITIAL_SYNC_DAYS,
    );
    const pending = await filterUnprocessed(db, messageIds);
    console.log(
      `[sync-gmail] fetched=${messageIds.length} pending=${pending.length} (cursor=${state?.historyId ?? 'none'})`,
    );

    const ctx: SyncContext = {
      db,
      gmail,
      llmEnv,
      companyCache: await loadCompanyCache(db),
      stats: { relevant: 0, skipped: 0, failed: 0, review: 0 },
    };
    // LLM rate limit을 고려해 순차 처리
    for (const messageId of pending) {
      await processMessage(ctx, messageId);
    }

    await db
      .insert(gmailSyncState)
      .values({
        id: SYNC_STATE_ID,
        historyId: latestHistoryId,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: gmailSyncState.id,
        set: { historyId: latestHistoryId, lastSyncedAt: new Date() },
      });

    const { relevant, skipped, failed, review } = ctx.stats;
    console.log(
      `[sync-gmail] done: relevant=${relevant} (needsReview=${review}) skipped=${skipped} failed=${failed} newCursor=${latestHistoryId}`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

/** processed_messages에 이미 있는 메시지 제외 */
async function filterUnprocessed(db: Db, messageIds: string[]): Promise<string[]> {
  const processed = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const chunk = messageIds.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const rows = await db
      .select({ id: processedMessages.gmailMessageId })
      .from(processedMessages)
      .where(inArray(processedMessages.gmailMessageId, chunk));
    for (const row of rows) processed.add(row.id);
  }
  return messageIds.filter((id) => !processed.has(id));
}

async function processMessage(ctx: SyncContext, messageId: string): Promise<void> {
  let isRecruitingRelated = false;
  try {
    const res = await ctx.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    const mail = parseMailContent(res.data);
    const classification = await classifyMail(mail, ctx.llmEnv);
    if (classification.isRecruitingRelated) {
      isRecruitingRelated = true;
      ctx.stats.relevant++;
      await handleRecruitingMail(ctx, mail, classification.extraction);
    } else {
      ctx.stats.skipped++;
    }
  } catch (error) {
    // LLM 파싱 실패(재시도 소진)·API 오류 등 → 스킵 + 로그 (스펙 6장)
    ctx.stats.failed++;
    console.error(`[sync-gmail] failed to process message ${messageId}:`, error);
  }
  // 처리 결과와 무관하게 기록해 재처리를 막는다 (스펙 6장)
  await ctx.db
    .insert(processedMessages)
    .values({ gmailMessageId: messageId, isRecruitingRelated })
    .onConflictDoNothing();
}

async function handleRecruitingMail(
  ctx: SyncContext,
  mail: ParsedMail,
  extraction: MailExtraction,
): Promise<void> {
  const company = await findOrCreateCompany(ctx.db, ctx.companyCache, extraction.company);
  const match = await matchApplication(ctx.db, company, {
    position: extraction.position,
    stage: extraction.stage,
    occurredAt: mail.receivedAt,
  });

  const existingStages = match.created
    ? []
    : await loadExistingStages(ctx.db, match.applicationId);
  const transition = validateTransition(existingStages, extraction.stage);

  const lowConfidence = extraction.confidence < CONFIDENCE_THRESHOLD;
  const needsReview = lowConfidence || match.forceReview || transition.needsReview;

  await persistEvent(ctx.db, {
    applicationId: match.applicationId,
    stage: extraction.stage,
    occurredAt: mail.receivedAt,
    gmailMessageId: mail.gmailMessageId,
    summary: extraction.summary || null,
    confidence: extraction.confidence,
    needsReview,
  });

  if (needsReview) ctx.stats.review++;
  const reviewNote = needsReview
    ? ` [needs_review: ${[
        ...(lowConfidence ? [`confidence=${extraction.confidence}`] : []),
        ...(match.forceReview ? ['unmatched application'] : []),
        ...transition.reasons,
      ].join('; ')}]`
    : '';
  console.log(
    `[sync-gmail] ${extraction.company} / ${extraction.position ?? '-'} → ${extraction.stage}${match.created ? ' (new application)' : ''}${reviewNote}`,
  );
}

async function loadExistingStages(db: Db, applicationId: string): Promise<Stage[]> {
  const rows = await db
    .select({ stage: applicationEvents.stage })
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applicationId));
  return rows.map((row) => row.stage);
}

main().catch((error) => {
  console.error('[sync-gmail] fatal:', error);
  process.exit(1);
});
