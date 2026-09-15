import { eq } from 'drizzle-orm';
import { applicationEvents, applications, type Db } from '@apply-manager/db';
import type { Stage } from '@apply-manager/shared';

/**
 * persistEvent (스펙 6장): 이벤트 적재 + applications.current_stage 캐시 갱신.
 * needs_review 이벤트는 캐시를 덮어쓰지 않는다 — 오분류가 현재 단계를 오염시키지 않도록
 * 사용자 확인 전까지 보류하는 보수적 선택.
 */
export async function persistEvent(
  db: Db,
  args: {
    applicationId: string;
    stage: Stage;
    occurredAt: Date;
    gmailMessageId: string;
    summary: string | null;
    confidence: number | null;
    needsReview: boolean;
  },
): Promise<void> {
  await db.insert(applicationEvents).values({
    applicationId: args.applicationId,
    stage: args.stage,
    occurredAt: args.occurredAt,
    gmailMessageId: args.gmailMessageId || null,
    summary: args.summary,
    confidence: args.confidence,
    needsReview: args.needsReview,
  });

  if (!args.needsReview) {
    await db
      .update(applications)
      .set({ currentStage: args.stage })
      .where(eq(applications.id, args.applicationId));
  }
}
