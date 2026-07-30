import { z } from 'zod';
import {
  CATEGORIES,
  LlmRateLimitError,
  completeStructured,
  type Category,
} from '@job-tracker/shared';

/**
 * 직군 분류기 (스펙 7-7): 개발 직군만 수집하기 위한 2단 하이브리드.
 * 1) 키워드 규칙 (순수 함수) — 보수적 설계: 확신 없으면(무매칭·복수 카테고리 매칭)
 *    non_dev가 아니라 LLM 폴백으로 넘긴다
 * 2) LLM 폴백 (LLM_MODEL_FILTER) — 제목에 직군이 드러나지 않는 케이스만 담당
 *
 * 분류 함수는 판정까지만 책임진다 (non_dev 반환 포함). 버릴지는 오케스트레이터의 정책.
 */

export type CategoryDecision = Category | 'non_dev';

/**
 * 개발 직군으로 분류되지만 수집하지 않는 카테고리.
 * 분류기는 그대로 qa를 판정하고(오분류 진단 가능), 저장 여부는 오케스트레이터가 결정한다.
 */
export const EXCLUDED_CATEGORIES: ReadonlySet<Category> = new Set(['qa']);

/**
 * 오케스트레이터가 서킷브레이커를 내려야 하는 429인지 판정한다.
 * 일시적 스로틀(분당 토큰 초과 등)은 몇 초 뒤 풀리므로 브레이커를 내리지 않는다 —
 * 내리면 남은 회사 전부가 이번 실행 내내 키워드 분류만 쓰게 된다.
 */
export function isQuotaExhausted(error: unknown): boolean {
  return error instanceof LlmRateLimitError && error.exhausted;
}

type KeywordPattern = string | RegExp; // string은 substring 매칭 (한국어는 \b가 안 통함), RegExp는 word boundary용

const KEYWORD_RULES: ReadonlyArray<{
  category: Category;
  patterns: ReadonlyArray<KeywordPattern>;
}> = [
  {
    category: 'fullstack',
    patterns: ['풀스택', '풀스텍', 'fullstack', 'full stack'],
  },
  {
    category: 'frontend',
    // '프론트' 단독은 '프론트데스크/프론트오피스' 등 비개발에 오매칭 → '프론트엔드'로 좁힘.
    // '프론트 개발자'처럼 애매한 표기는 무매칭으로 LLM 폴백에 맡긴다 (보수적 설계).
    patterns: ['프론트엔드', '프론트 엔드', 'frontend', 'front end', /\bfe\b/],
  },
  {
    category: 'backend',
    patterns: ['백엔드', 'backend', 'back end', '서버 개발', 'server engineer', 'server developer'],
  },
  {
    category: 'mobile',
    // '모바일' 단독은 '모바일쿠폰 영업/모바일 마케팅' 등 비개발에 오매칭 → 개발 맥락 표기로 좁힘.
    // android/ios/flutter/react native는 비개발 제목에 안 나오므로 그대로 둔다.
    patterns: [
      '모바일 개발',
      '모바일 앱',
      '모바일 클라이언트',
      '모바일 엔지니어',
      '앱 개발',
      'mobile developer',
      'mobile engineer',
      'mobile app',
      'mobile client',
      'android',
      '안드로이드',
      /\bios\b/,
      'flutter',
      'react native',
    ],
  },
  {
    category: 'devops',
    patterns: [
      'devops',
      '데브옵스',
      /\bsre\b/,
      'site reliability',
      'infra',
      '인프라',
      'platform engineer',
      '플랫폼 엔지니어',
      'cloud engineer',
      '클라우드 엔지니어',
    ],
  },
  {
    category: 'data_ai',
    patterns: [
      'machine learning',
      '머신러닝',
      '딥러닝',
      'deep learning',
      /\bml\b/,
      /\bai\b/,
      /\bllm\b/,
      'mlops',
      'data engineer',
      '데이터 엔지니어',
      'data scientist',
      '데이터 사이언티스트',
      /\bnlp\b/,
      'computer vision',
      '인공지능',
    ],
  },
  {
    category: 'qa',
    patterns: [/\bqa\b/, 'quality assurance', 'quality engineer', 'test engineer', '테스트 엔지니어', /\bsdet\b/],
  },
  {
    category: 'game',
    patterns: [
      '게임 개발',
      '게임개발',
      '게임 클라이언트',
      '게임 서버',
      'game developer',
      'game engineer',
      'game client',
      'game server',
      'unity',
      '유니티',
      'unreal',
      '언리얼',
    ],
  },
];

/**
 * 제목에 박혀 있으면 그 자체로 직무를 가리키는 카테고리 — 아래 MODIFIER_PRONE_CATEGORIES와
 * 같이 걸렸을 때 이쪽을 택한다.
 */
const SPECIFIC_ROLE_CATEGORIES: ReadonlySet<Category> = new Set([
  'frontend',
  'backend',
  'mobile',
]);

