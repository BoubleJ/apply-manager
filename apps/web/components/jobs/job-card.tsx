import { ExternalLinkIcon } from "lucide-react";
import type { JobPosting } from "@apply-manager/db";

import { AddApplicationDialog } from "@/components/jobs/add-application-dialog";
import { ArchiveButton } from "@/components/jobs/archive-button";
import { CategoryBadgeEditor } from "@/components/jobs/category-badge-editor";
import { JobPostingEditDialog } from "@/components/jobs/job-posting-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import type { AppliedInfo } from "@/lib/applied";
import { formatReapplyStatus } from "@/lib/applied";
import { formatDate } from "@/lib/format";
import { formatDday, isNewPosting } from "@/lib/jobs";
import type { BadgeVariant } from "@/components/ui/badge";

/** 공고 카드 — 회사명(옵션)/공고명/D-day/원문 링크/상태·카테고리·NEW 배지 */
/** 재지원 상태 → 배지 variant */
function reapplyBadgeVariant(kind: AppliedInfo["reapply"]["kind"]): BadgeVariant {
  switch (kind) {
    case "available":
      return "success";
    case "waiting":
      return "warning";
    case "not_allowed":
      return "destructive";
    case "unknown":
      return "outline";
  }
}

export function JobCard({
  posting,
  companyId,
  companyName,
  showCompany,
  appliedInfo,
  now,
  today,
}: {
  posting: JobPosting;
  companyId: string;
  companyName: string;
  /** 플랫 뷰에서 회사명을 함께 표시 */
  showCompany: boolean;
  /** 지원 이력/재지원 상태 (스펙 3장) */
  appliedInfo: AppliedInfo;
  now: Date;
  /** AddApplicationDialog 기본 지원일 (YYYY-MM-DD, KST) */
  today: string;
}) {
  const dday = formatDday(posting.deadline, now);
  const isNew = posting.status === "open" && isNewPosting(posting.firstSeenAt, now);
  const closed = posting.status === "closed";
  const reapplyLabel = appliedInfo.applied
    ? formatReapplyStatus(appliedInfo.reapply)
    : null;

  return (
    <Card className={closed ? "opacity-60" : undefined}>
      <CardHeader className="gap-2">
        {showCompany ? (
          <p className="text-xs font-medium text-muted-foreground">
            {companyName}
          </p>
        ) : null}
        <a
          href={posting.url}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-start gap-1 font-semibold leading-snug hover:underline"
        >
          {posting.title}
          <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </a>
        <div className="flex flex-wrap items-center gap-1.5">
          {isNew ? (
            <Badge className="bg-chart-1 text-white">NEW</Badge>
          ) : null}
          {appliedInfo.applied ? <Badge variant="secondary">지원함</Badge> : null}
          {reapplyLabel ? (
            <Badge variant={reapplyBadgeVariant(appliedInfo.reapply.kind)}>
              {reapplyLabel}
            </Badge>
          ) : null}
          <Badge variant={closed ? "outline" : "success"}>
            {closed ? "closed" : "open"}
          </Badge>
          <CategoryBadgeEditor
            jobPostingId={posting.id}
            category={posting.category}
          />
          {dday ? (
            <Badge variant={dday === "마감" ? "outline" : "warning"}>{dday}</Badge>
          ) : (
            <Badge variant="outline">상시채용</Badge>
          )}
        </div>
      </CardHeader>
      {/*
        공고 설명은 목록에 노출하지 않는다 — 앞 두 줄만 잘려 보여서 읽히지 않는다.
        수집은 계속한다: 직군 분류기가 제목만으로 애매한 공고를 가를 때 쓰고(classify-category),
        편집 다이얼로그에서 확인·수정할 수 있다.
      */}
      <CardFooter className="mt-auto justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {posting.deadline
            ? `마감 ${formatDate(posting.deadline)}`
            : "마감일 없음"}
        </span>
        <div className="flex items-center gap-2">
          <JobPostingEditDialog
            posting={{
              id: posting.id,
              title: posting.title,
              url: posting.url,
              deadline: posting.deadline,
              status: posting.status,
              description: posting.description,
            }}
          />
          <ArchiveButton
            jobPostingId={posting.id}
            archived={posting.archivedAt !== null}
          />
          <AddApplicationDialog
            companyId={companyId}
            companyName={companyName}
            jobPostingId={posting.id}
            defaultPosition={posting.title}
            defaultAppliedAt={today}
          />
        </div>
      </CardFooter>
    </Card>
  );
}
