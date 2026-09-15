import { z } from 'zod';
import type { KakaoConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';
import { htmlToText, MAX_DESCRIPTION_LENGTH } from '../html';

/**
 * 카카오 자체 채용페이지 어댑터 — careers.kakao.com (실측 2026-07).
 *
 * 페이지는 CSR(React)이라 HTML이 빈 껍데기다. 목록은 공개 API
 * {origin}/public/api/job-list?part=...&company=...&page=N 가 내려준다 (totalPage로 페이징).
 * 목록의 introduction은 티저 수준이라, 상세 API
 * {origin}/public/api/job-detail?id={realId}&isAvailable=true 에서 업무/자격까지 합쳐 본문을 만든다.
 *
 * 공고 상세 URL은 {origin}/jobs/{realId} (realId는 "P-14469" 형태).
 * 목록 API가 계열사 공고까지 내려주므로 company 파라미터로 갈린다 — config.url의 쿼리를 그대로 넘긴다.
 */

const MAX_PAGES = 50;

const kakaoJobSchema = z.object({
  realId: z.string(),
  jobOfferTitle: z.string(),
  /** true면 마감된 공고 */
  closeFlag: z.boolean().nullish(),
  /** 마감일 — 상시채용이면 null */
  endDate: z.string().nullish(),
});

export const kakaoListResponseSchema = z.object({
  jobList: z.array(kakaoJobSchema),
  totalPage: z.number(),
});

export const kakaoDetailResponseSchema = z.object({
  introduction: z.string().nullish(),
  workContentDesc: z.string().nullish(),
  qualification: z.string().nullish(),
  krewComment: z.string().nullish(),
});

/** 목록 API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseKakaoListResponse(data: unknown, origin: string): ScrapeResult[] {
  return kakaoListResponseSchema
    .parse(data)
    .jobList.filter((job) => !job.closeFlag)
    .map((job) => ({
      title: job.jobOfferTitle,
      url: `${origin}/jobs/${job.realId}`,
      ...(job.endDate && { deadline: job.endDate.slice(0, 10) }),
    }));
}

/** 상세 API 응답(unknown)에서 본문을 조립한다 (fixture 테스트 대상 순수 함수). */
export function parseKakaoDetailResponse(data: unknown): string | undefined {
  const detail = kakaoDetailResponseSchema.parse(data);
  const sections: ReadonlyArray<readonly [string, string | null | undefined]> = [
    ['소개', detail.introduction],
    ['업무 내용', detail.workContentDesc],
    ['지원 자격', detail.qualification],
    ['크루 한마디', detail.krewComment],
  ];
  const text = sections
    .filter(([, html]) => html)
    .map(([label, html]) => `[${label}]\n${htmlToText(html as string)}`)
    .join('\n\n')
    .slice(0, MAX_DESCRIPTION_LENGTH);
  return text || undefined;
}

export const scrapeKakao: ScrapeAdapter<KakaoConfig> = async (config) => {
  const pageUrl = new URL(config.url);
  const { origin } = pageUrl;
  const query = pageUrl.searchParams;

  const results: ScrapeResult[] = [];
  let totalPage = 1;
  for (let page = 1; page <= totalPage && page <= MAX_PAGES; page++) {
    query.set('page', String(page));
    const data = await fetchJson(`${origin}/public/api/job-list?${query.toString()}`);
    totalPage = kakaoListResponseSchema.parse(data).totalPage;
    results.push(...parseKakaoListResponse(data, origin));
  }

  // 상세는 공고당 1회 요청 — 직군 필터가 걸린 목록이라 건수가 작다 (실측 TECHNOLOGY 8건).
  return Promise.all(
    results.map(async (result) => {
      const realId = result.url.slice(result.url.lastIndexOf('/') + 1);
      const description = parseKakaoDetailResponse(
        await fetchJson(
          `${origin}/public/api/job-detail?id=${encodeURIComponent(realId)}&isAvailable=true`,
        ),
      );
      return { ...result, ...(description && { description }) };
    }),
  );
};