/**
 * 직무가 아니라 도메인·수식어로 쓰이는 일이 많아 다른 직군 제목에 얹혀 오매칭되는 카테고리.
 * devops는 'platform engineer'·'infra', data_ai는 /\bai\b/가 주범이다.
 *
 * 올리브영 실사례(2026-07-30) "[AI-First Track] Commerce Platform Engineer (Front-End)"는
 * 'ai'(채용 트랙 이름) + 'platform engineer' + 'front end'로 3중 매칭돼 LLM 폴백으로 넘어갔고,
 * Groq이 실패해 공고가 저장되지 않았다. 여기서 직무는 분명히 frontend다.
 */
const MODIFIER_PRONE_CATEGORIES: ReadonlySet<Category> = new Set(['devops', 'data_ai']);

/** 대소문자·하이픈 정규화: 소문자화 + 하이픈류/슬래시 → 공백 ("Front-End" → "front end") */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[-_/·|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 키워드 규칙 1차 분류 (순수 함수).
 * - 풀스택 키워드가 있으면 fullstack 우선 (복수 매칭 우선순위 규칙)
 * - frontend/backend/mobile이 devops·data_ai와 함께 걸리면 그쪽 우선
 *   (수식어성 오매칭 — SPECIFIC_ROLE_CATEGORIES 주석 참고)
 * - 정확히 하나의 카테고리에만 걸리면 그 카테고리
 * - 무매칭 또는 복수 카테고리 매칭(애매) → null (LLM 폴백으로 — 보수적 설계)
 */
export function classifyByKeywords(title: string): Category | null {
  const normalized = normalizeTitle(title);
  const matched = new Set<Category>();
  for (const rule of KEYWORD_RULES) {
    const hit = rule.patterns.some((pattern) =>
      typeof pattern === 'string' ? normalized.includes(pattern) : pattern.test(normalized),
    );
    if (hit) matched.add(rule.category);
  }
  if (matched.has('fullstack')) return 'fullstack';
  // 구체적 직군 하나 + 수식어성 카테고리들만 걸렸으면 구체적인 쪽. 구체적 직군이 둘 이상이거나
  // (예: 'Frontend/Backend Engineer') qa·game이 섞였으면 판단을 미룬다 (LLM 폴백).
  const specific = [...matched].filter((category) => SPECIFIC_ROLE_CATEGORIES.has(category));
  const rest = [...matched].filter((category) => !SPECIFIC_ROLE_CATEGORIES.has(category));
  if (specific.length === 1 && rest.every((category) => MODIFIER_PRONE_CATEGORIES.has(category))) {
    return specific[0] ?? null;
  }
  if (matched.size === 1) {
    const [only] = matched;
    return only ?? null;
  }
  return null;
}

const llmCategorySchema = z.object({
  category: z.enum([...CATEGORIES, 'non_dev'] as const),
});

const CATEGORY_SYSTEM_PROMPT = `너는 채용 공고가 어떤 소프트웨어 개발 직군인지 분류하는 도구다. 공고 제목(과 설명)을 보고 category를 반드시 아래 값 중 하나로 답하라.

- frontend: 웹 프론트엔드 개발
- backend: 서버/백엔드 개발
- fullstack: 풀스택 (프론트+백 모두)
- mobile: 모바일 앱 개발 (iOS/Android/크로스플랫폼)
- devops: DevOps/SRE/인프라/플랫폼 엔지니어링
- data_ai: 데이터 엔지니어링/데이터 사이언스/ML·AI
- qa: QA/테스트 엔지니어링
- game: 게임 개발 (게임 클라이언트/게임 서버/게임 엔진, Unity/Unreal)
- etc_dev: 개발 직군이 맞지만 위 세부 분류가 애매한 경우 (예: Product Engineer, 임베디드, 보안 엔지니어)
- non_dev: 개발 직군이 아님 (디자인, PM/PO, 마케팅, 영업, 재무, 법무, 인사, CS 등)

주의: 분류가 애매하다고 non_dev로 답하지 마라. 개발 직군인지 아닌지가 기준이고, 개발인데 세부 분류만 애매하면 etc_dev다.`;

export interface CategoryLlmOptions {
  model: string;
  baseUrl: string;
  apiKey: string;
  /** 테스트용 fetch 주입 */
  fetchImpl?: typeof fetch;
}

/**
 * classifyCategory (스펙 7-7): 키워드 규칙 → 안 걸리면 LLM 폴백.
 */
export async function classifyCategory(
  title: string,
  description: string | undefined,
  llm: CategoryLlmOptions,
): Promise<CategoryDecision> {
  const byKeyword = classifyByKeywords(title);
  if (byKeyword) return byKeyword;

  const userPrompt = description
    ? `공고 제목: ${title}\n\n공고 설명:\n${description.slice(0, 3000)}`
    : `공고 제목: ${title}`;
  const result = await completeStructured({
    model: llm.model,
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    systemPrompt: CATEGORY_SYSTEM_PROMPT,
    userPrompt,
    schema: llmCategorySchema,
    schemaName: 'job_category',
    temperature: 0,
    ...(llm.fetchImpl && { fetchImpl: llm.fetchImpl }),
  });
  return result.category;
}
