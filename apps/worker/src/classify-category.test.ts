import { describe, expect, it } from 'vitest';
import { LlmRateLimitError } from '@job-tracker/shared';
import {
  EXCLUDED_CATEGORIES,
  classifyByKeywords,
  classifyCategory,
  isQuotaExhausted,
  normalizeTitle,
} from './classify-category';

describe('normalizeTitle', () => {
  it('소문자화 + 하이픈/슬래시를 공백으로 정규화한다', () => {
    expect(normalizeTitle('Software Engineer, Front-End')).toBe(
      'software engineer, front end',
    );
    expect(normalizeTitle('DevOps/SRE Engineer')).toBe('devops sre engineer');
  });
});

describe('classifyByKeywords', () => {
  it('스펙 예시 표기 변형을 모두 frontend로 분류한다', () => {
    expect(classifyByKeywords('웹 프론트엔드 개발자')).toBe('frontend');
    expect(classifyByKeywords('FE Engineer')).toBe('frontend');
    expect(classifyByKeywords('Software Engineer, Front-End')).toBe('frontend');
    expect(classifyByKeywords('Frontend Developer')).toBe('frontend');
  });

  it('backend 키워드를 분류한다', () => {
    expect(classifyByKeywords('백엔드 개발자')).toBe('backend');
    expect(classifyByKeywords('Back-end Engineer (Java)')).toBe('backend');
    expect(classifyByKeywords('서버 개발자')).toBe('backend');
  });

  it('풀스택 키워드가 있으면 다른 매칭보다 fullstack 우선', () => {
    expect(classifyByKeywords('풀스택 개발자 (프론트엔드 중심)')).toBe('fullstack');
    expect(classifyByKeywords('Full-Stack Engineer')).toBe('fullstack');
  });

  it('mobile 키워드를 분류한다', () => {
    expect(classifyByKeywords('Android 개발자')).toBe('mobile');
    expect(classifyByKeywords('iOS Engineer')).toBe('mobile');
    expect(classifyByKeywords('React Native Developer')).toBe('mobile');
    expect(classifyByKeywords('모바일 앱 개발자')).toBe('mobile');
    expect(classifyByKeywords('Mobile Engineer')).toBe('mobile');
  });

  it("'모바일' 단독은 비개발 영업/마케팅에 오매칭하지 않는다 (LLM 폴백)", () => {
    // 헥토 실사례: '모바일쿠폰 영업(B2B)'이 mobile로 오분류되던 것을 막는다
    expect(classifyByKeywords('모바일쿠폰 영업(B2B)')).toBeNull();
    expect(classifyByKeywords('모바일 상품권 마케팅')).toBeNull();
    // '프론트' 단독도 마찬가지 — 프론트데스크/프론트오피스 오매칭 방지
    expect(classifyByKeywords('프론트데스크 매니저')).toBeNull();
  });

  it('devops 키워드를 분류한다', () => {
    expect(classifyByKeywords('DevOps Engineer')).toBe('devops');
    expect(classifyByKeywords('SRE')).toBe('devops');
    expect(classifyByKeywords('플랫폼 엔지니어')).toBe('devops');
    expect(classifyByKeywords('Infrastructure Engineer')).toBe('devops');
  });

  it('data_ai 키워드를 분류한다', () => {
    expect(classifyByKeywords('Machine Learning Engineer')).toBe('data_ai');
    expect(classifyByKeywords('데이터 엔지니어')).toBe('data_ai');
    expect(classifyByKeywords('AI Research Engineer')).toBe('data_ai');
    expect(classifyByKeywords('MLOps 엔지니어')).toBe('data_ai');
  });

  it('qa 키워드를 분류한다', () => {
    expect(classifyByKeywords('QA Engineer')).toBe('qa');
    expect(classifyByKeywords('테스트 엔지니어')).toBe('qa');
  });

  it('단어 경계를 지킨다 — FEATURE/HTML/OpenAI 같은 단어에 오매칭하지 않는다', () => {
    expect(classifyByKeywords('Feature Team Lead')).toBeNull();
    expect(classifyByKeywords('HTML Publisher')).toBeNull();
    expect(classifyByKeywords('OpenAPI Specialist')).toBeNull();
  });

  it('확신 없으면 null (LLM 폴백) — 무매칭', () => {
    expect(classifyByKeywords('Product Engineer')).toBeNull();
    expect(classifyByKeywords('프로덕트 디자이너')).toBeNull(); // 비개발 판정도 LLM 몫
    expect(classifyByKeywords('재무 회계 담당자')).toBeNull();
  });

  it('frontend/backend/mobile이 devops·data_ai와 같이 걸리면 그쪽 우선', () => {
    // 올리브영 실사례: 'ai'(트랙 이름) + 'platform engineer' + 'front end'로 3중 매칭돼 LLM 폴백으로
    // 넘어갔고, Groq이 실패해 공고가 저장되지 않았다 (2026-07-30). 제목에 Front-End가 박혀 있으면 frontend다.
    expect(classifyByKeywords('[AI-First Track] Commerce Platform Engineer (Front-End)')).toBe(
      'frontend',
    );
    expect(classifyByKeywords('[AI-First Track] Core Platform Engineer (Back-End)')).toBe(
      'backend',
    );
    expect(classifyByKeywords('모바일 앱 플랫폼 엔지니어')).toBe('mobile');
    expect(classifyByKeywords('AI Software Engineer-Backend')).toBe('backend');
  });

  it('확신 없으면 null (LLM 폴백) — 복수 카테고리 매칭', () => {
    // 풀스택 키워드 없이 프론트+백 동시 언급 → 애매 → LLM
    expect(classifyByKeywords('Frontend/Backend Engineer')).toBeNull();
    // devops + data_ai끼리 겹치면 어느 쪽인지 제목만으로 단정할 수 없다 — 우선순위 규칙 대상이 아니다
    expect(classifyByKeywords('데이터 엔지니어 (인프라 플랫폼)')).toBeNull();
    // qa가 섞인 경우도 그대로 LLM에 맡긴다
    expect(classifyByKeywords('백엔드 QA 자동화 엔지니어')).toBeNull();
  });
});

