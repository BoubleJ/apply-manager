import { desc, eq, isNotNull } from "drizzle-orm";
import { ExternalLinkIcon } from "lucide-react";
import { companies, jobPostings } from "@apply-manager/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CATEGORY_LABELS } from "@/lib/jobs";
import { unarchiveJobPostingAction } from "@/lib/actions/archive";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

// DB를 요청 시점에 조회한다 (DATABASE_URL 없이도 빌드 가능)
export const dynamic = "force-dynamic";

/** 보관함 (스펙 5장) — 보관한 공고의 상세 내용을 다시 조회 */
export default async function ArchivePage() {
  const db = getDb();
  const rows = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      url: jobPostings.url,
      category: jobPostings.category,
      companyName: companies.name,
      archivedAt: jobPostings.archivedAt,
      archivedContent: jobPostings.archivedContent,
    })
    .from(jobPostings)
    .innerJoin(companies, eq(jobPostings.companyId, companies.id))
    .where(isNotNull(jobPostings.archivedAt))
    .orderBy(desc(jobPostings.archivedAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">보관함</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          보관한 공고 {rows.length}건 — 상세 내용을 다시 확인할 수 있습니다.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          보관한 공고가 없습니다. 공고 카드의 “보관”으로 저장하세요.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {row.companyName}
                    </p>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-start gap-1 font-semibold leading-snug hover:underline"
                    >
                      {row.title}
                      <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {CATEGORY_LABELS[row.category]}
                    </Badge>
                    <form action={unarchiveJobPostingAction}>
                      <input type="hidden" name="jobPostingId" value={row.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        보관 해제
                      </Button>
                    </form>
                  </div>
                </div>
                {row.archivedAt ? (
                  <span className="text-xs text-muted-foreground">
                    보관 {formatDateTime(row.archivedAt)}
                  </span>
                ) : null}
              </CardHeader>
              <CardContent>
                <details className="group">
                  <summary className="cursor-pointer list-none text-sm font-medium text-primary hover:underline">
                    상세 내용 보기
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm text-foreground">
                    {row.archivedContent ?? "저장된 내용이 없습니다."}
                  </pre>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
