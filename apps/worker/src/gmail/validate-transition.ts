import type { Stage } from '@apply-manager/shared';

/**
 * 상태 전이 검증 (스펙 6장 validateTransition).
 *
 * LLM 분류 결과를 저장하기 전, 해당 지원 건의 기존 이벤트 stage 목록과 대조해
 * 논리적으로 불가능한 전이를 감지하는 순수 함수. 감지해도 이벤트를 버리지 않고
 * needs_review로 저장하는 것은 호출자의 책임이다 (재지원·전형 복귀 등 정상 예외 가능).
 */

const REJECTION_STAGES: ReadonlySet<Stage> = new Set(['document_rejected', 'rejected']);

/** 진행(전형이 앞으로 나아가는) 이벤트가 아닌 stage — 탈락·철회 */
const NON_PROGRESS_STAGES: ReadonlySet<Stage> = new Set([
  'document_rejected',
  'rejected',
  'withdrawn',
]);

export interface TransitionCheck {
  needsReview: boolean;
  reasons: string[];
}

export function validateTransition(
  existingStages: readonly Stage[],
  newStage: Stage,
): TransitionCheck {
  const reasons: string[] = [];

  // 같은 stage 이벤트 중복 — 회사 오매칭 또는 중복 분류 신호
  if (existingStages.includes(newStage)) {
    reasons.push(`duplicate stage event: ${newStage}`);
  }

  // 탈락 이후의 진행 이벤트 — 재지원이면 정상이지만 사용자 확인이 필요
  const hasRejection = existingStages.some((stage) => REJECTION_STAGES.has(stage));
  if (hasRejection && !NON_PROGRESS_STAGES.has(newStage)) {
    reasons.push('progress event after rejection');
  }

  // applied 이벤트 없는 지원 건에 갑자기 후속 단계 이벤트 — 회사명 오인식 신호
  if (newStage !== 'applied' && !existingStages.includes('applied')) {
    reasons.push('event without prior applied event');
  }

  return { needsReview: reasons.length > 0, reasons };
}
