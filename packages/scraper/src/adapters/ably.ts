import { z } from 'zod';
import type { AblyConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { extractNextData, toIsoDate } from '../next-data';

/**
 * 에이블리 어댑터 — ably.team/recruit 전용 (실측 2026-07).
 *
 * 백엔드는 ninehire(지원은 tydtr0dj.ninehire.site/job_posting/{id})지만, ninehire 테넌트
 * 홈페이지가 꺼져 있어(루트가 /404) 표준 ninehire 어댑터로 목록을 못 얻는다 — 쏘카·숨고와 같은 상황.
 * 대신 자체 채용페이지가 Cloudflare 없이 평문 fetch 200으로 열리고, 전 공고가
 * __NEXT_DATA__ props.pageProps.recruits에 title·applyUrl(ninehire 정본)·deadline까지 들어 있다.
 * 저장용 URL은 recruits[].applyUrl(ninehire 상세)을 그대로 쓴다.
 */

const ablyRecruitSchema = z.object({
  title: z.string(),
  /** 지원(상세) 정본 URL — https://{tenant}.ninehire.site/job_posting/{id} */
  applyUrl: z.string().url(),
  /** in_progress / closed 등 — 마감 공고를 걸러내는 데 쓴다 */
  status: z.string(),
  /** 마감일 — open_ended/until_filled면 null */
  deadline: z.string().nullish(),
});
const ablyNextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      recruits: z.array(ablyRecruitSchema),
    }),
  }),
});

/**
 * 자체 채용페이지 HTML의 __NEXT_DATA__에서 진행 중(in_progress) 공고를 뽑는다
 * (fixture 테스트 대상 순수 함수). 하나도 없으면 조용히 빈 배열을 내지 않고 throw한다.
 */
export function parseAblyRecruitPage(html: string): ScrapeResult[] {
  const data = ablyNextDataSchema.parse(extractNextData(html));
  const results = data.props.pageProps.recruits
    .filter((recruit) => recruit.status === 'in_progress')
    .map((recruit): ScrapeResult => ({
      title: recruit.title,
      url: recruit.applyUrl,
      ...(recruit.deadline && { deadline: toIsoDate(recruit.deadline) }),
    }));
  if (results.length === 0) {
    throw new Error('ably: no in_progress recruits found in __NEXT_DATA__');
  }
  return results;
}

export const scrapeAbly: ScrapeAdapter<AblyConfig> = async (config) => {
  return parseAblyRecruitPage(await fetchText(config.url));
};
