"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { jobPostings } from "@apply-manager/db";
import { preprocessHtml } from "@apply-manager/shared";

import { getDb } from "@/lib/db";

/** 보관 본문 최대 길이 (스냅샷 저장 상한) */
const MAX_ARCHIVE_CHARS = 8000;
const FETCH_TIMEOUT_MS = 8000;

/**
 * 공고 상세 내용을 가져와 보관 (스펙 5장).
 * 공고 URL을 서버에서 fetch → 본문 텍스트 추출(preprocessHtml). 실패 시 description으로 폴백.
 */
async function fetchPostingContent(
  url: string,
  fallback: string | null,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (apply-manager archive)" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const html = await res.text();
    const { text } = preprocessHtml(html);
    const trimmed = text.trim();
    if (trimmed.length > 0) return trimmed.slice(0, MAX_ARCHIVE_CHARS);
  } catch {
    // 네트워크 실패·SPA 등 → 폴백
  }
  return (fallback ?? "본문을 가져오지 못했습니다.").slice(0, MAX_ARCHIVE_CHARS);
}

export type ArchiveResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/** 공고 상세를 가져와 보관하고, 저장된 본문을 반환한다 (다이얼로그 미리보기용) */
export async function archiveJobPostingAction(
  jobPostingId: string,
): Promise<ArchiveResult> {
  const parsed = z.uuid().safeParse(jobPostingId);
  if (!parsed.success) return { ok: false, error: "잘못된 공고 ID입니다." };

  const db = getDb();
  const rows = await db
    .select({ url: jobPostings.url, description: jobPostings.description })
    .from(jobPostings)
    .where(eq(jobPostings.id, parsed.data));
  const posting = rows[0];
  if (!posting) return { ok: false, error: "공고를 찾을 수 없습니다." };

  const content = await fetchPostingContent(posting.url, posting.description);
  await db
    .update(jobPostings)
    .set({ archivedContent: content, archivedAt: new Date() })
    .where(eq(jobPostings.id, parsed.data));

  revalidatePath("/jobs");
  revalidatePath("/jobs/archive");
  return { ok: true, content };
}

/** 보관 해제 */
export async function unarchiveJobPostingAction(
  formData: FormData,
): Promise<void> {
  const id = z.uuid().parse(formData.get("jobPostingId"));

  const db = getDb();
  await db
    .update(jobPostings)
    .set({ archivedContent: null, archivedAt: null })
    .where(eq(jobPostings.id, id));

  revalidatePath("/jobs");
  revalidatePath("/jobs/archive");
}
