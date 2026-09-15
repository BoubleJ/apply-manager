import { z } from 'zod';
import type { DealiciousConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';
import { toIsoDate } from '../next-data';

/**
 * 딜리셔스 어댑터 — www.dealicious.kr/career 전용 (실측 2026-07).
 *
 * 백엔드는 greeting(공고 정본이 dealicious.career.greetinghr.com/o/{id})이지만 greeting
 * 채용페이지(목록)가 꺼져 있어(홈이 __NEXT_DATA__ openings를 안 준다) greeting 목록 어댑터를
 * 못 쓴다 — 쏘카·숨고·에이블리와 같은 상황. 대신 자체 채용페이지가 같은 origin의
 * /api/openings(0-based 페이지네이션)를 호출해 공고를 받고, 각 공고 객체의 url 필드에
 * greeting 정본(/o/{id})이 들어 있어 그걸 저장용 URL로 그대로 쓴다.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const dealiciousOpeningSchema = z.object({
  id: z.number(),
  title: z.string(),
  /** greeting 공고 정본 URL(스킴 없음) — dealicious.career.greetinghr.com/o/{id} */
  url: z.string(),
  /** 마감일(ISO 타임스탬프) — 상시채용이면 null */
  dueDate: z.string().nullish(),
  /** 채용페이지 노출 여부 — false면 숨긴 공고 */
  activatedAtCareerPage: z.boolean().nullish(),
});
export const dealiciousResponseSchema = z.object({
  data: z.object({
    datas: z.array(dealiciousOpeningSchema),
    totalCount: z.number(),
    hasNext: z.boolean().nullish(),
  }),
});

/** /api/openings 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseDealiciousResponse(data: unknown): ScrapeResult[] {
  return dealiciousResponseSchema
    .parse(data)
    .data.datas.filter((opening) => opening.activatedAtCareerPage !== false)
    .map((opening): ScrapeResult => ({
      title: opening.title,
      // greeting 정본 URL을 저장 — 스킴이 없으면 https를 붙인다
      url: /^https?:\/\//.test(opening.url) ? opening.url : `https://${opening.url}`,
      ...(opening.dueDate && { deadline: toIsoDate(opening.dueDate) }),
    }));
}

export const scrapeDealicious: ScrapeAdapter<DealiciousConfig> = async (config) => {
  const { origin } = new URL(config.url);
  const results: ScrapeResult[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const parsed = dealiciousResponseSchema.parse(
      await fetchJson(`${origin}/api/openings?page=${page}&size=${PAGE_SIZE}`),
    );
    results.push(...parseDealiciousResponse(parsed));
    if (!parsed.data.hasNext || parsed.data.datas.length === 0) break;
  }
  return results;
};
