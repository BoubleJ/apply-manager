import { z } from 'zod';
import { completeStructured, stageSchema, type LlmEnv } from '@apply-manager/shared';
import type { ParsedMail } from './parse-mail';

/**
 * classifyMail (스펙 6장): 규칙 사전 필터 + 2단계 LLM 분류.
 * 0) 사전 필터 (순수 함수): 지원서 제출 전 단계의 이메일 인증 안내를 LLM 호출 없이 스킵
 * 1) 필터 (LLM_MODEL_FILTER, 저가 모델): 채용 전형 관련 메일인가? 아니면 즉시 스킵
 * 2) 추출 (LLM_MODEL_EXTRACT, 큰 모델): 회사명/직무/stage/한 줄 요약/confidence
 * 형식은 Structured Outputs로 API 레벨에서 강제하고 응답은 Zod로 파싱한다 (shared.completeStructured).
 */

const MAX_BODY_CHARS = 6000;

/** confidence가 이 값 미만이면 needs_review로 저장 (스펙 6장) */
export const CONFIDENCE_THRESHOLD = 0.7;

export const mailFilterSchema = z.object({
  isRecruitingRelated: z.boolean(),
});

// Structured Outputs 호환을 위해 optional 대신 nullable 사용 (모든 필드 필수)
export const mailExtractionSchema = z.object({
  company: z.string().min(1),
  position: z.string().nullable(),
  stage: stageSchema,
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});
export type MailExtraction = z.infer<typeof mailExtractionSchema>;

export type MailClassification =
  | { isRecruitingRelated: false }
  | { isRecruitingRelated: true; extraction: MailExtraction };

const FILTER_SYSTEM_PROMPT = `너는 이메일이 "사용자 본인이 지원한 채용 전형 관련 메일"인지 판별하는 분류기다.

isRecruitingRelated = true 인 경우 (전형 진행 관련 메일):
- 지원 접수/접수 확인 (지원서가 최종 제출·접수 완료된 경우에 한함)
- 서류 전형 결과 (합격/불합격)
- 과제 전형·코딩테스트 안내
- 면접 안내, 면접 일정 조율, 면접 결과
- 최종 합격, 처우 협의, 오퍼레터
- 지원 철회 확인

isRecruitingRelated = false 인 경우:
- 지원서 제출 전 단계의 안내 — 이메일 주소 인증/본인확인 완료 안내, 지원서 임시저장·이어쓰기 안내,
  채용 사이트 계정 가입 확인 등. "지원서를 계속 작성하세요", "지원을 완료하세요"처럼 아직 제출을
  요청하는 메일은 지원이 접수된 것이 아니므로 false다.
- 채용 공고 홍보, 뉴스레터, 취업 플랫폼의 추천 공고 알림
- 헤드헌터·리크루터의 스카우트/포지션 제안 (본인이 지원한 전형이 아님)
- 그 외 채용 전형과 무관한 모든 메일`;

const EXTRACT_SYSTEM_PROMPT = `너는 채용 전형 메일에서 정보를 추출하는 도구다. 다음 필드를 추출하라.

- company: 전형을 진행하는 회사명. 채용 플랫폼(원티드, 그리팅, 나인하이어 등)이 대신 발송했더라도 실제 지원한 회사명을 쓴다.
- position: 메일에 적힌 지원 직무명. 메일 원문의 표기를 바꾸지 말고 그대로 추출한다 (괄호·하이픈·영문 표기 유지). 직무명이 메일에 없으면 null.
- stage: 이 메일이 알리는 전형 단계. 반드시 아래 값 중 하나:
  - applied: 지원 접수/접수 확인
  - document_passed: 서류 전형 합격
  - document_rejected: 서류 전형 불합격
  - assignment: 과제 전형·코딩테스트 안내
  - interview_1: 1차 면접 안내/일정
  - interview_1_passed: 1차 면접 합격
  - interview_2: 2차/최종 면접 안내
  - final_passed: 최종 합격
  - rejected: 서류 이후 단계(과제/면접 등)의 불합격
  - offer: 처우 협의·오퍼레터
  - withdrawn: 지원 철회 확인
- summary: 메일 내용 한 줄 요약 (한국어).
- confidence: 분류 신뢰도 0~1.

주의: 한국 기업의 불합격 통보는 완곡하다. "아쉽지만", "좋은 결과를 드리지 못하게 되었습니다", "함께하지 못하게 되었습니다", "인연이 닿지 않았습니다" 같은 표현은 불합격 통보다. 어느 단계의 불합격인지(서류 단계면 document_rejected, 그 이후 단계면 rejected)를 문맥으로 구분하라. 확신이 없으면 confidence를 낮게 매겨라.`;

