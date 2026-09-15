import { and, eq, notInArray } from 'drizzle-orm';
import { runAdapter, type ScrapeResult } from '@apply-manager/scraper';
import { loadLlmEnv, parseScrapeConfig } from '@apply-manager/shared';
import { contentHash } from '@apply-manager/shared/content-hash';
import { companies, createDb, jobPostings, type Company, type Db } from '@apply-manager/db';
import {
  EXCLUDED_CATEGORIES,
  classifyByKeywords,
  classifyCategory,
  isQuotaExhausted,
  type CategoryLlmOptions,
} from './classify-category';

/**
 * 공고 스크래핑 오케스트레이터 (스펙 7-4).
 * 1. companies 순회, scrape_strategy로 registry에서 어댑터 실행
 * 2. 신규 공고(content_hash 기준)만 직군 분류(7-7), 비개발·수집제외 직군(EXCLUDED_CATEGORIES)은
 *    저장하지 않고 제목을 로그에 남김
 * 3. content_hash 기준 upsert, 기존 공고는 last_seen_at 갱신
 * 4. 이번 실행에서 발견되지 않은 기존 open 공고는 closed 처리
 * 5. 회사 단위 실패 격리 (동시 실행 수 COMPANY_CONCURRENCY로 제한), 실패 요약 출력
 *
 * LLM rate limit 서킷브레이커: 분류가 "한도 소진"(LlmRateLimitError.exhausted) 429로 실패하면
 * 이번 실행의 남은 LLM 분류를 전부 건너뛴다 (회사 간 공유). 한도 소진 상태에서 공고마다
 * 재시도·대기를 반복하다 잡 타임아웃으로 통째로 취소되는 것을 막는다.
 * 일시적 스로틀 429는 브레이커를 내리지 않는다 — 해당 공고만 이번 실행에서 건너뛴다.
 * 건너뛴 공고는 저장되지 않았으므로 다음 실행에서 신규로 재시도된다.
 */

interface RateLimitBreaker {
  tripped: boolean;
}

interface CompanyReport {
  company: string;
  found: number;
  added: number;
  updated: number;
  closed: number;
  /** 비개발 판정으로 버린 공고 제목들 — 오분류 누락 감지의 유일한 수단 (스펙 7-7) */
  discarded: string[];
  /** 분류 실패로 이번 실행에서 건너뛴 공고 수 (다음 실행에서 재시도됨) */
  classifyFailed: number;
}

