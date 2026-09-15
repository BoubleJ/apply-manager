import type { ApplyPolicy } from "@apply-manager/shared";

import { daysUntil, reapplyPeriodMonths } from "./jobs";

/**
 * 공고 ↔ 지원이력 매칭 및 재지원 D-day 계산용 순수 함수 모음 (스펙 3장).
 * UI와 결합하지 않도록 DB 행 전체가 아니라 구조적으로 필요한 필드만 받는다.
 */

/** 매칭에 필요한 공고 최소 형태 */
export type MatchablePosting = {
  id: string;
  companyId: string;
  title: string;
};

/** 매칭에 필요한 지원이력 최소 형태 */
export type MatchableApplication = {
  companyId: string;
  jobPostingId: string | null;
  position: string;
  /** 'YYYY-MM-DD' */
  appliedAt: string;
};

/** 직무명 비교용 정규화 — 대소문자·공백·괄호·구분기호 제거 */
function normalizePosition(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[\s·,./|_-]+/g, "");
}

/** 두 직무명이 같은 직무를 가리키는지 (정규화 후 동일 또는 한쪽이 다른 쪽을 포함) */
function positionsMatch(a: string, b: string): boolean {
  const na = normalizePosition(a);
  const nb = normalizePosition(b);
  if (na.length === 0 || nb.length === 0) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * 공고에 매칭되는 지원이력을 고른다.
 * 우선순위: 공고 직접 연결(jobPostingId) → 같은 회사 + 직무명 매칭.
 */
export function matchApplicationsToPosting<T extends MatchableApplication>(
  posting: MatchablePosting,
  applications: readonly T[],
): T[] {
  return applications.filter((application) => {
    if (application.jobPostingId === posting.id) return true;
    return (
      application.companyId === posting.companyId &&
      positionsMatch(application.position, posting.title)
    );
  });
}

/** 공고에 지원한 이력이 있는지 */
export function hasApplied(
  posting: MatchablePosting,
  applications: readonly MatchableApplication[],
): boolean {
  return matchApplicationsToPosting(posting, applications).length > 0;
}

/** 공고에 매칭되는 지원 중 가장 최근 지원일 (없으면 null) */
export function lastAppliedAt(
  posting: MatchablePosting,
  applications: readonly MatchableApplication[],
): string | null {
  const matched = matchApplicationsToPosting(posting, applications);
  if (matched.length === 0) return null;
  return matched.reduce(
    (latest, a) => (a.appliedAt > latest ? a.appliedAt : latest),
    matched[0]!.appliedAt,
  );
}

/** 'YYYY-MM-DD'에 개월 수를 더한 날짜 문자열 (월말 오버플로는 말일로 보정) */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const base = new Date(y, m - 1, d);
  const targetMonth = base.getMonth() + months;
  const target = new Date(base.getFullYear(), targetMonth, 1);
  // 원래 일(day)로 되돌리되, 대상 월 말일을 넘지 않게 clamp
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  const yy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// --- 재지원 D-day ---

export type ReapplyStatus =
  /** 지금 재지원 가능 */
  | { kind: "available" }
  /** 재지원까지 대기 (days > 0), availableOn = 재지원 가능일 */
  | { kind: "waiting"; days: number; availableOn: string }
  /** 재지원 불가 정책 */
  | { kind: "not_allowed" }
  /** 정책 미상 또는 조건부이나 대기 기간을 알 수 없음 */
  | { kind: "unknown" };

/**
 * 재지원 상태 계산: `마지막 지원일 + 회사 재지원가능기간 - 오늘` (스펙 3장).
 * 기간은 회사 정책(reapplyPolicy) + policyNote의 개월 수에서 파생한다.
 */
export function computeReapplyStatus(
  policy: ApplyPolicy,
  policyNote: string | null | undefined,
  lastApplied: string | null,
  now: Date = new Date(),
): ReapplyStatus {
  if (policy === "not_allowed") return { kind: "not_allowed" };
  if (policy === "allowed") return { kind: "available" };
  if (policy === "unknown" || lastApplied === null) return { kind: "unknown" };

  // conditional: policyNote의 대기 개월 수가 있어야 D-day 계산 가능
  const months = reapplyPeriodMonths(policyNote);
  if (months === null) return { kind: "unknown" };

  const availableOn = addMonths(lastApplied, months);
  const days = daysUntil(availableOn, now);
  return days > 0 ? { kind: "waiting", days, availableOn } : { kind: "available" };
}

/** 재지원 배지 문구 — unknown이면 배지를 숨기도록 null 반환 */
export function formatReapplyStatus(status: ReapplyStatus): string | null {
  switch (status.kind) {
    case "available":
      return "재지원 가능";
    case "waiting":
      return `재지원까지 D-${status.days}`;
    case "not_allowed":
      return "재지원 불가";
    case "unknown":
      return null;
  }
}

// --- 공고 카드용 지원 이력 요약 ---

export type AppliedInfo = {
  /** 이 공고에 지원한 이력이 있는지 */
  applied: boolean;
  /** 마지막 지원일 (YYYY-MM-DD) — 없으면 null */
  lastApplied: string | null;
  /** 재지원 상태 (applied일 때만 의미) */
  reapply: ReapplyStatus;
};

/** 공고 하나에 대한 지원여부 + 재지원 상태를 계산 (스펙 3장) */
export function computePostingAppliedInfo(
  posting: MatchablePosting,
  company: { reapplyPolicy: ApplyPolicy; policyNote: string | null },
  applications: readonly MatchableApplication[],
  now: Date = new Date(),
): AppliedInfo {
  const last = lastAppliedAt(posting, applications);
  return {
    applied: last !== null,
    lastApplied: last,
    reapply: computeReapplyStatus(company.reapplyPolicy, company.policyNote, last, now),
  };
}
