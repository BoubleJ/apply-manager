import { z } from 'zod';
import type { SocarConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { extractNextData } from '../next-data';
import { parseGreetingOpeningDetail } from './greeting';

/**
 * 쏘카(+ 자회사 나인투원) 어댑터 — www.socarcorp.kr/careers/jobs 전용 (실측 2026-07).
 *
 * 백엔드는 greeting이지만 그리팅 채용페이지(목록)를 꺼둔 테넌트다 — 숨고와 같은 상황
 * (socar.career.greetinghr.com/ko 등 목록 URL은 404, 상세 /ko/o/{id}만 살아 있음).
 * 그래서 greeting 목록 어댑터를 쓸 수 없다.
 *
 * 목록은 자체 채용페이지의 __NEXT_DATA__(props.pageProps.jobList.jsonResult.data)에
 * greeting 상세 링크(notice_url)와 함께 들어 있고, 공고 상세는 greeting 도메인
 * ({origin}/ko/o/{id})이 그대로 살아 있어 거기서 정식 제목·마감일·본문을 얻는다.
 * 제목을 greeting 원본에서 뽑으므로 llm 폴백 전략의 제목 흔들림(플리커)이 없다.
 */

const socarJobSchema = z.object({
  title: z.string(),
  /** greeting 공고 상세 URL — https://{tenant}.career.greetinghr.com/(ko/)o/{id} */
  notice_url: z.string(),
});
const socarNextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      jobList: z.object({
        jsonResult: z.object({
          data: z.array(socarJobSchema),
        }),
      }),
    }),
  }),
});

export interface SocarPosting {
  openingId: string;
  /** 목록 카드 제목 (어댑터는 상세의 정식 제목으로 덮어쓴다) */
  title: string;
  /** 저장용 정본 URL — greeting 어댑터와 같은 {origin}/o/{id} */
  url: string;
}

/**
 * 자체 채용페이지 HTML에서 greeting 공고 목록을 뽑는다 (fixture 테스트 대상 순수 함수).
 * greeting(/o/{id})이 아닌 링크는 건너뛰고, 하나도 남지 않으면 조용히 빈 배열을 내지 않고 throw한다.
 */
export function parseSocarCareerPage(html: string): SocarPosting[] {
  const nextData = socarNextDataSchema.parse(extractNextData(html));
  const postings: SocarPosting[] = [];
  // 목록에 같은 공고가 중복으로 들어오는 경우가 있어(실측) openingId로 중복 제거한다
  const seen = new Set<string>();
  for (const row of nextData.props.pageProps.jobList.jsonResult.data) {
    let url: URL;
    try {
      url = new URL(row.notice_url);
    } catch {
      console.warn(`[scraper:socar] skipped non-URL notice_url: "${row.title}" (${row.notice_url})`);
      continue;
    }
    const idMatch = url.pathname.match(/\/o\/(\d+)/);
    if (!/(^|\.)greetinghr\.com$/.test(url.hostname) || !idMatch) {
      console.warn(`[scraper:socar] skipped non-greeting posting: "${row.title}" (${row.notice_url})`);
      continue;
    }
    const openingId = idMatch[1] as string;
    if (seen.has(openingId)) continue;
    seen.add(openingId);
    postings.push({
      openingId,
      title: row.title,
      url: `${url.origin}/o/${openingId}`,
    });
  }
  if (postings.length === 0) {
    throw new Error('socar: no greeting postings found in __NEXT_DATA__ jobList');
  }
  return postings;
}

export const scrapeSocar: ScrapeAdapter<SocarConfig> = async (config) => {
  const postings = parseSocarCareerPage(await fetchText(config.url));

  // 마감일·본문·정식 제목은 목록에 없어 공고당 상세 1회 요청 (greeting 상세 재사용)
  const results = await Promise.all(
    postings.map(async (posting): Promise<ScrapeResult> => {
      const origin = new URL(posting.url).origin;
      const detail = parseGreetingOpeningDetail(
        await fetchText(`${origin}/ko/o/${posting.openingId}`),
      );
      return {
        // 제목은 상세(greeting 원본)를 정본으로 쓴다 — 목록 카드가 줄여 쓰는 경우가 있다
        title: detail.title,
        url: posting.url,
        ...(detail.description && { description: detail.description }),
        ...(detail.deadline && { deadline: detail.deadline }),
      };
    }),
  );
  return results;
};
