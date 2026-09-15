import type { ApplyPolicy } from "@apply-manager/shared";

import { Badge } from "@/components/ui/badge";
import {
  DUPLICATE_POLICY_LABELS,
  policyBadgeVariant,
  reapplyPolicyLabel,
} from "@/lib/jobs";

/** 회사 재지원/중복지원 정책 배지 — unknown이면 표시하지 않는다 (스펙 5-2) */
export function PolicyBadges({
  reapplyPolicy,
  duplicateApplyPolicy,
  policyNote,
}: {
  reapplyPolicy: ApplyPolicy;
  duplicateApplyPolicy: ApplyPolicy;
  policyNote?: string | null;
}) {
  if (reapplyPolicy === "unknown" && duplicateApplyPolicy === "unknown") {
    return null;
  }
  return (
    <>
      {reapplyPolicy !== "unknown" ? (
        <Badge
          variant={policyBadgeVariant(reapplyPolicy)}
          title={policyNote ?? undefined}
        >
          {reapplyPolicyLabel(reapplyPolicy, policyNote)}
        </Badge>
      ) : null}
      {duplicateApplyPolicy !== "unknown" ? (
        <Badge
          variant={policyBadgeVariant(duplicateApplyPolicy)}
          title={policyNote ?? undefined}
        >
          {DUPLICATE_POLICY_LABELS[duplicateApplyPolicy]}
        </Badge>
      ) : null}
    </>
  );
}
