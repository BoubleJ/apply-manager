import Link from "next/link";
import type { Application, ApplicationEvent, Company } from "@apply-manager/db";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  dashboardHref,
  hasNeedsReview,
  STAGE_LABELS,
  stageBadgeVariant,
  type ApplicationFilterKey,
} from "@/lib/stages";

export type ApplicationRow = Application & {
  company: Company;
  /** occurred_at 내림차순 정렬 상태로 전달 */
  events: ApplicationEvent[];
};

/** 지원 목록 테이블 — 행 클릭 시 이벤트 타임라인 상세(?app=id) */
export function ApplicationTable({
  applications,
  currentFilter,
}: {
  applications: ApplicationRow[];
  currentFilter: ApplicationFilterKey;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>회사명</TableHead>
          <TableHead>직무</TableHead>
          <TableHead>지원일</TableHead>
          <TableHead>현재 단계</TableHead>
          <TableHead>최근 이벤트</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={5}
              className="h-24 text-center text-muted-foreground"
            >
              표시할 지원 건이 없습니다.
            </TableCell>
          </TableRow>
        ) : (
          applications.map((application) => {
            const latest = application.events[0];
            const needsReview = hasNeedsReview(application.events);
            return (
              <TableRow key={application.id} className="relative cursor-pointer">
                <TableCell className="font-medium">
                  {/* after 오버레이로 행 전체를 클릭 영역으로 (클라이언트 JS 없이) */}
                  <Link
                    href={dashboardHref(currentFilter, application.id)}
                    scroll={false}
                    className="after:absolute after:inset-0"
                  >
                    {application.company.name}
                  </Link>
                </TableCell>
                <TableCell className="max-w-56 truncate">
                  {application.position}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatDate(application.appliedAt)}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <Badge variant={stageBadgeVariant(application.currentStage)}>
                      {STAGE_LABELS[application.currentStage]}
                    </Badge>
                    {needsReview ? (
                      <Badge variant="warning">확인 필요</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-72">
                  {latest ? (
                    <span className="block truncate text-muted-foreground">
                      {latest.summary ?? STAGE_LABELS[latest.stage]}
                      <span className="ml-2 text-xs">
                        {formatDateTime(latest.occurredAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