async function scrapeCompany(
  db: Db,
  llm: CategoryLlmOptions,
  company: Company,
  breaker: RateLimitBreaker,
): Promise<CompanyReport> {
  const config = parseScrapeConfig(company.scrapeStrategy, company.scrapeConfig);
  const results = await runAdapter(config);
  const now = new Date();

  // 같은 실행 내 중복(동일 title+url) 제거
  const byHash = new Map<string, ScrapeResult>();
  for (const result of results) {
    byHash.set(contentHash(company.id, result.title, result.url), result);
  }

  const existingRows = await db
    .select({ contentHash: jobPostings.contentHash })
    .from(jobPostings)
    .where(eq(jobPostings.companyId, company.id));
  const existingHashes = new Set(existingRows.map((row) => row.contentHash));

  const report: CompanyReport = {
    company: company.name,
    found: byHash.size,
    added: 0,
    updated: 0,
    closed: 0,
    discarded: [],
    classifyFailed: 0,
  };

  for (const [hash, result] of byHash) {
    if (existingHashes.has(hash)) {
      // 기존 공고: last_seen_at 갱신 (+재발견 시 open 복귀, 마감일 변동 반영)
      await db
        .update(jobPostings)
        .set({
          lastSeenAt: now,
          status: 'open',
          deadline: result.deadline ?? null,
          ...(result.description !== undefined && { description: result.description }),
        })
        .where(eq(jobPostings.contentHash, hash));
      report.updated++;
      continue;
    }

    // 신규 공고만 직군 분류 (스펙 7-7). 키워드 분류는 LLM을 쓰지 않으므로 브레이커와 무관.
    let category;
    if (breaker.tripped) {
      category = classifyByKeywords(result.title);
      if (!category) {
        report.classifyFailed++;
        continue;
      }
    } else {
      try {
        category = await classifyCategory(result.title, result.description, llm);
      } catch (error) {
        // 분류 실패 시 이번 실행은 건너뛴다 — 저장하지 않았으므로 다음 실행에서 신규로 재시도
        report.classifyFailed++;
        if (isQuotaExhausted(error) && !breaker.tripped) {
          breaker.tripped = true;
          console.error(
            `[scrape-jobs] LLM quota exhausted — skipping LLM classification for the rest of this run (keyword-only)`,
          );
        }
        console.error(
          `[scrape-jobs] ${company.name} :: category classification failed for "${result.title}":`,
          error,
        );
        continue;
      }
    }
    if (category === 'non_dev' || EXCLUDED_CATEGORIES.has(category)) {
      report.discarded.push(`${result.title} [${category}]`);
      continue;
    }

    await db
      .insert(jobPostings)
      .values({
        companyId: company.id,
        title: result.title,
        category,
        url: result.url,
        description: result.description ?? null,
        deadline: result.deadline ?? null,
        contentHash: hash,
        status: 'open',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoNothing();
    report.added++;
  }

  // 이번 실행에서 발견되지 않은 기존 open 공고 → closed
  const seenHashes = [...byHash.keys()];
  const closeConditions = [
    eq(jobPostings.companyId, company.id),
    eq(jobPostings.status, 'open'),
    ...(seenHashes.length > 0 ? [notInArray(jobPostings.contentHash, seenHashes)] : []),
  ];
  const closedRows = await db
    .update(jobPostings)
    .set({ status: 'closed' })
    .where(and(...closeConditions))
    .returning({ id: jobPostings.id });
  report.closed = closedRows.length;

  return report;
}

/**
 * 회사 동시 실행 수. 무제한으로 돌리면 모든 회사가 같은 LLM 분당 토큰 한도를 두고 경합해
 * 백오프 재시도가 소진되고, 몇 초면 풀릴 스로틀이 분류 실패로 굳는다.
 */
const COMPANY_CONCURRENCY = 4;

/** Promise.allSettled와 동일한 순서·형태의 결과를 반환하되 동시 실행 수를 제한한다. */
async function allSettledLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      const item = items[index] as T;
      try {
        results[index] = { status: 'fulfilled', value: await task(item) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

async function main(): Promise<void> {
  const llmEnv = loadLlmEnv();
  const llm: CategoryLlmOptions = {
    model: llmEnv.modelFilter,
    baseUrl: llmEnv.baseUrl,
    apiKey: llmEnv.apiKey,
  };
  const { db, client } = createDb();
  try {
    const allCompanies = await db.select().from(companies);
    // 메일 파이프라인이 자동 생성한 회사(careers_url '')는 스크래핑 설정이 없으므로 제외
    const targets = allCompanies.filter((company) => company.careersUrl !== '');
    const skipped = allCompanies.length - targets.length;
    if (skipped > 0) {
      console.log(`[scrape-jobs] skipped ${skipped} auto-created companies without scrape config`);
    }

    const breaker: RateLimitBreaker = { tripped: false };
    const settled = await allSettledLimited(targets, COMPANY_CONCURRENCY, (company) =>
      scrapeCompany(db, llm, company, breaker),
    );

    const failures: { company: string; reason: unknown }[] = [];
    for (const [index, outcome] of settled.entries()) {
      const company = targets[index];
      if (!company) continue;
      if (outcome.status === 'rejected') {
        failures.push({ company: company.name, reason: outcome.reason });
        continue;
      }
      const r = outcome.value;
      console.log(
        `[scrape-jobs] ${r.company}: found=${r.found} added=${r.added} updated=${r.updated} closed=${r.closed} discarded=${r.discarded.length} classifyFailed=${r.classifyFailed}`,
      );
      for (const title of r.discarded) {
        console.log(`[scrape-jobs]   discarded: ${r.company} :: ${title}`);
      }
    }

    if (failures.length > 0) {
      console.error(`[scrape-jobs] ${failures.length}/${targets.length} companies failed:`);
      for (const failure of failures) {
        console.error(`[scrape-jobs]   ${failure.company}:`, failure.reason);
      }
      process.exitCode = 1;
    }
    console.log(
      `[scrape-jobs] done: ${targets.length - failures.length}/${targets.length} companies succeeded`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[scrape-jobs] fatal:', error);
  process.exit(1);
});
