"use client";

import { CheckIcon } from "lucide-react";
import type { Category } from "@apply-manager/shared";

import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/lib/jobs";

/**
 * 직군 복수 선택 칩 (스펙 2장).
 * 상태를 갖지 않는 단일 책임 프레젠테이션 컴포넌트 — 선택 목록과 콜백만 받는다.
 */
export function CategoryChips({
  categories,
  selected,
  onToggle,
  onClear,
}: {
  categories: readonly Category[];
  selected: readonly Category[];
  onToggle: (category: Category) => void;
  onClear: () => void;
}) {
  const allActive = selected.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="직군 필터">
      <button
        type="button"
        onClick={onClear}
        aria-pressed={allActive}
        className={cn(chipClass, allActive ? chipActiveClass : chipIdleClass)}
      >
        전체
      </button>
      {categories.map((category) => {
        const active = selected.includes(category);
        return (
          <button
            key={category}
            type="button"
            onClick={() => onToggle(category)}
            aria-pressed={active}
            className={cn(chipClass, active ? chipActiveClass : chipIdleClass)}
          >
            {active ? <CheckIcon className="size-3.5" /> : null}
            {CATEGORY_LABELS[category]}
          </button>
        );
      })}
    </div>
  );
}

const chipClass =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipActiveClass = "border-primary bg-primary text-primary-foreground";
const chipIdleClass =
  "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground";
