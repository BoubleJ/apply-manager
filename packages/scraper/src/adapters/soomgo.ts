import type { SoomgoConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { parseGreetingOpeningDetail } from './greeting';

/**
 * 숨고(브레이브모바일) 어댑터 — www.soomgo.team/career 전용 (실측 2026-07).
 *
 * 백엔드는 greeting이지만 채용페이지를 꺼둔 테넌트다 (soomgo.career.greetinghr.com/ko는 404).
 * 그래서 greeting 어댑터를 쓸 수 없다 — 뱅크샐러드와 같은 상황.
 *
 * greeting 공개 API(workspaces/2380/openings)도 신뢰할 수 없다 (실측):
 * 사이트에 없는 공고 6건(Backend Engineer 등)을 더 주는데 그 상세는 전부 404이고,
 * 사이트에 있는 3건(Data Scientist 등)은 빠뜨린다. 채용페이지를 끈 탓에 그쪽 데이터가
 * 갱신되지 않는 것으로 보인다. 따라서 자체 채용페이지를 유일한 목록 출처로 쓴다.
 *
 * 목록은 Next.js App Router의 RSC 플라이트 페이로드(self.__next_f)에 들어 있고,
 * 공고 상세는 greeting 도메인({origin}/o/{id})이 그대로 살아 있어 거기서 마감일·본문을 얻는다.
 */

const CAREER_ORIGIN = 'https://soomgo.career.greetinghr.com';

/** self.__next_f.push([1,"…"]) 청크들의 문자열을 이어붙여 RSC 플라이트 페이로드를 복원한다 */
function extractFlightPayload(html: string): string {
  const chunks = [
    ...html.matchAll(/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\[\s\S])*")\]\)/g),
  ];
  let payload = '';
  for (const chunk of chunks) {
    if (chunk[1]) payload += JSON.parse(chunk[1]) as string;
  }
  return payload;
}

/** 페이로드의 "posting":{"id":..,"title":..,"url":..} 조각 */
const POSTING_PATTERN =
  /"posting":\{"id":(\d+),"title":"((?:[^"\\]|\\.)*)","url":"([^"]+)"/g;
/** 페이지가 스스로 밝히는 공고 수 — 파싱이 조용히 깨지는 것을 잡는 체크섬 */
const COUNT_PATTERN = /(\d+)개의 채용 공고가 있습니다/;

export interface SoomgoPosting {
  openingId: string;
  title: string;
  url: string;
}

/**
 * 채용페이지 HTML에서 공고 목록을 뽑는다 (fixture 테스트 대상 순수 함수).
 * 페이지에 적힌 공고 수와 실제 추출 수가 다르면 마크업이 바뀐 것이므로 throw한다.
 */
export function parseSoomgoCareerPage(html: string): SoomgoPosting[] {
  const flight = extractFlightPayload(html);
  const postings = [...flight.matchAll(POSTING_PATTERN)].map((match) => ({
    openingId: match[1] as string,
    // 페이로드 안에서 한 번 더 이스케이프된 제목 (예: \"CX \\\"Lead\\\"\")
    title: JSON.parse(`"${match[2] as string}"`) as string,
    url: `${CAREER_ORIGIN}/o/${match[1] as string}`,
  }));

  const declared = flight.match(COUNT_PATTERN)?.[1];
  if (declared !== undefined && Number(declared) !== postings.length) {
    throw new Error(
      `soomgo: page says ${declared} postings but parsed ${postings.length} — markup changed?`,
    );
  }
  if (postings.length === 0) {
    throw new Error('soomgo: no postings found in career page payload');
  }
  return postings;
}

export const scrapeSoomgo: ScrapeAdapter<SoomgoConfig> = async (config) => {
  const postings = parseSoomgoCareerPage(await fetchText(config.url));

  // 마감일·본문은 목록에 없어 공고당 상세 1회 요청 (실측 11건)
  const results = await Promise.all(
    postings.map(async (posting): Promise<ScrapeResult> => {
      const detail = parseGreetingOpeningDetail(
        await fetchText(`${CAREER_ORIGIN}/ko/o/${posting.openingId}`),
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
