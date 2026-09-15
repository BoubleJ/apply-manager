"use client";

import { useState, useTransition } from "react";
import { CATEGORIES, type Category } from "@apply-manager/shared";

import { Badge } from "@/components/ui/badge";
import { updateJobCategoryAction } from "@/lib/actions/jobs";
import { CATEGORY_LABELS } from "@/lib/jobs";

/** 카테고리 배지 — 클릭하면 select로 바뀌어 오분류를 즉시 수정 (Server Action) */
export function CategoryBadgeEditor({
  jobPostingId,
  category,
}: {
  jobPostingId: string;
  category: Category;
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={category}
        disabled={isPending}
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          const next = event.target.value as Category;
          startTransition(async () => {
            await updateJobCategoryAction(jobPostingId, next);
            setEditing(false);
          });
        }}
        className="h-6 rounded-md border border-input bg-background px-1 text-xs"
      >
        {CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {CATEGORY_LABELS[value]}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="클릭해서 카테고리 수정"
      className="cursor-pointer"
    >
      <Badge variant="secondary" className={isPending ? "opacity-50" : undefined}>
        {CATEGORY_LABELS[category]}
      </Badge>
    </button>
  );
}
