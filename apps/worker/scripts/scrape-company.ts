import { readFileSync } from 'node:fs';
import { and, eq, notInArray } from 'drizzle-orm';
import { companies, createDb, jobPostings, type Company } from '@apply-manager/db';
import {
  categorySchema,
  normalizeCompanyName,
  parseScrapeConfig,
  scrapeStrategySchema,
} from '@apply-manager/shared';
import { contentHash } from '@apply-manager/shared/content-hash';
import { z } from 'zod';

/**
 * 수동 공고 적재 (Claude가 직접 스크랩·분류한 결과를 DB에 저장).
 * 프로젝트의 scrape-jobs 적재 로직을 그대로 따르되 LLM 분류만 제외 — category는 입력으로 받는다.
 *
 * 입력 JSON:
 * {
 *   "company": "회사명",
 *   "careersUrl": "https://.../careers",  // ''로 두면 scrape-jobs 크론이 이 회사를 건너뛴다 (전용 어댑터가 없는 회사).
 *   "strategy": "ninehire",            // 생략 시 'llm'. 전용 어댑터가 있으면 반드시 지정할 것 —
 *                                      // 'llm'으로 등록하면 크론이 CSR 목록 페이지에서 0건을 얻고,
 *                                      // 미발견 open 공고를 무조건 closed 처리해 여기서 넣은 공고가 전부 닫힌다.
 *   "scrapeConfig": { "url": "..." },  // 생략 시 { url: careersUrl }
 *   "closeAbsent": false,              // true면 이번 목록에 없는 해당 회사 open 공고를 closed 처리
 *   "postings": [
 *     { "title": "...", "url": "https://...", "description": "...", "deadline": "2026-08-01", "category": "frontend" }
 *   ]
 * }
 *
 * 실행: pnpm --filter @apply-manager/worker scrape-company <input.json>
 */
const inputSchema = z.object({
  company: z.string().trim().min(1),
  careersUrl: z.union([z.literal(''), z.string().url()]),
  /**
   * 사람이 보는 채용페이지 링크(표시 전용) — 항상 실제 채용페이지 URL.
   * careersUrl(스크랩 대상, ''로 크론 스킵 가능)과 독립적으로 다룬다.
   */
  careersPageUrl: z.string().url(),
  strategy: scrapeStrategySchema.default('llm'),
  scrapeConfig: z.record(z.string(), z.unknown()).optional(),
  closeAbsent: z.boolean().default(false),
  postings: z
    .array(
      z.object({
        /**
         * trim하지 않는다 — contentHash(companyId, title, url)가 어댑터 출력과 글자 단위로 같아야 한다.
         * 어댑터는 제목을 원문 그대로 넘기므로(공백 포함), 여기서 trim하면 해시가 어긋나
         * 다음 scrape-jobs 크론이 이 공고를 "미발견"으로 보고 closed 처리한다.
         */
        title: z.string().min(1),
        url: z.string().url(),
        description: z.string().nullish(),
        deadline: z.iso.date().nullish(),
        category: categorySchema,
      }),
    )
    .min(1),
});

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error('usage: tsx scripts/scrape-company.ts <input.json>');
  const input = inputSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

  const scrapeConfig = input.scrapeConfig ?? { url: input.careersUrl };
  // 표시용 링크(careersPageUrl)와 스크랩 대상(careersUrl)은 독립 — 서로 폴백하지 않는다.
  const careersPageUrl = input.careersPageUrl;
  // careersUrl이 ''인 회사는 크론이 건너뛰므로 config가 파싱되지 않는다 — 검증도 건너뛴다.
  // 크론이 실제로 스크랩할 회사만, 잘못된 전략/설정이 다음 크론에서 터지지 않도록 여기서 미리 검증한다.
  if (input.careersUrl !== '') parseScrapeConfig(input.strategy, scrapeConfig);

  const { db, client } = createDb();
  try {
    // 회사 findOrCreate (정규화 이름 기준) + careersUrl·전략 갱신
    const key = normalizeCompanyName(input.company);
    const existing = (await db.select().from(companies)).find(
      (c) => normalizeCompanyName(c.name) === key,
    );
    let company: Company;
    if (existing) {
      company = existing;
      if (
        existing.careersUrl !== input.careersUrl ||
        existing.scrapeStrategy !== input.strategy ||
        existing.careersPageUrl !== careersPageUrl ||
        JSON.stringify(existing.scrapeConfig) !== JSON.stringify(scrapeConfig)
      ) {
        await db
          .update(companies)
          .set({
            careersUrl: input.careersUrl,
            careersPageUrl,
            scrapeStrategy: input.strategy,
            scrapeConfig,
          })
          .where(eq(companies.id, existing.id));
        console.log(`  회사 설정 갱신: ${input.company} (${input.strategy})`);
      }
    } else {
      const [created] = await db
        .insert(companies)
        .values({
          name: input.company,
          careersUrl: input.careersUrl,
          careersPageUrl,
          scrapeStrategy: input.strategy,
          scrapeConfig,
        })
        .returning();
      if (!created) throw new Error(`failed to create company: ${input.company}`);
      company = created;
      console.log(`+ 회사 생성: ${input.company}`);
    }

    const now = new Date();
    const existingHashes = new Set(
      (
        await db
          .select({ h: jobPostings.contentHash })
          .from(jobPostings)
          .where(eq(jobPostings.companyId, company.id))
      ).map((r) => r.h),
    );

    const seen = new Set<string>();
    let added = 0;
    let updated = 0;
    for (const p of input.postings) {
      const hash = contentHash(company.id, p.title, p.url);
      if (seen.has(hash)) continue; // 같은 실행 내 중복 제거
      seen.add(hash);

      if (existingHashes.has(hash)) {
        await db
          .update(jobPostings)
          .set({
            lastSeenAt: now,
            status: 'open',
            deadline: p.deadline ?? null,
            ...(p.description !== undefined && { description: p.description ?? null }),
          })
          .where(eq(jobPostings.contentHash, hash));
        updated++;
      } else {
        await db
          .insert(jobPostings)
          .values({
            companyId: company.id,
            title: p.title,
            category: p.category,
            url: p.url,
            description: p.description ?? null,
            deadline: p.deadline ?? null,
            contentHash: hash,
            status: 'open',
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onConflictDoNothing();
        added++;
      }
    }

    // 이번 목록에 없는 기존 open 공고 → closed (명시적으로 요청한 경우만)
    let closed = 0;
    if (input.closeAbsent && seen.size > 0) {
      const rows = await db
        .update(jobPostings)
        .set({ status: 'closed' })
        .where(
          and(
            eq(jobPostings.companyId, company.id),
            eq(jobPostings.status, 'open'),
            notInArray(jobPostings.contentHash, [...seen]),
          ),
        )
        .returning({ id: jobPostings.id });
      closed = rows.length;
    }

    console.log(
      `[scrape-company] ${input.company}: added=${added} updated=${updated} closed=${closed} (입력 ${input.postings.length}건)`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[scrape-company] fatal:', error);
  process.exit(1);
});
