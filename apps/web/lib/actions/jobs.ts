"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { jobPostings } from "@apply-manager/db";
import { categorySchema, jobPostingStatusSchema } from "@apply-manager/shared";

import { getDb } from "@/lib/db";

/** 공고 카테고리 배지 클릭 → 오분류 수동 수정 */
export async function updateJobCategoryAction(
  jobPostingId: string,
  category: string,
): Promise<void> {
  const id = z.uuid().parse(jobPostingId);
  const parsedCategory = categorySchema.parse(category);

  await getDb()
    .update(jobPostings)
    .set({ category: parsedCategory })
    .where(eq(jobPostings.id, id));

  revalidatePath("/jobs");
}

/**
 * 공고 내용 수정 (사용자 보정) — 제목·URL·마감일·상태·설명.
 * 스크래핑 결과가 부정확하거나 내용이 달라진 경우 직접 교정한다.
 */
const updateJobPostingSchema = z.object({
  jobPostingId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().url().max(1000),
  deadline: z.iso.date().nullable(),
  status: jobPostingStatusSchema,
  description: z.string().trim().max(5000).optional(),
});

export async function updateJobPostingAction(formData: FormData): Promise<void> {
  const deadlineRaw = formData.get("deadline");
  const input = updateJobPostingSchema.parse({
    jobPostingId: formData.get("jobPostingId"),
    title: formData.get("title"),
    url: formData.get("url"),
    deadline: deadlineRaw && String(deadlineRaw).length > 0 ? deadlineRaw : null,
    status: formData.get("status"),
    description: formData.get("description") ?? undefined,
  });

  await getDb()
    .update(jobPostings)
    .set({
      title: input.title,
      url: input.url,
      deadline: input.deadline,
      status: input.status,
      description:
        input.description && input.description.length > 0
          ? input.description
          : null,
    })
    .where(eq(jobPostings.id, input.jobPostingId));

  revalidatePath("/jobs");
  revalidatePath("/jobs/archive");
}

/**
 * 공고 삭제 (불필요한 공고 제거).
 * 연결된 지원 건은 applications.job_posting_id가 set null 이라 유지된다.
 */
export async function deleteJobPostingAction(formData: FormData): Promise<void> {
  const id = z.uuid().parse(formData.get("jobPostingId"));

  await getDb().delete(jobPostings).where(eq(jobPostings.id, id));

  revalidatePath("/jobs");
  revalidatePath("/jobs/archive");
}
