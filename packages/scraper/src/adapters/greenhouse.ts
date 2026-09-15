import { z } from 'zod';
import type { GreenhouseConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';

/**
 * greenhouse 어댑터 — 공개 API https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs
 * 실측(2026-07, boardToken=stripe): { jobs: [...], meta: { total } } 형태이고
 * jobs[].title / absolute_url / location.name / application_deadline(대부분 null)을 갖는다.
 */

const greenhouseJobSchema = z.object({
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  application_deadline: z.string().nullish(),
});

export const greenhouseResponseSchema = z.object({
  jobs: z.array(greenhouseJobSchema),
});

/** 실제 API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseGreenhouseResponse(data: unknown): ScrapeResult[] {
  return greenhouseResponseSchema.parse(data).jobs.map((job) => ({
    title: job.title,
    url: job.absolute_url,
    ...(job.location?.name && { description: job.location.name }),
    ...(job.application_deadline && {
      deadline: job.application_deadline.slice(0, 10),
    }),
  }));
}

export const scrapeGreenhouse: ScrapeAdapter<GreenhouseConfig> = async (config) => {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.boardToken)}/jobs`;
  return parseGreenhouseResponse(await fetchJson(url));
};
