import { z } from 'zod';
import type { NinehireConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson, fetchText } from '../fetch';
import { extractNextData, toIsoDate } from '../next-data';

/**
 * ninehire(나인하이어) 어댑터 — 스펙 7-3 지정 샘플 rapportlabs.kr/jobs 로 실측 검증(2026-07).
 *
 * 공고 목록은 CSR이라 __NEXT_DATA__에 없고, 페이지 JS가 내부 API
 * https://api.ninehire.com/identity-access/homepage/recruitments 를 호출한다
 * (페이지 번들에서 baseURL "https://api.ninehire.com" 및 경로 실측 확인).
 * companyId는 __NEXT_DATA__ props.pageProps.homepageProps.info.companyId에서 얻는다.
 * 공고 상세 URL은 {origin}/job_posting/{addressKey} (실측 200 확인).
 */

const NINEHIRE_API_BASE = 'https://api.ninehire.com';
const COUNT_PER_PAGE = 100;
const MAX_PAGES = 20;

const ninehirePageDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      homepageProps: z.object({
        info: z.object({ companyId: z.string() }),
      }),
    }),
  }),
});

/**
 * roundhr 화이트라벨 커스텀 도메인(예: recruit.passorder.co.kr)은 __NEXT_DATA__ 구조가
 * 표준 나인하이어 페이지와 달라 companyId가 그 안에 없다. companyId(UUID)는 브랜드 이미지
 * URL(image.ninehire.com/brand/{companyId}/...)에만 노출되므로 여기서 뽑는다.
 */
const NINEHIRE_BRAND_IMAGE_PATTERN =
  /image\.ninehire\.com\/brand\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** 페이지 HTML에서 companyId를 추출한다 (fixture 테스트 대상 순수 함수). */
export function extractNinehireCompanyId(html: string): string {
  const parsed = ninehirePageDataSchema.safeParse(extractNextData(html));
  if (parsed.success) {
    return parsed.data.props.pageProps.homepageProps.info.companyId;
  }
  const brandMatch = html.match(NINEHIRE_BRAND_IMAGE_PATTERN);
  if (brandMatch?.[1]) return brandMatch[1];
  throw new Error('ninehire companyId를 페이지에서 찾을 수 없다 (__NEXT_DATA__/브랜드 이미지 모두 실패)');
}

const ninehireRecruitmentSchema = z.object({
  recruitmentId: z.string(),
  title: z.string(),
  /** 채용페이지에 노출되는 제목 (title과 다를 수 있음) */
  externalTitle: z.string().nullish(),
  /** 공고 상세 URL 조각 — {origin}/job_posting/{addressKey} */
  addressKey: z.string(),
  /** 마감일 — until_filled/always 등이면 null */
  deadlineValue: z.string().nullish(),
  status: z.string().nullish(),
});

export const ninehireResponseSchema = z.object({
  count: z.number(),
  results: z.array(ninehireRecruitmentSchema),
});

/** API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseNinehireResponse(data: unknown, pageUrl: string): ScrapeResult[] {
  const origin = new URL(pageUrl).origin;
  return ninehireResponseSchema
    .parse(data)
    .results.filter(
      (recruitment) => !recruitment.status || recruitment.status === 'in_progress',
    )
    .map((recruitment) => ({
      title: recruitment.externalTitle ?? recruitment.title,
      url: `${origin}/job_posting/${recruitment.addressKey}`,
      ...(recruitment.deadlineValue && {
        deadline: toIsoDate(recruitment.deadlineValue),
      }),
    }));
}

export const scrapeNinehire: ScrapeAdapter<NinehireConfig> = async (config) => {
  const html = await fetchText(config.url);
  const companyId = extractNinehireCompanyId(html);

  const results: ScrapeResult[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const apiUrl =
      `${NINEHIRE_API_BASE}/identity-access/homepage/recruitments` +
      `?companyId=${encodeURIComponent(companyId)}&page=${page}&countPerPage=${COUNT_PER_PAGE}`;
    const data = await fetchJson(apiUrl);
    const parsed = ninehireResponseSchema.parse(data);
    results.push(...parseNinehireResponse(data, config.url));
    if (parsed.results.length === 0 || page * COUNT_PER_PAGE >= parsed.count) break;
  }
  return results;
};
