import { z } from 'zod';
import type { JobflexConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';

/**
 * JOBFLEX(마이다스인 recruiter.co.kr) 어댑터.
 *
 * 실측(2026-07, midas.recruiter.co.kr): 페이지는 Next.js CSR이라 HTML에 공고가 없고,
 * POST https://api-recruiter.recruiter.co.kr/position/v1/jobflex 로 목록을 가져온다.
 * 테넌트 식별은 `prefix` 헤더(채용페이지 호스트). page는 1부터 시작.
 * submissionStatus: PRE_SUBMISSION(접수 전)/IN_SUBMISSION(접수 중)/POST_SUBMISSION(접수 마감)
 * — 마감 공고도 목록에 남아 있으므로 POST_SUBMISSION은 제외한다.
 * 공고 상세 URL은 {origin}/career/jobs/{positionSn} (실측 200 확인).
 */

const JOBFLEX_API_URL = 'https://api-recruiter.recruiter.co.kr/position/v1/jobflex';
const PAGE_SIZE = 100;

const jobflexPositionSchema = z.object({
  positionSn: z.number(),
  title: z.string(),
  submissionStatus: z.string(),
  openStatus: z.string().nullish(),
  /** 마감 일시 — 상시채용이면 null */
  endDateTime: z.string().nullish(),
  tagList: z.array(z.object({ tagName: z.string() })).nullish(),
});

const jobflexResponseSchema = z.object({
  pagination: z.object({ totalPages: z.number() }),
  list: z.array(jobflexPositionSchema),
});

type JobflexPosition = z.infer<typeof jobflexPositionSchema>;

/** API 응답의 공고 목록을 ScrapeResult로 변환한다 (테스트 대상 순수 함수). */
export function mapJobflexPositions(
  positions: JobflexPosition[],
  origin: string,
): ScrapeResult[] {
  return positions
    .filter(
      (position) =>
        position.submissionStatus !== 'POST_SUBMISSION' && position.openStatus !== 'CLOSED',
    )
    .map((position) => {
      const tags = (position.tagList ?? []).map((tag) => tag.tagName);
      return {
        title: position.title,
        url: `${origin}/career/jobs/${position.positionSn}`,
        ...(tags.length > 0 && { description: tags.join(', ') }),
        ...(position.endDateTime && { deadline: position.endDateTime.slice(0, 10) }),
      };
    });
}

export const scrapeJobflex: ScrapeAdapter<JobflexConfig> = async (config) => {
  const pageUrl = new URL(config.url);
  const results: ScrapeResult[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(JOBFLEX_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        prefix: pageUrl.host,
      },
      body: JSON.stringify({ pageableRq: { page, size: PAGE_SIZE }, filter: {} }),
    });
    if (!res.ok) {
      throw new Error(`jobflex: API request failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const parsed = jobflexResponseSchema.parse(await res.json());
    results.push(...mapJobflexPositions(parsed.list, pageUrl.origin));
    if (page >= parsed.pagination.totalPages) break;
  }
  return results;
};
