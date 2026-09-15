import { z } from 'zod';
import type { TossConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';
import { MAX_DESCRIPTION_LENGTH } from '../html';

/**
 * 토스 어댑터 — toss.im/career/jobs 전용 (실측 2026-08).
 *
 * 채용페이지가 CSR이라 HTML에는 공고가 없다 (__NEXT_DATA__의 job-list-container 쿼리가 null).
 * 페이지가 실제로 호출하는 공개 API를 그대로 쓴다 — 한 번에 전 공고(실측 417건)를 주고
 * 본문·자회사까지 들어 있어 상세 요청이 필요 없다. 백엔드는 Greenhouse지만
 * greenhouse 어댑터는 못 쓴다 (board token이 아니라 토스 자체 프록시를 통해서만 열려 있다).
 *
 * 토스는 계열사(토스뱅크·토스증권·토스페이먼츠 등) 공고를 이 보드 하나로 함께 받는다.
 * DB에는 회사가 '토스' 하나뿐이므로 제목 뒤에 자회사를 붙여 구분한다 —
 * 안 붙이면 목록에 'Frontend Developer'만 여러 개 뜨고 어느 계열사인지 알 수 없다.
 */

const TOSS_JOBS_API_URL = 'https://api-public.toss.im/api/v3/ipd-eggnog/career/jobs';

/** metadata는 이름이 곧 키인 배열이다 (Greenhouse 커스텀 필드 그대로) */
const SUBSIDIARY_FIELD = '포지션의 소속 자회사를 선택해 주세요.';
const DESCRIPTION_FIELD =
  'Job Description을 작성해 주세요.(작성 전, 채용 커뮤니케이션 가이드 노션을 꼭 참고해 주세요.)';
const DEADLINE_FIELD = '커리어페이지 채용공고 클로징 일자 (서류접수 마감일이 정해진 경우)';
const HIDDEN_FIELD = '커리어페이지 메뉴에 "미노출" 되어야 하는 Job인가요?';
const JOB_CATEGORY_FIELD = '커리어 페이지 노출 Job Category 값을 선택해주세요';

/**
 * 토스가 공고에 붙여둔 Job Category 중 개발과 무관한 값 — 여기서 미리 걷어낸다.
 *
 * 보통 직군 판정은 오케스트레이터(scrape-jobs) 몫이고 어댑터는 전부 넘긴다. 토스만 예외인 이유는
 * 규모다: 그룹 전 계열사 공고 400여 건이 이 보드 하나에 있고 그중 8할이 제목만으로 직군을 못 가려
 * LLM 폴백으로 간다. 비개발 공고는 저장되지 않아 매 실행 다시 분류되므로, 그대로 두면 크론 한 번에
 * Groq 일일 한도(TPD)의 두 배 넘는 토큰을 쓰고 Gmail 분류까지 굶긴다 (실측 2026-08: 328건 ≈ 49만 토큰).
 *
 * 그래서 안전한 방향으로만 거른다 — **모르는 값·빈 값은 통과**시켜 분류기에 맡긴다.
 * 개발 공고를 조용히 흘리는 것보다 LLM을 몇 번 더 쓰는 편이 낫다.
 * 대신 여기서 걸러진 공고는 scrape-jobs의 discarded 로그에 안 남는다.
 */
const NON_DEV_JOB_CATEGORIES: ReadonlySet<string> = new Set([
  'Accounting',
  'AML',
  'Bank',
  'Brand Design',
  'Community',
  'Compensation & Benefit',
  'Compliance',
  'Contents',
  'Corp.dev',
  'Customer',
  'Customer Support',
  'Finance',
  'GA',
  'HR',
  'Insurance',
  'IR',
  'IT General Admin',
  'Leadership',
  'Legal',
  'Marketing',
  'People System',
  'Platform Design',
  'PR',
  'Product Design',
  'Product Operations',
  'Product Ownership',
  'Recruiting',
  'Risk',
  'Sales',
  'Sales Support',
  'Securities',
  'Strategy',
  'UX',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const tossJobSchema = z.object({
  title: z.string(),
  /** 공고 상세 URL — toss.im/career/job-detail?gh_jid=... */
  absolute_url: z.url(),
  /** 값 타입이 필드마다 달라(single_select·문자열·배열) 문자열일 때만 읽는다 */
  metadata: z.array(z.object({ name: z.string(), value: z.unknown() })).nullish(),
});

export const tossResponseSchema = z.object({
  resultType: z.string(),
  success: z.array(tossJobSchema),
});

type TossJob = z.infer<typeof tossJobSchema>;

function stringField(job: TossJob, name: string): string | undefined {
  const found = job.metadata?.find((field) => field.name === name)?.value;
  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

/**
 * API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수).
 * 응답에 총 건수 필드가 없어 개수 체크섬을 걸 수 없다 — 대신 resultType과 빈 목록을 막는다.
 */
export function parseTossResponse(data: unknown): ScrapeResult[] {
  const { resultType, success } = tossResponseSchema.parse(data);
  if (resultType !== 'SUCCESS') {
    throw new Error(`toss: unexpected resultType "${resultType}"`);
  }

  const results = success.flatMap((job): ScrapeResult[] => {
    // 채용페이지에 안 띄우는 공고 (실측 2026-08에는 0건이나 필드는 전 공고에 있다)
    if (stringField(job, HIDDEN_FIELD) === 'True') return [];

    const jobCategory = stringField(job, JOB_CATEGORY_FIELD);
    if (jobCategory && NON_DEV_JOB_CATEGORIES.has(jobCategory)) return [];

    const subsidiary = stringField(job, SUBSIDIARY_FIELD);
    // 제목에 이미 계열사가 드러나면 덧붙이지 않는다 (예: '선임 보험총무(토스인슈어런스 직영)_전주')
    const title =
      subsidiary && !job.title.includes(subsidiary)
        ? `${job.title} (${subsidiary})`
        : job.title;
    const description = stringField(job, DESCRIPTION_FIELD)?.slice(0, MAX_DESCRIPTION_LENGTH);
    const deadline = stringField(job, DEADLINE_FIELD);

    return [
      {
        title,
        url: job.absolute_url,
        ...(description && { description }),
        ...(deadline && ISO_DATE.test(deadline) && { deadline }),
      },
    ];
  });

  if (results.length === 0) {
    throw new Error('toss: no postings in API response');
  }
  return results;
}

export const scrapeToss: ScrapeAdapter<TossConfig> = async () =>
  parseTossResponse(await fetchJson(TOSS_JOBS_API_URL));
