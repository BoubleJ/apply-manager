"use client";

import { useRouter } from "next/navigation";
import { CATEGORIES, type Category } from "@apply-manager/shared";

import { CategoryChips } from "@/components/jobs/category-chips";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildJobsHref,
  toggleCategory,
  type JobsFilterState,
  type JobsView,
} from "@/lib/jobs";

/** /jobs 필터 바 — 상태는 전부 URL searchParams (뷰 토글/직군 칩/회사/진행중/미지원) */
export function JobsFilter({
  state,
  companies,
}: {
  state: JobsFilterState;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();

  const update = (patch: Partial<JobsFilterState>) => {
    router.replace(buildJobsHref({ ...state, ...patch }), { scroll: false });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={state.view}
          onValueChange={(value: string) => update({ view: value as JobsView })}
        >
          <TabsList>
            <TabsTrigger value="grouped">기업별</TabsTrigger>
            <TabsTrigger value="flat">전체 목록</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select
          value={state.companyId}
          onValueChange={(value: string) => update({ companyId: value })}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="회사" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 회사</SelectItem>
            {companies.map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.openOnly}
            onChange={(event) => update({ openOnly: event.target.checked })}
            className="size-4 accent-primary"
          />
          진행 중만
        </label>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.unappliedOnly}
            onChange={(event) => update({ unappliedOnly: event.target.checked })}
            className="size-4 accent-primary"
          />
          미지원만 보기
        </label>
      </div>

      <CategoryChips
        categories={CATEGORIES}
        selected={state.categories}
        onToggle={(category: Category) =>
          update({ categories: toggleCategory(state.categories, category) })
        }
        onClear={() => update({ categories: [] })}
      />
    </div>
  );
}