describe('classifyCategory (LLM 폴백)', () => {
  const llmOptions = (content: unknown) => ({
    model: 'test-model',
    baseUrl: 'https://llm.test/v1',
    apiKey: 'test-key',
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) } }],
        }),
        { status: 200 },
      )) as typeof fetch,
  });

  it('키워드에 걸리면 LLM을 호출하지 않는다', async () => {
    let called = false;
    const result = await classifyCategory('백엔드 개발자', undefined, {
      model: 'm',
      baseUrl: 'https://llm.test/v1',
      apiKey: 'k',
      fetchImpl: (async () => {
        called = true;
        throw new Error('should not be called');
      }) as typeof fetch,
    });
    expect(result).toBe('backend');
    expect(called).toBe(false);
  });

  it('키워드 무매칭이면 LLM 폴백 결과를 반환한다', async () => {
    const result = await classifyCategory(
      'Product Engineer',
      '고객 문제를 풀스펙트럼으로 해결하는 엔지니어',
      llmOptions({ category: 'etc_dev' }),
    );
    expect(result).toBe('etc_dev');
  });

  it('LLM이 non_dev로 판정하면 그대로 반환한다 (버릴지는 오케스트레이터 정책)', async () => {
    const result = await classifyCategory(
      '프로덕트 디자이너',
      undefined,
      llmOptions({ category: 'non_dev' }),
    );
    expect(result).toBe('non_dev');
  });
});

describe('EXCLUDED_CATEGORIES', () => {
  it('qa는 수집 대상에서 제외한다', () => {
    expect(EXCLUDED_CATEGORIES.has('qa')).toBe(true);
    expect(EXCLUDED_CATEGORIES.has('backend')).toBe(false);
  });
});

describe('isQuotaExhausted', () => {
  it('한도 소진 429만 브레이커를 내린다', () => {
    expect(isQuotaExhausted(new LlmRateLimitError('daily', true, 276))).toBe(true);
  });

  it('일시적 스로틀 429는 브레이커를 내리지 않는다', () => {
    expect(isQuotaExhausted(new LlmRateLimitError('throttled', false, 4))).toBe(false);
  });

  it('429가 아닌 에러는 브레이커를 내리지 않는다', () => {
    expect(isQuotaExhausted(new Error('LLM request failed: 429 (본문에만 429)'))).toBe(
      false,
    );
    expect(isQuotaExhausted(new Error('boom'))).toBe(false);
    expect(isQuotaExhausted(undefined)).toBe(false);
  });
});
