import { eq } from 'drizzle-orm';
import {
  applications,
  companies,
  jobPostings,
  type Company,
  type Db,
} from '@apply-manager/db';
import { normalizeCompanyName, type Stage } from '@apply-manager/shared';

/**
 * matchApplication (스펙 6장): 메일에서 추출한 (회사, 직무, stage)를 지원 건에 매칭한다.
 *
 * 매칭 우선순위:
 * 1. 직무명 정확 일치 (공백 정리 수준만 정규화 — ATS 템플릿 변수라 문자열이 동일)
 * 2. 단일 진행 건 폴백 (직무명 미기재/불일치 시, 진행 중 지원 건이 1개뿐이면 연결)
 * 3. 확정 불가 → 임의로 붙이지 않고 별도 지원 건을 만들어 needs_review로 저장
 *    (application_events.application_id가 NOT NULL이라 이벤트만 따로 저장할 수 없다.
 *     잘못 연결해 히스토리를 섞는 것보다 분리 저장 + 사용자 확인이 안전하다)
 */

/** 진행 중이 아닌 것으로 보는 stage — 단일 진행 건 폴백 후보에서 제외 */
const INACTIVE_STAGES: ReadonlySet<Stage> = new Set([
  'document_rejected',
  'rejected',
  'withdrawn',
]);

const UNKNOWN_POSITION = '(직무 미상)';

/** 직무명 비교용 정규화 — 공백 정리 수준만 (괄호·하이픈은 그대로 비교하는 것이 안전) */
export function normalizePosition(position: string): string {
  return position.replace(/\s+/g, ' ').trim();
}

export interface ApplicationCandidate {
  id: string;
  position: string;
  currentStage: Stage;
}

export type MatchDecision =
  | { kind: 'existing'; applicationId: string }
  | { kind: 'new' } // 지원 접수 메일인데 기존 매칭 없음 → 신규 지원 건 생성
  | { kind: 'review' }; // 확정 불가 → 별도 지원 건 생성 + needs_review

/** 순수 매칭 결정 함수 (Vitest 테스트 대상) */
export function decideMatch(
  candidates: readonly ApplicationCandidate[],
  position: string | null,
  stage: Stage,
): MatchDecision {
  // ① 직무명 정확 일치
  if (position) {
    const target = normalizePosition(position);
    const hit = candidates.find((c) => normalizePosition(c.position) === target);
    if (hit) return { kind: 'existing', applicationId: hit.id };
  }

  // 지원 접수 메일인데 같은 직무의 기존 건이 없으면 신규 지원 건
  if (stage === 'applied') return { kind: 'new' };

  // ② 단일 진행 건 폴백
  const active = candidates.filter((c) => !INACTIVE_STAGES.has(c.currentStage));
  const single = active.length === 1 ? active[0] : undefined;
  if (single) return { kind: 'existing', applicationId: single.id };

  // ③ 확정 불가
  return { kind: 'review' };
}

export type CompanyCache = Map<string, Company>;

/** 회사명 정규화 키 → Company 캐시 (실행당 1회 로드) */
export async function loadCompanyCache(db: Db): Promise<CompanyCache> {
  const rows = await db.select().from(companies);
  return new Map(rows.map((row) => [normalizeCompanyName(row.name), row]));
}

/**
 * 회사명 매칭 (정규화 후 대조). 미등록 회사면 자동 생성.
 * 자동 생성 회사는 careers_url이 ''라서 스크래핑 대상에서 제외된다 (scrape-jobs.ts에서 스킵).
 */
export async function findOrCreateCompany(
  db: Db,
  cache: CompanyCache,
  name: string,
): Promise<Company> {
  const key = normalizeCompanyName(name);
  const cached = cache.get(key);
  if (cached) return cached;

  const [created] = await db
    .insert(companies)
    .values({
      name,
      careersUrl: '',
      scrapeStrategy: 'llm',
      scrapeConfig: { url: '' },
    })
    .returning();
  if (!created) throw new Error(`failed to create company: ${name}`);
  console.log(`[sync-gmail] auto-created company: ${name}`);
  cache.set(key, created);
  return created;
}

export interface MatchResult {
  applicationId: string;
  /** 신규 지원 건을 만들었는가 (applied 신규 or 확정 불가 분리 저장) */
  created: boolean;
  /** 확정 불가로 분리 저장했는가 → 이벤트를 needs_review로 저장해야 함 */
  forceReview: boolean;
}

export async function matchApplication(
  db: Db,
  company: Company,
  args: { position: string | null; stage: Stage; occurredAt: Date },
): Promise<MatchResult> {
  const candidates = await db
    .select({
      id: applications.id,
      position: applications.position,
      currentStage: applications.currentStage,
    })
    .from(applications)
    .where(eq(applications.companyId, company.id));

  const decision = decideMatch(candidates, args.position, args.stage);
  switch (decision.kind) {
    case 'existing':
      return { applicationId: decision.applicationId, created: false, forceReview: false };
    case 'new': {
      // 공고 자동 연결: job_postings.title 정확 일치 (같은 ATS 템플릿 변수)
      const jobPostingId = args.position
        ? await findPostingIdByTitle(db, company.id, args.position)
        : null;
      const id = await createApplication(db, company.id, args, jobPostingId);
      return { applicationId: id, created: true, forceReview: false };
    }
    case 'review': {
      const id = await createApplication(db, company.id, args, null);
      return { applicationId: id, created: true, forceReview: true };
    }
  }
}

async function createApplication(
  db: Db,
  companyId: string,
  args: { position: string | null; stage: Stage; occurredAt: Date },
  jobPostingId: string | null,
): Promise<string> {
  const [created] = await db
    .insert(applications)
    .values({
      companyId,
      jobPostingId,
      position: args.position ?? UNKNOWN_POSITION,
      appliedAt: args.occurredAt.toISOString().slice(0, 10),
      currentStage: args.stage,
    })
    .returning({ id: applications.id });
  if (!created) throw new Error('failed to create application');
  return created.id;
}

async function findPostingIdByTitle(
  db: Db,
  companyId: string,
  position: string,
): Promise<string | null> {
  const rows = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      status: jobPostings.status,
    })
    .from(jobPostings)
    .where(eq(jobPostings.companyId, companyId));
  const target = normalizePosition(position);
  const matches = rows.filter((row) => normalizePosition(row.title) === target);
  return (matches.find((row) => row.status === 'open') ?? matches[0])?.id ?? null;
}