/**
 * 이메일 인증 안내 메일 사전 필터 (순수 함수).
 *
 * "이메일 주소 확인이 완료되었으니 지원서를 계속 작성하세요" 류의 메일은 지원서가 아직 제출되지
 * 않은 상태인데, 제목·본문에 '지원서'와 '확인 완료'가 같이 나와 LLM 필터가 접수 확인으로 오인한다.
 * 그대로 통과하면 stage=applied 이벤트가 되고 매칭 실패 시 유령 지원 건까지 생긴다.
 *
 * 보수적 설계: '인증' 신호만으로는 자르지 않는다 ("본인인증 후 면접 일정 확정" 같은 진짜 전형
 * 메일을 날릴 수 있다). 인증 신호 + 제출 전 신호가 모두 있을 때만 자르고, 애매한 변형은
 * LLM 필터(FILTER_SYSTEM_PROMPT의 제출 전 단계 항목)에 맡긴다.
 */

/** 이메일 인증·본인확인 신호 */
const VERIFICATION_PATTERNS: readonly string[] = [
  '이메일 인증',
  '이메일 주소 인증',
  '이메일 확인', // 그리팅: "지원서에 첨부하신 이메일 확인 안내 메일입니다"
  '이메일 주소 확인',
  '메일 인증',
  '본인 인증',
  '인증번호',
  '인증 코드',
  'email verification',
  'verify your email',
  'verify email',
  'confirm your email',
  'email confirmation',
];

/** 지원서가 아직 제출되지 않았음을 드러내는 신호 */
const PRE_SUBMISSION_PATTERNS: readonly string[] = [
  '지원서를 계속',
  '지원서 작성을 계속',
  '작성을 계속',
  '이어서 작성',
  '작성을 이어',
  '제출을 이어', // 그리팅: "작성 중이시던 지원서 페이지로 돌아가 제출을 이어가 주세요"
  '작성 중이시던',
  '작성 중인 지원서',
  '지원서 페이지로 돌아가',
  '이어쓰기',
  '지원서 작성을 완료',
  '지원을 완료',
  '지원서를 제출',
  '임시저장',
  'continue your application',
  'continue applying',
  'complete your application',
  'finish your application',
  'resume your application',
  'submit your application',
];

/**
 * 매칭용 정규화: 소문자화 + 공백 전부 제거.
 * 한국어는 띄어쓰기가 흔들리고('본인 인증'/'본인인증') \b도 안 통하므로 공백을 지운 뒤 부분 문자열로 본다.
 */
function compact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

export function isVerificationOnlyMail(mail: ParsedMail): boolean {
  const haystack = compact(`${mail.subject}\n${mail.body.slice(0, MAX_BODY_CHARS)}`);
  const hasVerification = VERIFICATION_PATTERNS.some((p) => haystack.includes(compact(p)));
  if (!hasVerification) return false;
  return PRE_SUBMISSION_PATTERNS.some((p) => haystack.includes(compact(p)));
}

function toUserPrompt(mail: ParsedMail): string {
  return [
    `발신자: ${mail.from}`,
    `제목: ${mail.subject}`,
    '',
    '본문:',
    mail.body.slice(0, MAX_BODY_CHARS),
  ].join('\n');
}

export async function classifyMail(
  mail: ParsedMail,
  llm: LlmEnv,
  fetchImpl?: typeof fetch,
): Promise<MailClassification> {
  // 규칙으로 확정되는 케이스는 LLM 호출 없이 스킵 (토큰 절약 + 재현 가능)
  if (isVerificationOnlyMail(mail)) {
    return { isRecruitingRelated: false };
  }

  const common = {
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    userPrompt: toUserPrompt(mail),
    temperature: 0,
    ...(fetchImpl && { fetchImpl }),
  };

  const filter = await completeStructured({
    ...common,
    model: llm.modelFilter,
    systemPrompt: FILTER_SYSTEM_PROMPT,
    schema: mailFilterSchema,
    schemaName: 'mail_filter',
  });
  if (!filter.isRecruitingRelated) {
    return { isRecruitingRelated: false };
  }

  const extraction = await completeStructured({
    ...common,
    model: llm.modelExtract,
    systemPrompt: EXTRACT_SYSTEM_PROMPT,
    schema: mailExtractionSchema,
    schemaName: 'mail_extraction',
  });
  return { isRecruitingRelated: true, extraction };
}
