import { z } from 'zod';
import type { BucketplaceConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';

/**
 * 오늘의집 어댑터 — www.bucketplace.com/careers 전용 (실측 2026-07).
 *
 * 백엔드는 greeting(공고 정본이 bucketplace.career.greetinghr.com/ko/o/{id})이지만 greeting
 * 채용페이지가 꺼져 있어(목록·홈 모두 404) greeting 목록 어댑터를 못 쓴다 —
 * 쏘카·숨고·딜리셔스와 같은 상황. 대신 채용페이지가 Gatsby로 빌드돼 있어
 * 같은 origin의 /page-data/careers/page-data.json에 전 공고가 정적 데이터로 들어 있다.
 * 각 노드의 frontmatter.recruitUrl이 greeting 정본이라 그걸 저장용 URL로 그대로 쓴다.
 *
 * 목록 페이지의 ?team=dev 같은 필터는 클라이언트 렌더링 단계라 JSON에는 전 직군이 다 온다.
 * 비개발 공고는 오케스트레이터의 직군 분류(7-7)가 걸러내므로 여기서 팀 필터링은 하지 않는다.
 */

const PAGE_DATA_PATH = '/page-data/careers/page-data.json';

const bucketplacePositionSchema = z.object({
  frontmatter: z.object({
    /** 공고 제목 */
    name: z.string(),
    /** greeting 공고 정본 URL — bucketplace.career.greetinghr.com/ko/o/{id} */
    recruitUrl: z.string(),
    /** 인재풀 등록 항목이면 true — 실제 공고가 아니라 제외한다 */
    isPool: z.boolean().nullish(),
  }),
});

export const bucketplaceResponseSchema = z.object({
  result: z.object({
    data: z.object({
      position: z.object({ nodes: z.array(bucketplacePositionSchema) }),
    }),
  }),
});

/** page-data.json 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseBucketplaceResponse(data: unknown): ScrapeResult[] {
  return bucketplaceResponseSchema
    .parse(data)
    .result.data.position.nodes.map((node) => node.frontmatter)
    .filter((position) => !position.isPool)
    .map((position): ScrapeResult => ({
      title: position.name,
      url: position.recruitUrl,
    }));
}

export const scrapeBucketplace: ScrapeAdapter<BucketplaceConfig> = async (config) => {
  const { origin } = new URL(config.url);
  return parseBucketplaceResponse(await fetchJson(`${origin}${PAGE_DATA_PATH}`));
};
