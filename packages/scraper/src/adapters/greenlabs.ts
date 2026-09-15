import { z } from 'zod';
import type { GreenlabsConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';
import { decodeHtmlEntities, htmlToText } from '../html';

/**
 * 그린랩스 어댑터 — greenlabs.co.kr 전용 (실측 2026-08).
 *
 * ATS를 쓰지 않는다. 자사 워드프레스가 곧 채용 게시판이고, 지원은 공고 본문의 구글 폼으로 받는다
 * (그래서 붙일 수 있는 기존 어댑터가 없다). 대신 WP REST가 열려 있어 recruit 커스텀 포스트 타입을
 * 그대로 읽으면 목록·제목·본문이 한 번에 나온다 — 목록 페이지 HTML은 탭 필터가 걸려 일부만 보이므로
 * 쓰지 않는다 (실측: HTML 2건 vs REST 3건).
 *
 * 마감일은 어디에도 없다 ('수시 진행으로 우수 인재 채용 시 마감' 문구뿐).
 * 제목은 워드프레스가 문장부호를 수치 엔티티(&#8211; 등)로 내보내므로 반드시 풀어서 쓴다 —
 * 안 풀면 목록에 날것의 엔티티가 그대로 보인다.
 */

/** 한 번에 받을 수 있는 최대치. 이 수만큼 오면 2페이지가 생겼다는 뜻이라 파싱을 멈춘다 */
const PER_PAGE = 100;

const greenlabsRecruitSchema = z.object({
  id: z.number(),
  /** 공고 상세 URL — {origin}/recruit/{퍼센트 인코딩된 slug}/ */
  link: z.url(),
  title: z.object({ rendered: z.string() }),
  content: z.object({ rendered: z.string() }),
  status: z.string(),
});

export const greenlabsResponseSchema = z.array(greenlabsRecruitSchema);

/** 목록 API URL — 채용페이지 URL의 호스트에서 만든다 */
export function greenlabsApiUrl(pageUrl: string): string {
  return `${new URL(pageUrl).origin}/wp-json/wp/v2/recruit?per_page=${PER_PAGE}&_fields=id,link,title,content,status`;
}

/**
 * WP REST 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수).
 * 응답에 총 건수 필드가 없어(헤더에만 있다) 개수 체크섬 대신 페이지네이션 발생을 막는다.
 */
export function parseGreenlabsResponse(data: unknown): ScrapeResult[] {
  const recruits = greenlabsResponseSchema.parse(data);

  // 2페이지가 생기면 1페이지만 긁고 나머지를 "사라진 공고"로 닫아버린다 — 조용히 넘기지 않는다
  if (recruits.length >= PER_PAGE) {
    throw new Error(
      `greenlabs: got ${recruits.length} postings (per_page=${PER_PAGE}) — pagination appeared, adapter needs updating`,
    );
  }

  const results = recruits
    .filter((recruit) => recruit.status === 'publish')
    .map((recruit): ScrapeResult => {
      const description = htmlToText(recruit.content.rendered);
      return {
        title: decodeHtmlEntities(recruit.title.rendered),
        url: recruit.link,
        ...(description && { description }),
      };
    });

  if (results.length === 0) {
    throw new Error('greenlabs: no published postings in WP REST response');
  }
  return results;
}

export const scrapeGreenlabs: ScrapeAdapter<GreenlabsConfig> = async (config) =>
  parseGreenlabsResponse(await fetchJson(greenlabsApiUrl(config.url)));
