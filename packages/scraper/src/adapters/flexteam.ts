import { z } from 'zod';
import type { FlexteamConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson, fetchText } from '../fetch';
import { extractNextData, toIsoDate } from '../next-data';

/**
 * 플렉스팀 어댑터 — flex.careers.team 전용 (실측 2026-07).
 *
 * 백엔드는 flex 자체 recruiting 제품이다. 예전엔 llm 폴백으로 CSR 페이지를 긁었는데,
 * LLM이 카드 옆 딱지(Permanent·Always hiring)를 제목에 붙였다 뗐다 해서 제목이 실행마다
 * 흔들렸고 → contentHash(companyId, title, url)가 갈라져 같은 공고가 닫혔다 열렸다 했다(플리커).
 *
 * 공개 API가 정식 제목을 구조화 필드로 주므로 제목이 흔들리지 않는다. 두 단계로 가져온다:
 *  1. 채용페이지(config.url)의 __NEXT_DATA__에서 customerIdHash를 뽑고,
 *  2. flex.team 공개 목록 API로 전 공고(정식 제목·마감일·상시여부)를 가져온다.
 * 상세 본문(description)은 Lexical 리치텍스트라 여기선 다루지 않는다 — 목록만으로 제목·URL·
 * 마감일이 안정적으로 확정되어 플리커가 사라진다.
 */

const FLEXTEAM_API_HOST = 'https://flex.team';

const recruitingSiteSchema = z.object({
  props: z.object({
    pageProps: z.object({
      recruitingSiteResponse: z.object({
        customerIdHash: z.string().min(1),
      }),
    }),
  }),
});

/** 채용페이지 __NEXT_DATA__에서 목록 API에 필요한 customerIdHash를 뽑는다. */
export function extractCustomerIdHash(html: string): string {
  return recruitingSiteSchema.parse(extractNextData(html)).props.pageProps
    .recruitingSiteResponse.customerIdHash;
}

const jobDescriptionSchema = z.object({
  jobDescriptionIdHash: z.string().min(1),
  title: z.string(),
  /**
   * 상시채용 여부. true면 recruitingEndDate가 과거의 낡은 값(예: 2024-05-15)으로 남아 있어
   * 마감일로 쓰면 안 된다 — 상시채용은 마감일이 없다.
   */
  isOccasionalRecruitment: z.boolean().optional(),
  /** YYYY-MM-DD (기간 채용만 유효) */
  recruitingEndDate: z.string().nullish(),
});
export const flexteamListSchema = z.object({
  jobDescriptions: z.array(jobDescriptionSchema),
});

/**
 * 목록 API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수).
 * origin은 저장용 공고 URL({origin}/job-descriptions/{idHash})을 만들 채용페이지 origin.
 */
export function parseFlexteamJobDescriptions(
  data: unknown,
  origin: string,
): ScrapeResult[] {
  return flexteamListSchema.parse(data).jobDescriptions.map((job) => ({
    title: job.title,
    url: `${origin}/job-descriptions/${job.jobDescriptionIdHash}`,
    // 기간 채용에 마감일이 있을 때만 넣는다. 상시채용은 낡은 recruitingEndDate를 무시.
    ...(!job.isOccasionalRecruitment && job.recruitingEndDate
      ? { deadline: toIsoDate(job.recruitingEndDate) }
      : {}),
  }));
}

export const scrapeFlexteam: ScrapeAdapter<FlexteamConfig> = async (config) => {
  const customerIdHash = extractCustomerIdHash(await fetchText(config.url));
  const data = await fetchJson(
    `${FLEXTEAM_API_HOST}/api-public/v2/recruiting/customers/${customerIdHash}/sites/job-descriptions`,
  );
  return parseFlexteamJobDescriptions(data, new URL(config.url).origin);
};
