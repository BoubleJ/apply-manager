import { z } from 'zod';
import type { DunamuConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { extractNextData } from '../next-data';

/**
 * 두나무 어댑터 — www.dunamu.com/careers/jobs 전용 (실측 2026-07).
 *
 * 공고는 "article"로 관리되어 목록 페이지 __NEXT_DATA__ props.pageProps.articles.content에
 * 전량 임베드된다(pageSize 200, totalPages 1). 상세 URL은 {origin}/careers/jobs/{id}.
 * api.dunamu.com 목록 API는 Cloudflare로 평문 fetch가 막혀 있어 자체 페이지 SSR을 쓴다.
 *
 * 실제 공고는 categoryKind === 'LINK'이고, 공지(categoryKind 'NONE')와 상시 인재풀
 * (categoryName 'talentpool')은 특정 직무 공고가 아니므로 제외한다. 마감일은 목록에 없다.
 */

const dunamuArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  categoryName: z.string().nullish(),
  categoryKind: z.string().nullish(),
});
const dunamuNextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      articles: z.object({
        content: z.array(dunamuArticleSchema),
      }),
    }),
  }),
});

/**
 * 목록 페이지 HTML의 __NEXT_DATA__에서 공고 article을 뽑는다 (fixture 테스트 대상 순수 함수).
 * 공지·인재풀을 걸러내고 하나도 남지 않으면 조용히 빈 배열을 내지 않고 throw한다.
 */
export function parseDunamuJobsPage(html: string, pageUrl: string): ScrapeResult[] {
  const data = dunamuNextDataSchema.parse(extractNextData(html));
  const origin = new URL(pageUrl).origin;
  const results = data.props.pageProps.articles.content
    .filter(
      (article) =>
        article.categoryKind === 'LINK' && article.categoryName !== 'talentpool',
    )
    .map((article): ScrapeResult => ({
      title: article.title,
      url: `${origin}/careers/jobs/${article.id}`,
    }));
  if (results.length === 0) {
    throw new Error('dunamu: no job articles found in __NEXT_DATA__');
  }
  return results;
}

export const scrapeDunamu: ScrapeAdapter<DunamuConfig> = async (config) => {
  return parseDunamuJobsPage(await fetchText(config.url), config.url);
};
