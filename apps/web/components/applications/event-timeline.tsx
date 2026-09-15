import { STAGES } from "@apply-manager/shared";
import type { ApplicationEvent } from "@apply-manager/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, toKstDatetimeLocal } from "@/lib/format";
import {
  confirmEventAction,
  deleteEventAction,
  updateEventAction,
} from "@/lib/actions/applications";
import { STAGE_LABELS, stageBadgeVariant } from "@/lib/stages";

/**
 * 지원 건 이벤트 타임라인 (시간순).
 * AI 추출 결과는 오류 가능성이 있으므로 모든 이벤트를 인라인으로 수정할 수 있다 (스펙 1장).
 * needs_review 이벤트에는 "확인 필요" 표시와 빠른 "이상 없음" 처리를 추가로 노출한다.
 */
export function EventTimeline({ events }: { events: ApplicationEvent[] }) {
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  if (ordered.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        기록된 이벤트가 없습니다.
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {ordered.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
          {/* 타임라인 세로선 + 점 */}
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />
            {index < ordered.length - 1 ? (
              <span className="mt-1 w-px flex-1 bg-border" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={stageBadgeVariant(event.stage)}>
                {STAGE_LABELS[event.stage]}
              </Badge>
              {event.needsReview ? (
                <Badge variant="warning">확인 필요</Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {formatDateTime(event.occurredAt)}
              </span>
            </div>
            {event.summary ? (
              <p className="text-sm text-foreground">{event.summary}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {event.confidence !== null
                ? `신뢰도 ${event.confidence.toFixed(2)}`
                : "수동 기록"}
              {event.gmailMessageId ? (
                <span className="ml-2">근거 메일: {event.gmailMessageId}</span>
              ) : null}
            </p>

            <div className="flex items-center gap-2">
              {/* 모든 이벤트: 인라인 편집 (native <details>로 클라이언트 JS 없이 토글) */}
              <details className="group">
                <summary className="inline-flex cursor-pointer list-none items-center rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                  수정
                </summary>
                <form
                  action={updateEventAction}
                  className="mt-2 flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-2"
                >
                  <input type="hidden" name="eventId" value={event.id} />
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">단계</span>
                    <select
                      name="stage"
                      defaultValue={event.stage}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">발생 시각</span>
                    <input
                      type="datetime-local"
                      name="occurredAt"
                      defaultValue={toKstDatetimeLocal(event.occurredAt)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    />
                  </label>
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">요약</span>
                    <input
                      type="text"
                      name="summary"
                      defaultValue={event.summary ?? ""}
                      placeholder="한 줄 요약"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    />
                  </label>
                  <Button type="submit" size="sm">
                    저장
                  </Button>
                </form>
                <form
                  action={deleteEventAction}
                  className="mt-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2"
                >
                  <input type="hidden" name="eventId" value={event.id} />
                  <span className="text-xs text-muted-foreground">
                    전형과 무관한 항목(예: 이메일 확인 안내)이면 삭제하세요.
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    variant="destructive"
                    className="ml-auto"
                  >
                    이벤트 삭제
                  </Button>
                </form>
              </details>

              {event.needsReview ? (
                <form action={confirmEventAction}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <Button type="submit" size="sm" variant="outline">
                    이상 없음
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
