import { z } from 'zod';
import type { MillieConfig } from '@job-tracker/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { extractNextData } from '../next-data';
import { parseGreetingOpeningDetail } from './greeting';

/**
 * 밀리의서재 어댑터 — www.millie.town/careers 전용 (실측 2026-08).
 *
 * 백엔드는 greeting이지만 채용페이지를 꺼둔 테넌트다 (millie.career.greetinghr.com/ko는 404).
 * 그래서 greeting 어댑터를 쓸 수 없다 — 숨고와 같은 상황이라 같은 방식을 쓴다:
 * 자사 채용페이지를 목록 출처로, 공고 상세는 살아 있는 greeting 도메인({origin}/o/{id})에서 읽는다.
 *
 * 목록은 자사 페이지의 __NEXT_DATA__ props.pageProps.data에 통째로 들어 있다
 * (실측 10건, totalPage 1). link_addr은 /o/{id}와 /ko/o/{id}가 섞여 있어 openingId만 뽑아
 * {origin}/o/{id}로 통일한다 — 표기가 흔들리면 content_hash가 어긋나 기존 공고가 닫힌다.
 */

const CAREER_ORIGIN = 'https://millie.career.greetinghr.com';

const millieRecruitSchema = z.object({
  title: z.string(),
  /** 공고 상세 링크 — greeting 도메인. /o/{id} 또는 /ko/o/{id} */
  link_addr: z.string(),
});

const millieNextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      data: z.object({
        /** 페이지가 스스로 밝히는 공고 수 — 파싱이 조용히 깨지는 것을 잡는 체크섬 */
        totalCount: z.number(),
        totalPage: z.number(),
        result: z.array(millieRecruitSchema),
      }),
    }),
  }),
});

const OPENING_ID_PATTERN = /\/o\/(\d+)/;

export interface MilliePosting {
  openingId: string;
  url: string;
}

/**
 * 자사 채용페이지 HTML에서 공고 목록을 뽑는다 (fixture 테스트 대상 순수 함수).
 * 제목은 여기서 쓰지 않는다 — 목록 카드와 greeting 상세의 제목이 다른 경우가 있어
 * 상세를 정본으로 삼는다 (실측: 목록 '백엔드 개발자' vs 상세 '백엔드 엔지니어').
 */
export function parseMillieCareerPage(html: string): MilliePosting[] {
  const { totalCount, totalPage, result } =
    millieNextDataSchema.parse(extractNextData(html)).props.pageProps.data;

  // 페이지네이션이 생기면 1페이지만 긁고 나머지를 "사라진 공고"로 닫아버린다 — 조용히 넘기지 않는다
  if (totalPage > 1) {
    throw new Error(`millie: page 1 of ${totalPage} — pagination appeared, adapter needs updating`);
  }
  if (totalCount !== result.length) {
    throw new Error(
      `millie: page says ${totalCount} postings but got ${result.length} — markup changed?`,
    );
  }
  if (result.length === 0) {
    throw new Error('millie: no postings found in career page __NEXT_DATA__');
  }

  return result.map((recruit) => {
    const openingId = recruit.link_addr.match(OPENING_ID_PATTERN)?.[1];
    if (!openingId) {
      throw new Error(`millie: unexpected link_addr "${recruit.link_addr}" for "${recruit.title}"`);
    }
    return { openingId, url: `${CAREER_ORIGIN}/o/${openingId}` };
  });
}

export const scrapeMillie: ScrapeAdapter<MillieConfig> = async (config) => {
  const postings = parseMillieCareerPage(await fetchText(config.url));

  // 제목·마감일·본문은 목록에 없거나 믿을 수 없어 공고당 상세 1회 요청 (실측 10건)
  return Promise.all(
    postings.map(async (posting): Promise<ScrapeResult> => {
      const detail = parseGreetingOpeningDetail(
        await fetchText(`${CAREER_ORIGIN}/ko/o/${posting.openingId}`),
      );
      return {
        title: detail.title,
        url: posting.url,
        ...(detail.description && { description: detail.description }),
        ...(detail.deadline && { deadline: detail.deadline }),
      };
    }),
  );
};
