import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  APPLY_POLICIES,
  CATEGORIES,
  JOB_POSTING_STATUSES,
  SCRAPE_STRATEGIES,
  STAGES,
  type ScrapeConfigData,
} from '@apply-manager/shared';

// enum 값의 단일 소스는 @apply-manager/shared (db → shared 단방향 의존)
export const scrapeStrategyEnum = pgEnum('scrape_strategy', SCRAPE_STRATEGIES);
export const applyPolicyEnum = pgEnum('apply_policy', APPLY_POLICIES);
export const stageEnum = pgEnum('stage', STAGES);
export const jobCategoryEnum = pgEnum('job_category', CATEGORIES);
export const jobPostingStatusEnum = pgEnum('job_posting_status', JOB_POSTING_STATUSES);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /**
   * 스크랩 대상 URL 겸 크론 트리거. ''이면 scrape-jobs 크론이 이 회사를 건너뛴다
   * (전용 어댑터가 없는 회사). 사람이 보는 링크는 careersPageUrl을 우선 사용한다.
   */
  careersUrl: text('careers_url').notNull(),
  /**
   * 사람이 보는 채용페이지 링크(표시 전용). 크론과 무관하므로 careersUrl=''로
   * 크론에서 제외된 회사도 여기에 실제 채용페이지를 넣어 UI에 링크를 띄울 수 있다.
   * 없으면 careersUrl로 폴백.
   */
  careersPageUrl: text('careers_page_url'),
  scrapeStrategy: scrapeStrategyEnum('scrape_strategy').notNull(),
  /** 전략별 설정 — 읽을 때 shared의 parseScrapeConfig(strategy, config)로 검증 */
  scrapeConfig: jsonb('scrape_config').$type<ScrapeConfigData>().notNull(),
  reapplyPolicy: applyPolicyEnum('reapply_policy').notNull().default('unknown'),
  duplicateApplyPolicy: applyPolicyEnum('duplicate_apply_policy')
    .notNull()
    .default('unknown'),
  /** 채용페이지 원문 근거 문구 — 회사 그룹 헤더에 그대로 노출된다 */
  policyNote: text('policy_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobPostings = pgTable('job_postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** 개발 직군 분류 — 비개발 공고는 수집 단계에서 제외되므로 이 테이블에 없다 */
  category: jobCategoryEnum('category').notNull(),
  url: text('url').notNull(),
  description: text('description'),
  /** 마감일 (상시채용이면 null) */
  deadline: date('deadline', { mode: 'string' }),
  /** company_id + title + url 기반 중복 수집 방지 해시 (shared의 contentHash) */
  contentHash: text('content_hash').notNull().unique(),
  status: jobPostingStatusEnum('status').notNull().default('open'),
  /** 사용자가 보관한 공고 상세 내용 스냅샷 (스펙 5장) — null이면 미보관 */
  archivedContent: text('archived_content'),
  /** 보관 시각 — null이면 미보관 */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** 스크래핑 시마다 갱신, 미발견 시 closed 처리 근거 */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** 공고와 매칭되면 연결 */
  jobPostingId: uuid('job_posting_id').references(() => jobPostings.id, {
    onDelete: 'set null',
  }),
  position: text('position').notNull(),
  appliedAt: date('applied_at', { mode: 'string' }).notNull(),
  /** 이벤트 집계로 파생되는 캐시 값 */
  currentStage: stageEnum('current_stage').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applicationEvents = pgTable('application_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  stage: stageEnum('stage').notNull(),
  /** 메일 수신 시각 기준 */
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  /** 근거 메일 ID (역추적용) */
  gmailMessageId: text('gmail_message_id'),
  /** LLM이 추출한 한 줄 요약 */
  summary: text('summary'),
  /** LLM 분류 신뢰도 */
  confidence: real('confidence'),
  /** 낮은 confidence 또는 비정상 상태 전이 감지 시 true */
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 단일 행(id = 1) 테이블 — Gmail 증분 동기화 커서 */
export const gmailSyncState = pgTable('gmail_sync_state', {
  id: integer('id').primaryKey(),
  historyId: text('history_id').notNull(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
});

export const processedMessages = pgTable('processed_messages', {
  /** 중복 처리 방지 */
  gmailMessageId: text('gmail_message_id').primaryKey(),
  /** 채용 무관 메일도 기록해 재처리 방지 */
  isRecruitingRelated: boolean('is_recruiting_related').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- relations (db.query 관계형 API용) ---

export const companiesRelations = relations(companies, ({ many }) => ({
  jobPostings: many(jobPostings),
  applications: many(applications),
}));

export const jobPostingsRelations = relations(jobPostings, ({ one, many }) => ({
  company: one(companies, {
    fields: [jobPostings.companyId],
    references: [companies.id],
  }),
  applications: many(applications),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  company: one(companies, {
    fields: [applications.companyId],
    references: [companies.id],
  }),
  jobPosting: one(jobPostings, {
    fields: [applications.jobPostingId],
    references: [jobPostings.id],
  }),
  events: many(applicationEvents),
}));

export const applicationEventsRelations = relations(applicationEvents, ({ one }) => ({
  application: one(applications, {
    fields: [applicationEvents.applicationId],
    references: [applications.id],
  }),
}));
