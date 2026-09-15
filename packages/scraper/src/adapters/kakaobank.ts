import { z } from 'zod';
import type { KakaobankConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson, postJson } from '../fetch';
import { htmlToText } from '../html';

/**
 * 카카오뱅크 자체 채용페이지 어댑터 — recruit.kakaobank.com (실측 2026-07).
 *
 * 페이지는 CSR이라 HTML에 공고가 없고, 목록은 POST /api/recruits (JSON 본문 {pageNumber,pageSize})가
 * 내려준다. paging.totalPages로 페이징한다.
 *
 * 주의: 이 API는 마감된 공고까지 전부 내려준다 (실측 105건 중 진행 중은 18건).
 * 그래서 receiveEndDatetime으로 직접 걸러야 한다 — 안 그러면 마감 공고가 계속 open으로 올라온다.
 *
 * 공고 상세 URL은 {origin}/jobs/{recruitNoticeSn}, 본문은 GET /api/recruits/{sn}의 contents(HTML).
 * (목록의 recruitNoticeUrl은 외부 ATS(kakaobank.recruiter.co.kr) 주소라 쓰지 않는다 —
 *  jobflex 어댑터도 이 테넌트에는 붙지 않는다: NotFoundPostedDesignException.)
 */

const KAKAOBANK_ORIGIN = 'https://recruit.kakaobank.com';
const PAGE_SIZE = 20;
const MAX_PAGES = 50;

const kakaobankNoticeSchema = z.object({
  recruitNoticeSn: z.number(),
  recruitNoticeName: z.string(),
  /** 접수 마감 일시 ("2026-07-17 23:59:59") */
  receiveEndDatetime: z.string(),
});

export const kakaobankListResponseSchema = z.object({
  paging: z.object({ totalPages: z.number() }),
  list: z.array(kakaobankNoticeSchema),
});

export const kakaobankDetailResponseSchema = z.object({
  contents: z.string().nullish(),
});

/** "2026-07-17 23:59:59" → Date. 공백 구분자라 Safari/노드 파서 차이를 피해 T로 바꾼다. */
function parseDatetime(value: string): Date {
  return new Date(value.replace(' ', 'T'));
}

/**
 * 목록 API 응답(unknown)을 검증하고, now 기준 접수 중인 공고만 ScrapeResult[]로 변환한다
 * (fixture 테스트 대상 순수 함수 — now를 주입받아 시간에 의존하지 않는다).
 */
export function parseKakaobankListResponse(data: unknown, now: Date): ScrapeResult[] {
  return kakaobankListResponseSchema
    .parse(data)
    .list.filter((notice) => parseDatetime(notice.receiveEndDatetime) >= now)
    .map((notice) => ({
      title: notice.recruitNoticeName,
      url: `${KAKAOBANK_ORIGIN}/jobs/${notice.recruitNoticeSn}`,
      deadline: notice.receiveEndDatetime.slice(0, 10),
    }));
}

/** 상세 API 응답(unknown)에서 본문을 평문으로 뽑는다 (fixture 테스트 대상 순수 함수). */
export function parseKakaobankDetailResponse(data: unknown): string | undefined {
  const { contents } = kakaobankDetailResponseSchema.parse(data);
  return contents ? htmlToText(contents) || undefined : undefined;
}

export const scrapeKakaobank: ScrapeAdapter<KakaobankConfig> = async () => {
  const now = new Date();
  const results: ScrapeResult[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const data = await postJson(`${KAKAOBANK_ORIGIN}/api/recruits`, {
      pageNumber: page,
      pageSize: PAGE_SIZE,
    });
    totalPages = kakaobankListResponseSchema.parse(data).paging.totalPages;
    results.push(...parseKakaobankListResponse(data, now));
  }

  // 상세는 접수 중인 공고만 1회씩 요청한다 (실측 전체 105건 중 18건).
  return Promise.all(
    results.map(async (result) => {
      const sn = result.url.slice(result.url.lastIndexOf('/') + 1);
      const description = parseKakaobankDetailResponse(
        await fetchJson(`${KAKAOBANK_ORIGIN}/api/recruits/${sn}`),
      );
      return { ...result, ...(description && { description }) };
    }),
  );
};
