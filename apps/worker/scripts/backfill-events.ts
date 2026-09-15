import { and, eq, inArray } from 'drizzle-orm';
import {
  applicationEvents,
  applications,
  companies,
  createDb,
  processedMessages,
  type Company,
} from '@apply-manager/db';
import { normalizeCompanyName } from '@apply-manager/shared';
import { BACKFILL, PROCESSED_ONLY } from './backfill-data';

/**
 * 백필 실행기: backfill-data.ts의 큐레이션 데이터를 Supabase에 적재한다.
 * - 회사: 정규화 이름으로 findOrCreate (sync-gmail과 동일 규칙, 자동 생성 회사는 careers_url='')
 * - 지원 건: (회사, 직무) 기준 재사용/생성
 * - 이벤트: processed_messages에 이미 있는 gmailMessageId는 건너뛰어 재실행 멱등성 보장
 * - processed_messages: 이벤트 근거 메일 + PROCESSED_ONLY(검증/인증/노이즈) 기록 → 파이프라인 재처리 방지
 *
 * 실행: pnpm --filter @apply-manager/worker backfill-events
 */
/** 지원 건의 모든 이벤트에서 current_stage를 재계산해 갱신하고 반환 */
async function recomputeCurrentStage(
  db: ReturnType<typeof createDb>['db'],
  applicationId: string,
) {
  const events = await db
    .select({
      stage: applicationEvents.stage,
      occurredAt: applicationEvents.occurredAt,
      createdAt: applicationEvents.createdAt,
      needsReview: applicationEvents.needsReview,
    })
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applicationId));

  const byRecency = [...events].sort((a, b) => {
    const t = b.occurredAt.getTime() - a.occurredAt.getTime();
    return t !== 0 ? t : b.createdAt.getTime() - a.createdAt.getTime();
  });
  const chosen = byRecency.find((e) => !e.needsReview) ?? byRecency[0];
  if (chosen) {
    await db
      .update(applications)
      .set({ currentStage: chosen.stage })
      .where(eq(applications.id, applicationId));
  }
  return chosen?.stage ?? 'applied';
}

async function main(): Promise<void> {
  const { db, client } = createDb();
  try {
    const companyRows = await db.select().from(companies);
    const cache = new Map<string, Company>(
      companyRows.map((row) => [normalizeCompanyName(row.name), row]),
    );

    async function ensureCompany(name: string): Promise<Company> {
      const key = normalizeCompanyName(name);
      const cached = cache.get(key);
      if (cached) return cached;
      const [created] = await db
        .insert(companies)
        .values({ name, careersUrl: '', scrapeStrategy: 'llm', scrapeConfig: { url: '' } })
        .returning();
      if (!created) throw new Error(`failed to create company: ${name}`);
      cache.set(key, created);
      console.log(`  + 회사 생성: ${name}`);
      return created;
    }

    let newApps = 0;
    let newEvents = 0;
    let skippedApps = 0;

    for (const app of BACKFILL) {
      const company = await ensureCompany(app.company);
      const position = app.position ?? '(직무 미상)';

      // 이미 적재한 이벤트는 제외 (멱등) — 판정 기준은 application_events.
      // processed_messages는 기존 파이프라인이 오분류(대부분 false)로 이미 채워둔 상태라 신뢰 불가.
      const msgIds = app.events.map((e) => e.gmailMessageId);
      const existingEventMsgs = new Set(
        (
          await db
            .select({ id: applicationEvents.gmailMessageId })
            .from(applicationEvents)
            .where(inArray(applicationEvents.gmailMessageId, msgIds))
        ).map((r) => r.id),
      );
      const fresh = app.events.filter((e) => !existingEventMsgs.has(e.gmailMessageId));
      if (fresh.length === 0) {
        skippedApps++;
        continue;
      }

      // (회사, 직무) 기준 기존 지원 건 재사용, 없으면 생성
      const existing = await db
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.companyId, company.id), eq(applications.position, position)));
      let applicationId = existing[0]?.id;
      if (!applicationId) {
        const [inserted] = await db
          .insert(applications)
          .values({
            companyId: company.id,
            jobPostingId: null,
            position,
            appliedAt: app.appliedAt,
            currentStage: app.finalStage,
          })
          .returning({ id: applications.id });
        if (!inserted) throw new Error(`failed to create application: ${app.company} / ${position}`);
        applicationId = inserted.id;
        newApps++;
      }

      for (const e of fresh) {
        await db.insert(applicationEvents).values({
          applicationId,
          stage: e.stage,
          occurredAt: new Date(e.occurredAt),
          gmailMessageId: e.gmailMessageId,
          summary: e.summary,
          confidence: e.confidence,
          needsReview: e.needsReview,
        });
        await db
          .insert(processedMessages)
          .values({ gmailMessageId: e.gmailMessageId, isRecruitingRelated: true })
          .onConflictDoUpdate({
            target: processedMessages.gmailMessageId,
            set: { isRecruitingRelated: true },
          });
        newEvents++;
      }

      // current_stage 재계산: 기존 이벤트(파이프라인이 만든 것 포함) + 신규를 합쳐
      // needs_review가 아닌 최신 이벤트를 우선, 없으면 최신 이벤트로. 기존 단계를 후퇴시키지 않는다.
      const finalStage = await recomputeCurrentStage(db, applicationId);
      console.log(`  · ${app.company} / ${position} → ${finalStage} (이벤트 +${fresh.length})`);
    }

    // 이벤트 없이 처리 기록만 남길 메시지 (재처리 방지)
    let processedOnly = 0;
    for (const id of PROCESSED_ONLY) {
      const res = await db
        .insert(processedMessages)
        .values({ gmailMessageId: id, isRecruitingRelated: false })
        .onConflictDoNothing()
        .returning({ id: processedMessages.gmailMessageId });
      if (res.length > 0) processedOnly++;
    }

    console.log(
      `[backfill] 완료: 지원건 +${newApps} (중복 스킵 ${skippedApps}), 이벤트 +${newEvents}, 처리기록 +${processedOnly}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[backfill] fatal:', error);
  process.exit(1);
});
