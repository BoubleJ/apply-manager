import { assertNever, type Stage } from "@apply-manager/shared";

import type { BadgeVariant } from "@/components/ui/badge";

/**
 * 지원 단계(stage) 표시·집계용 순수 함수 모음.
 * DB 조회 결과에 구조적으로 맞는 최소 타입만 받아 테스트 가능하게 유지한다.
 */

export const STAGE_LABELS: Record<Stage, string> = {
  applied: "지원완료",
  document_passed: "서류합격",
  document_rejected: "서류탈락",
  assignment: "과제 전형",
  interview_1: "1차면접",
  interview_1_passed: "1차합격",
  interview_2: "2차면접",
  final_passed: "최종합격",
  rejected: "탈락",
  offer: "오퍼",
  withdrawn: "지원철회",
};

export function stageBadgeVariant(stage: Stage): BadgeVariant {
  switch (stage) {
    case "applied":
    case "assignment":
    case "interview_1":
    case "interview_2":
      return "secondary";
    case "document_passed":
    case "interview_1_passed":
      return "default";
    case "final_passed":
    case "offer":
      return "success";
    case "document_rejected":
    case "rejected":
      return "destructive";
    case "withdrawn":
      return "outline";
    default:
      return assertNever(stage);
  }
}

/** 아직 결과가 나지 않은(진행 중) 단계 */
export const IN_PROGRESS_STAGES = [
  "applied",
  "document_passed",
  "assignment",
  "interview_1",
  "interview_1_passed",
  "interview_2",
] as const satisfies readonly Stage[];

/** 면접(과제 포함) 전형 진행 중 단계 */
export const INTERVIEWING_STAGES = [
  "assignment",
  "interview_1",
  "interview_1_passed",
  "interview_2",
] as const satisfies readonly Stage[];

// "해당 단계 이상 도달" 판정용 집합 (퍼널·서류합격률 계산)
const DOC_PASSED_OR_BEYOND = [
  "document_passed",
  "assignment",
  "interview_1",
  "interview_1_passed",
  "interview_2",
  "final_passed",
  "offer",
] as const satisfies readonly Stage[];

const INTERVIEW_1_OR_BEYOND = [
  "interview_1",
  "interview_1_passed",
  "interview_2",
  "final_passed",
  "offer",
] as const satisfies readonly Stage[];

const INTERVIEW_2_OR_BEYOND = [
  "interview_2",
  "final_passed",
  "offer",
] as const satisfies readonly Stage[];

const FINAL_STAGES = ["final_passed", "offer"] as const satisfies readonly Stage[];

// --- 대시보드 목록 필터 (스펙 5-1: 전체/진행중/서류탈락/면접중/합격/탈락) ---

export const APPLICATION_FILTERS = [
  { key: "all", label: "전체" },
  { key: "in_progress", label: "진행중" },
  { key: "document_rejected", label: "서류탈락" },
  { key: "interviewing", label: "면접중" },
  { key: "passed", label: "합격" },
  { key: "rejected", label: "탈락" },
] as const;

export type ApplicationFilterKey = (typeof APPLICATION_FILTERS)[number]["key"];

export function parseFilterKey(value: unknown): ApplicationFilterKey {
  const found = APPLICATION_FILTERS.find((f) => f.key === value);
  return found ? found.key : "all";
}

export function stageMatchesFilter(
  stage: Stage,
  key: ApplicationFilterKey,
): boolean {
  switch (key) {
    case "all":
      return true;
    case "in_progress":
      return (IN_PROGRESS_STAGES as readonly Stage[]).includes(stage);
    case "document_rejected":
      return stage === "document_rejected";
    case "interviewing":
      return (INTERVIEWING_STAGES as readonly Stage[]).includes(stage);
    case "passed":
      return (FINAL_STAGES as readonly Stage[]).includes(stage);
    case "rejected":
      return stage === "document_rejected" || stage === "rejected";
    default:
      return assertNever(key);
  }
}

export function filterApplications<T extends { currentStage: Stage }>(
  applications: readonly T[],
  key: ApplicationFilterKey,
): T[] {
  return applications.filter((a) => stageMatchesFilter(a.currentStage, key));
}

/** 대시보드 URL 생성 (필터 + 선택된 지원 건) — searchParams 기반 상태의 단일 소스 */
export function dashboardHref(
  filter: ApplicationFilterKey,
  applicationId?: string,
): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (applicationId) params.set("app", applicationId);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

// --- 요약 카드 · 퍼널 집계 ---

type HasStage = { stage: Stage };
type HasEvents = { events: readonly HasStage[] };

function reached(events: readonly HasStage[], stages: readonly Stage[]): boolean {
  return events.some((e) => stages.includes(e.stage));
}

export type ApplicationSummary = {
  total: number;
  inProgress: number;
  /** 서류 결과가 나온 건 중 합격 비율 (0~1). 결과 없으면 null */
  docPassRate: number | null;
  /** 최종합격 + 오퍼 건수 */
  finalCount: number;
};

export function computeSummary(
  applications: readonly ({ currentStage: Stage } & HasEvents)[],
): ApplicationSummary {
  const total = applications.length;
  const inProgress = applications.filter((a) =>
    stageMatchesFilter(a.currentStage, "in_progress"),
  ).length;
  const docPassed = applications.filter((a) =>
    reached(a.events, DOC_PASSED_OR_BEYOND),
  ).length;
  const docResolved = applications.filter(
    (a) =>
      reached(a.events, DOC_PASSED_OR_BEYOND) ||
      reached(a.events, ["document_rejected"]),
  ).length;
  const finalCount = applications.filter((a) =>
    reached(a.events, FINAL_STAGES),
  ).length;
  return {
    total,
    inProgress,
    docPassRate: docResolved === 0 ? null : docPassed / docResolved,
    finalCount,
  };
}

export type FunnelDatum = { name: string; value: number };

/** 퍼널: 지원 → 서류합격 → 1차면접 → 2차면접 → 최종합격 (각 단계 "도달" 건수) */
export function buildFunnelData(
  applications: readonly HasEvents[],
): FunnelDatum[] {
  const count = (stages: readonly Stage[]) =>
    applications.filter((a) => reached(a.events, stages)).length;
  return [
    { name: "지원", value: applications.length },
    { name: "서류합격", value: count(DOC_PASSED_OR_BEYOND) },
    { name: "1차면접", value: count(INTERVIEW_1_OR_BEYOND) },
    { name: "2차면접", value: count(INTERVIEW_2_OR_BEYOND) },
    { name: "최종합격", value: count(FINAL_STAGES) },
  ];
}

/** 지원 건에 확인 필요(needs_review) 이벤트가 있는지 */
export function hasNeedsReview(
  events: readonly { needsReview: boolean }[],
): boolean {
  return events.some((e) => e.needsReview);
}
