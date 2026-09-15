import { z } from 'zod';
import type { NaverConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson, fetchText } from '../fetch';
import { htmlToText } from '../html';

/**
 * 네이버 계열 자체 채용페이지 어댑터 — recruit.navercorp.com / recruit.snowcorp.com
 * (같은 rcrt 플랫폼이라 호스트만 다르다. 실측 2026-07.)
 *
 * 목록 페이지(/rcrt/list.do)는 CSR이라 HTML에 공고가 없고, 페이지 JS가 같은 호스트의
 * /rcrt/loadJobList.do를 호출해 JSON을 받는다 (페이지 인라인 스크립트의 $.ajax url로 실측 확인).
 * list.do의 쿼리스트링(subJobCdArr 등 직군 필터)이 그대로 loadJobList.do로 전달되므로
 * config.url의 쿼리를 그대로 넘긴다.
 *
 * 공고 상세는 SSR이라 {origin}/rcrt/view.do?annoId={id}&lang=ko HTML에 본문이 들어 있다.
 */

/** list.do 인라인 스크립트의 pageSize. 이 값보다 크게 넘기면 중간 페이지를 통째로 건너뛴다. */
const PAGE_SIZE = 10;
const MAX_PAGES = 50;

/**
 * 상시채용을 나타내는 sentinel 마감일(실측: KREAM 공고 endYmd=29991231).
 * 그대로 두면 "2999-12-31 마감"으로 표시되므로 마감일 없음으로 취급한다.
 */
const SENTINEL_DEADLINE_YEAR = 2900;

const naverJobSchema = z.object({
  annoId: z.number(),
  annoSubject: z.string(),
  /** 접수 마감일 (YYYYMMDD) */
  endYmd: z.string().nullish(),
});

export const naverResponseSchema = z.object({
  list: z.array(naverJobSchema),
});

/** "20260720" → "2026-07-20". sentinel(2999년 등)·형식 불일치면 undefined. */
function toDeadline(endYmd: string | null | undefined): string | undefined {
  if (!endYmd || !/^\d{8}$/.test(endYmd)) return undefined;
  if (Number(endYmd.slice(0, 4)) >= SENTINEL_DEADLINE_YEAR) return undefined;
  return `${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}`;
}

/** loadJobList.do 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseNaverResponse(data: unknown, origin: string): ScrapeResult[] {
  return naverResponseSchema.parse(data).list.map((job) => {
    const deadline = toDeadline(job.endYmd);
    return {
      title: job.annoSubject,
      url: `${origin}/rcrt/view.do?annoId=${job.annoId}&lang=ko`,
      ...(deadline && { deadline }),
    };
  });
}

/**
 * view.do HTML에서 공고 본문(div.detail_wrap)만 평문으로 뽑는다 (fixture 테스트 대상 순수 함수).
 * detail_wrap은 중첩 div가 많아 닫는 태그를 짝지을 수 없으므로 푸터 직전까지를 본문으로 본다.
 * 구조가 바뀌어 detail_wrap을 못 찾으면 조용히 빈 설명을 내지 않고 undefined를 반환한다.
 */
export function extractNaverDescription(html: string): string | undefined {
  const start = html.search(/<div[^>]*class="[^"]*\bdetail_wrap\b[^"]*"/i);
  if (start === -1) return undefined;
  const rest = html.slice(start);
  const end = rest.search(/<footer\b/i);
  const text = htmlToText(end === -1 ? rest : rest.slice(0, end));
  return text || undefined;
}

export const scrapeNaver: ScrapeAdapter<NaverConfig> = async (config) => {
  const listUrl = new URL(config.url);
  const { origin } = listUrl;
  const query = listUrl.searchParams;

  const results: ScrapeResult[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    query.set('firstIndex', String(page * PAGE_SIZE));
    const data = await fetchJson(`${origin}/rcrt/loadJobList.do?${query.toString()}`);
    const parsed = parseNaverResponse(data, origin);
    results.push(...parsed);
    if (parsed.length < PAGE_SIZE) break;
  }

  // 상세는 공고당 1회 요청 — 직군 필터가 걸린 목록이라 건수가 작다 (실측 네이버 7건, 스노우 9건).
  return Promise.all(
    results.map(async (result) => {
      const description = extractNaverDescription(await fetchText(result.url));
      return { ...result, ...(description && { description }) };
    }),
  );
};
