import { asc, desc } from "drizzle-orm";
import { companies, jobPostings, type JobPosting } from "@job-tracker/db";

import { CompanyGroup } from "@/components/jobs/company-group";
import { JobCard } from "@/components/jobs/job-card";
import { JobsFilter } from "@/components/jobs/jobs-filter";
import {
  computePostingAppliedInfo,
  type AppliedInfo,
  type MatchableApplication,
} from "@/lib/applied";
import { getDb } from "@/lib/db";
import { todayIsoDate } from "@/lib/format";
import { filterJobPostings, parseJobsSearchParams } from "@/lib/jobs";

// DB를 요청 시점에 조회한다 (DATABASE_URL 없이도 빌드 가능)
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filterState = parseJobsSearchParams(sp);
  const now = new Date();
  const today = todayIsoDate(now);

  const db = getDb();
  const [companyRows, postingRows] = await Promise.all([
    db.query.companies.findMany({
      with: { applications: true },
      orderBy: [asc(companies.name)],
    }),
    db.query.jobPostings.findMany({
      orderBy: [desc(jobPostings.firstSeenAt)],
    }),
  ]);

  const companiesById = new Map(companyRows.map((c) => [c.id, c]));

  // 공고별 지원 이력/재지원 상태 (스펙 3장) — 전체 지원건과 매칭해 계산
  const allApplications: MatchableApplication[] = companyRows.flatMap((c) =>
    c.applications.map((a) => ({
      companyId: a.companyId,
      jobPostingId: a.jobPostingId,
      position: a.position,
      appliedAt: a.appliedAt,
    })),
  );
  const appliedInfoById = new Map<string, AppliedInfo>(
    postingRows.map((p) => {
      const company = companiesById.get(p.companyId);
      const info = computePostingAppliedInfo(
        p,
        {
          reapplyPolicy: company?.reapplyPolicy ?? "unknown",
          policyNote: company?.policyNote ?? null,
        },
        allApplications,
        now,
      );
      return [p.id, info];
    }),
  );

  // 미지원 필터(스펙 4장)용 판별 — appliedInfo 재사용
  const filtered = filterJobPostings(
    postingRows,
    filterState,
    (p) => appliedInfoById.get(p.id)?.applied ?? false,
  );
  const postingsByCompany = new Map<string, JobPosting[]>();
  for (const posting of filtered) {
    const list = postingsByCompany.get(posting.companyId);
    if (list) {
      list.push(posting);
    } else {
      postingsByCompany.set(posting.companyId, [posting]);
    }
  }

  /**
   * 채용공고 목록에 띄울 회사: 내가 채용페이지 URL을 주고 등록한 회사만.
   * careersPageUrl이 없는 회사는 Gmail 동기화가 지원 메일만 보고 자동 생성한 회사라
   * (채용페이지·설정 등 정보가 전혀 없음) 여기 노출해봐야 의미가 없어 제외한다.
   * 지원 이력 자체는 채용현황에 그대로 남는다.
   */
  const registeredCompanies = companyRows.filter(
    (company) => company.careersPageUrl !== null,
  );
  // 등록된 회사는 공고 조건 필터와 무관하게 전부 노출한다.
  // 매칭 공고가 0건이어도 헤더(채용페이지 링크·정책 배지)는 그 자체로 볼 값어치가 있어
  // 회사가 통째로 사라지지 않게 한다 — 공고 자리에는 CompanyGroup이 빈 안내를 띄운다.
  const groupedCompanies = registeredCompanies.filter(
    (company) =>
      filterState.companyId === "all" || company.id === filterState.companyId,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">채용공고</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered.length}건 표시 · 전체 {postingRows.length}건
        </p>
      </div>

      <JobsFilter
        state={filterState}
        companies={registeredCompanies.map((c) => ({ id: c.id, name: c.name }))}
      />

      {registeredCompanies.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          아직 등록된 회사가 없습니다.
        </p>
      ) : filterState.view === "grouped" ? (
        <div className="space-y-10">
          {groupedCompanies.length === 0 ? (
            <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              조건에 맞는 공고가 없습니다.
            </p>
          ) : (
            groupedCompanies.map((company) => (
              <CompanyGroup
                key={company.id}
                company={company}
                postings={postingsByCompany.get(company.id) ?? []}
                appliedInfoById={appliedInfoById}
                now={now}
                today={today}
              />
            ))
          )}
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          조건에 맞는 공고가 없습니다.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((posting) => {
            const company = companiesById.get(posting.companyId);
            return (
              <JobCard
                key={posting.id}
                posting={posting}
                companyId={posting.companyId}
                companyName={company?.name ?? "알 수 없는 회사"}
                showCompany
                appliedInfo={
                  appliedInfoById.get(posting.id) ?? {
                    applied: false,
                    lastApplied: null,
                    reapply: { kind: "unknown" },
                  }
                }
                now={now}
                today={today}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
