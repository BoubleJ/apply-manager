"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { applicationEvents, applications } from "@apply-manager/db";
import { stageSchema } from "@apply-manager/shared";

import { getDb } from "@/lib/db";
import { dashboardHref, parseFilterKey } from "@/lib/stages";

/** 공고 카드의 "지원 기록 추가" — applications + applied 이벤트 수동 생성 */
const createApplicationSchema = z.object({
  companyId: z.uuid(),
  jobPostingId: z.uuid().optional(),
  position: z.string().trim().min(1),
  appliedAt: z.iso.date(),
});

export async function createApplicationAction(formData: FormData): Promise<void> {
  const input = createApplicationSchema.parse({
    companyId: formData.get("companyId"),
    jobPostingId: formData.get("jobPostingId") || undefined,
    position: formData.get("position"),
    appliedAt: formData.get("appliedAt"),
  });

  const db = getDb();
  const inserted = await db
    .insert(applications)
    .values({
      companyId: input.companyId,
      jobPostingId: input.jobPostingId ?? null,
      position: input.position,
      appliedAt: input.appliedAt,
      currentStage: "applied",
    })
    .returning({ id: applications.id });

  const application = inserted[0];
  if (application) {
    await db.insert(applicationEvents).values({
      applicationId: application.id,
      stage: "applied",
      // date 컬럼(지원일) 기준 — KST 자정으로 기록
      occurredAt: new Date(`${input.appliedAt}T00:00:00+09:00`),
      summary: "공고에서 수동 등록",
    });
  }

  revalidatePath("/");
  revalidatePath("/jobs");
}

/** 이벤트의 최신 stage로 applications.current_stage 캐시를 재계산 */
async function refreshCurrentStage(applicationId: string): Promise<void> {
  const db = getDb();
  const latest = await db.query.applicationEvents.findFirst({
    where: eq(applicationEvents.applicationId, applicationId),
    orderBy: [desc(applicationEvents.occurredAt), desc(applicationEvents.createdAt)],
  });
  if (latest) {
    await db
      .update(applications)
      .set({ currentStage: latest.stage })
      .where(eq(applications.id, applicationId));
  }
}

/**
 * 전형 이벤트 전체 수정 (스펙 1장) — needs_review 여부와 무관하게 모든 이벤트에 적용.
 * 단계·요약·발생시각을 교정하고 확인 처리(needsReview=false)한다.
 */
const editEventSchema = z.object({
  eventId: z.uuid(),
  stage: stageSchema,
  summary: z.string().trim().max(500).optional(),
  /** datetime-local 'YYYY-MM-DDTHH:mm' — KST 벽시계로 해석 */
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});

export async function updateEventAction(formData: FormData): Promise<void> {
  const input = editEventSchema.parse({
    eventId: formData.get("eventId"),
    stage: formData.get("stage"),
    summary: formData.get("summary") ?? undefined,
    occurredAt: formData.get("occurredAt"),
  });

  const db = getDb();
  const updated = await db
    .update(applicationEvents)
    .set({
      stage: input.stage,
      summary: input.summary && input.summary.length > 0 ? input.summary : null,
      occurredAt: new Date(`${input.occurredAt}:00+09:00`),
      needsReview: false,
    })
    .where(eq(applicationEvents.id, input.eventId))
    .returning({ applicationId: applicationEvents.applicationId });

  const event = updated[0];
  if (event) {
    await refreshCurrentStage(event.applicationId);
  }
  revalidatePath("/");
}

/**
 * 지원 정보 수정 (스펙 1장) — 직무(직무 미상 교정)·지원일을 사용자가 직접 보정한다.
 */
const editApplicationSchema = z.object({
  applicationId: z.uuid(),
  position: z.string().trim().min(1).max(200),
  appliedAt: z.iso.date(),
});

export async function updateApplicationAction(formData: FormData): Promise<void> {
  const input = editApplicationSchema.parse({
    applicationId: formData.get("applicationId"),
    position: formData.get("position"),
    appliedAt: formData.get("appliedAt"),
  });

  const db = getDb();
  await db
    .update(applications)
    .set({ position: input.position, appliedAt: input.appliedAt })
    .where(eq(applications.id, input.applicationId));

  revalidatePath("/");
  revalidatePath("/jobs");
}

/**
 * 전형 이벤트 삭제 (스펙 1장) — 단순 이메일 확인 안내 등 전형과 무관한 항목 제거용.
 * 삭제 후 남은 이벤트로 current_stage를 재계산한다.
 */
export async function deleteEventAction(formData: FormData): Promise<void> {
  const eventId = z.uuid().parse(formData.get("eventId"));

  const db = getDb();
  const deleted = await db
    .delete(applicationEvents)
    .where(eq(applicationEvents.id, eventId))
    .returning({ applicationId: applicationEvents.applicationId });

  const event = deleted[0];
  if (event) {
    await refreshCurrentStage(event.applicationId);
  }
  revalidatePath("/");
}

/**
 * 지원 내역 통째 삭제 (스펙 1장) — 이벤트도 FK cascade로 함께 삭제.
 * 삭제 후 상세 다이얼로그가 닫히도록 대시보드로 리다이렉트한다.
 */
export async function deleteApplicationAction(formData: FormData): Promise<void> {
  const input = z
    .object({ applicationId: z.uuid(), filter: z.string().optional() })
    .parse({
      applicationId: formData.get("applicationId"),
      filter: formData.get("filter") ?? undefined,
    });

  const db = getDb();
  await db.delete(applications).where(eq(applications.id, input.applicationId));

  revalidatePath("/");
  redirect(dashboardHref(parseFilterKey(input.filter)));
}

/** needs_review 이벤트 "이상 없음" 확인 처리 (분류 결과 유지) */
export async function confirmEventAction(formData: FormData): Promise<void> {
  const eventId = z.uuid().parse(formData.get("eventId"));

  const db = getDb();
  await db
    .update(applicationEvents)
    .set({ needsReview: false })
    .where(eq(applicationEvents.id, eventId));

  revalidatePath("/");
}
