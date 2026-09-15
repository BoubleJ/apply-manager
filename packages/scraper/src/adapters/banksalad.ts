import { z } from 'zod';
import type { BanksaladConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';
import { toIsoDate } from '../next-data';

/**
 * 뱅크샐러드 어댑터 — 자체 채용페이지(corp.banksalad.com/jobs) 전용.
 *
 * 실측(2026-07): 백엔드는 greeting이지만 greeting 채용페이지를 꺼둔 테넌트다
 * (응답의 activatedAtCareerPage가 전 공고 false, banksalad.career.greetinghr.com/ko는 404).
 * 그래서 greeting 어댑터를 쓸 수 없다.
 *
 * greeting 공개 API(workspaces/5130/openings)도 신뢰할 수 없다 — 사이트에 없는 공고 3건을
 * 더 주고(그중 /o/91290은 상세가 404) 사이트에 있는 2건은 빠뜨린다. 채용페이지를 끈 탓에
 * 그쪽 데이터가 갱신되지 않는 것으로 보인다.
 *
 * 따라서 사이트가 실제로 호출하는 프록시 API를 그대로 쓴다 (실측: 사이트 노출 48건과 정확히 일치).
 * 응답은 부서(department)별로 묶여 있고, 각 공고의 url은 greeting 상세 절대주소다.
 */

const BANKSALAD_API_URL = 'https://www.banksalad.com/proxy/api/greeting/published-openings';

const banksaladJobSchema = z.object({
  title: z.string(),
  /** 공고 상세 절대 URL (greeting 도메인) */
  url: z.url(),
  /** 직무명 — 부서명과 같은 값이 온다 */
  job: z.string().nullish(),
  /** 마감일 — 실측 전 공고 null(상시채용)이나 스키마상 올 수 있다 */
  dueDate: z.string().nullish(),
});

export const banksaladResponseSchema = z.object({
  jobs: z.array(
    z.object({
      department: z.string(),
      data: z.array(banksaladJobSchema),
    }),
  ),
});

/** API 응답(unknown)을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseBanksaladResponse(data: unknown): ScrapeResult[] {
  return banksaladResponseSchema.parse(data).jobs.flatMap((group) =>
    group.data.map((job) => ({
      title: job.title,
      url: job.url,
      ...(job.job && { description: job.job }),
      ...(job.dueDate && { deadline: toIsoDate(job.dueDate) }),
    })),
  );
}

export const scrapeBanksalad: ScrapeAdapter<BanksaladConfig> = async () =>
  parseBanksaladResponse(await fetchJson(BANKSALAD_API_URL));
