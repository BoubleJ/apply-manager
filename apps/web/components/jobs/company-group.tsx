import type { Application, Company, JobPosting } from "@apply-manager/db";

import { JobCard } from "@/components/jobs/job-card";
import { PolicyBadges } from "@/components/jobs/policy-badges";
import { Badge } from "@/components/ui/badge";
import type { AppliedInfo } from "@/lib/applied";

export type CompanyWithApplications = Company & { applications: Application[] };

/** 지원 이력이 없는 공고용 기본값 */
const EMPTY_APPLIED_INFO: AppliedInfo = {
  applied: false,
  lastApplied: null,
  reapply: { kind: "unknown" },
};

/** 기업별 그룹 섹션 — 헤더(정책 배지·재지원 힌트·정책 재확인) + 공고 카드 그리드 */
export function CompanyGroup({
  company,
  postings,
  appliedInfoById,
  now,
  today,
}: {
  company: CompanyWithApplications;
  postings: JobPosting[];
  /** 공고 id → 지원 이력/재지원 상태 */
  appliedInfoById: Map<string, AppliedInfo>;
  now: Date;
  today: string;
}) {
  // 탈락한 지원 건이 있고 재지원 정책이 allowed면 힌트 노출 (스펙 7-6)
  const hasRejected = company.applications.some(
    (application) =>
      application.currentStage === "rejected" ||
      application.currentStage === "document_rejected",
  );
  const showReapplyHint = hasRejected && company.reapplyPolicy === "allowed";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{company.name}</h2>
        {company.careersPageUrl ? (
          <a
            href={company.careersPageUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:underline"
          >
            채용페이지 ↗
          </a>
        ) : null}
        <PolicyBadges
          reapplyPolicy={company.reapplyPolicy}
          duplicateApplyPolicy={company.duplicateApplyPolicy}
          policyNote={company.policyNote}
        />
        {showReapplyHint ? (
          <Badge variant="success">탈락 이력 있음 · 재지원 가능</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          공고 {postings.length}건
        </span>
      </div>
      {company.policyNote ? (
        <p className="text-xs text-muted-foreground">{company.policyNote}</p>
      ) : null}
      {postings.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          조건에 맞는 공고가 없습니다.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {postings.map((posting) => (
            <JobCard
              key={posting.id}
              posting={posting}
              companyId={company.id}
              companyName={company.name}
              showCompany={false}
              appliedInfo={appliedInfoById.get(posting.id) ?? EMPTY_APPLIED_INFO}
              now={now}
              today={today}
            />
          ))}
        </div>
      )}
    </section>
  );
}
