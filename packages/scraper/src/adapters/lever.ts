import { z } from 'zod';
import type { LeverConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';

/**
 * lever 어댑터 — 공개 API https://api.lever.co/v0/postings/{site}?mode=json
 * 실측(2026-07, site=mistral/palantir): 최상위가 posting 배열이고
 * text(제목)/hostedUrl/categories/descriptionPlain 필드를 갖는다. 마감일은 제공하지 않는다.
 */

const leverPostingSchema = z.object({
  text: z.string(),
  hostedUrl: z.string(),
  descriptionPlain: z.string().nullish(),
  categories: z
    .object({
      team: z.string().nullish(),
      location: z.string().nullish(),
      commitment: z.string().nullish(),
    })
    .nullish(),
});

export const leverResponseSchema = z.array(leverPostingSchema);

/** 실제 API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseLeverResponse(data: unknown): ScrapeResult[] {
  return leverResponseSchema.parse(data).map((posting) => ({
    title: posting.text,
    url: posting.hostedUrl,
    ...(posting.descriptionPlain && { description: posting.descriptionPlain }),
  }));
}

export const scrapeLever: ScrapeAdapter<LeverConfig> = async (config) => {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(config.site)}?mode=json`;
  return parseLeverResponse(await fetchJson(url));
};
