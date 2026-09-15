"use client";

import { useRef, useState, useTransition } from "react";
import type { JobPostingStatus } from "@apply-manager/shared";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteJobPostingAction,
  updateJobPostingAction,
} from "@/lib/actions/jobs";

/**
 * 채용공고 편집·삭제 다이얼로그.
 * 서버 액션은 useTransition으로 직접 호출한다 (인라인 form action 클로저 대신 —
 * dev HMR에서 청크가 stale해지며 __webpack_modules__ 에러가 나는 것을 방지).
 */
export function JobPostingEditDialog({
  posting,
}: {
  posting: {
    id: string;
    title: string;
    url: string;
    deadline: string | null;
    status: JobPostingStatus;
    description: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const fieldId = (name: string) => `${name}-${posting.id}`;

  const save = () => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("jobPostingId", posting.id);
    setError(null);
    startTransition(async () => {
      try {
        await updateJobPostingAction(formData);
        setOpen(false);
      } catch {
        setError("저장에 실패했습니다. 입력값을 확인해주세요.");
      }
    });
  };

  const remove = () => {
    const formData = new FormData();
    formData.set("jobPostingId", posting.id);
    setError(null);
    startTransition(async () => {
      try {
        await deleteJobPostingAction(formData);
        setOpen(false);
      } catch {
        setError("삭제에 실패했습니다.");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmDelete(false);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          편집
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>공고 편집</DialogTitle>
          <DialogDescription>
            수집된 내용을 직접 보정합니다. 카테고리는 카드의 배지에서 바꿀 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("title")}>공고명</Label>
            <Input
              id={fieldId("title")}
              name="title"
              defaultValue={posting.title}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("url")}>원문 URL</Label>
            <Input
              id={fieldId("url")}
              name="url"
              type="url"
              defaultValue={posting.url}
              required
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor={fieldId("deadline")}>마감일 (없으면 상시)</Label>
              <Input
                id={fieldId("deadline")}
                name="deadline"
                type="date"
                defaultValue={posting.deadline ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("status")}>상태</Label>
              <select
                id={fieldId("status")}
                name="status"
                defaultValue={posting.status}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="open">진행 중</option>
                <option value="closed">마감</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("description")}>설명</Label>
            <textarea
              id={fieldId("description")}
              name="description"
              defaultValue={posting.description ?? ""}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>

        <div className="mt-2 border-t pt-3">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-destructive">
                이 공고를 삭제할까요? (지원 이력은 유지됩니다)
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={remove}
                >
                  {pending ? "삭제 중…" : "삭제"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              이 공고 삭제
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
