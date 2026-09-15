import { z } from 'zod';
import type { RiversConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson } from '../fetch';
import { htmlToText } from '../html';

/**
 * rivers(사람인 채용관리 ATS) 어댑터 — *.career.rivers.co.kr (실측 2026-08, 큐피스트).
 *
 * 채용페이지는 블록 빌더로 만든 CSR이라 HTML에 공고가 없다 (공고 목록 블록의 blockContent가 빈 배열).
 * 페이지가 호출하는 공개 API를 그대로 쓴다 — 인증이 없고 목록에 본문(recruitDetailContent)까지 들어 있다.
 *
 * 마감일만 목록에 없어 공개 공고당 상세를 한 번 더 부른다. 대부분 상시채용(ALWAYS)이지만
 * 마감일을 건 테넌트도 있을 수 있어 조용히 버리지 않는다.
 *
 * 자사 도메인(예: www.cupist.com의 노션 페이지)이 이 ATS로 링크만 걸어두는 경우가 있는데,
 * 그런 안내 페이지는 손으로 관리해 믿을 수 없다 — 실측 2026-08 큐피스트: 링크 24개 중 열린 공고는 14개뿐이고,
 * 반대로 새로 열린 공고 5건(백엔드 개발자 포함)은 아예 링크가 없었다.
 */

const RIVERS_API_BASE = 'https://api.rivers.saramin.co.kr';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** 마감일 없는 상시채용 — API가 9999-12-31로 채워 보낸다 */
const ALWAYS_OPEN_CODE = 'ALWAYS';

const riversHomepageSchema = z.object({
  body: z.object({
    metadata: z.object({ workspaceNo: z.number() }),
  }),
});

const riversPositionSchema = z.object({
  recruitNo: z.number(),
  /** 채용페이지에 노출되는 제목 (내부 관리용 recruitTitle과 다를 수 있다) */
  positionTitle: z.string(),
  /** ACT(모집 중) / INACT(마감) */
  open: z.string(),
  /** 채용페이지 노출 여부 — 내부용 공고는 NO */
  recruitSitePostingYn: z.string(),
  recruitDetailContent: z.string().nullish(),
});

export const riversListSchema = z.object({
  body: z.object({
    content: z.array(riversPositionSchema),
    totalPages: z.number(),
  }),
});

const riversDetailSchema = z.object({
  body: z.object({
    recruitApplyCloseCode: z.string().nullish(),
    /** ISO datetime — 상시채용이면 9999-12-31 */
    recruitApplyCloseDateTime: z.string().nullish(),
  }),
});

export type RiversPosting = ScrapeResult & { recruitNo: number };

/**
 * 목록 API 한 페이지를 검증하고 공개 공고만 뽑는다 (fixture 테스트 대상 순수 함수).
 * 마감(INACT)·미노출(recruitSitePostingYn !== 'YES') 공고는 목록에 계속 남으므로 여기서 걸러낸다.
 */
export function parseRiversPositions(
  data: unknown,
  origin: string,
): { postings: RiversPosting[]; totalPages: number } {
  const { content, totalPages } = riversListSchema.parse(data).body;

  const postings = content
    .filter((position) => position.open === 'ACT' && position.recruitSitePostingYn === 'YES')
    .map((position): RiversPosting => {
      const description = position.recruitDetailContent
        ? htmlToText(position.recruitDetailContent)
        : '';
      return {
        recruitNo: position.recruitNo,
        title: position.positionTitle,
        url: `${origin}/position/${position.recruitNo}`,
        ...(description && { description }),
      };
    });

  return { postings, totalPages };
}

/** 상세 응답에서 마감일(YYYY-MM-DD)을 뽑는다. 상시채용이면 undefined. */
export function parseRiversDeadline(data: unknown): string | undefined {
  const { recruitApplyCloseCode, recruitApplyCloseDateTime } =
    riversDetailSchema.parse(data).body;
  if (!recruitApplyCloseDateTime || recruitApplyCloseCode === ALWAYS_OPEN_CODE) return undefined;
  const date = recruitApplyCloseDateTime.slice(0, 10);
  return date.startsWith('9999') ? undefined : date;
}

export const scrapeRivers: ScrapeAdapter<RiversConfig> = async (config) => {
  const origin = new URL(config.url).origin;

  // 테넌트 식별자(workspaceNo)는 채용페이지 메타에서 얻는다 — 호스트만 알면 되고 인증이 없다
  const homepage = riversHomepageSchema.parse(
    await fetchJson(`${RIVERS_API_BASE}/career/homepage?url=${encodeURIComponent(origin)}`),
  );
  const workspaceNo = homepage.body.metadata.workspaceNo;

  const postings: RiversPosting[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchJson(
      `${RIVERS_API_BASE}/career/${workspaceNo}/positions?page=${page}&size=${PAGE_SIZE}`,
    );
    const parsed = parseRiversPositions(data, origin);
    postings.push(...parsed.postings);
    if (page + 1 >= parsed.totalPages) break;
  }

  if (postings.length === 0) {
    throw new Error(`rivers: no open positions for workspace ${workspaceNo} (${origin})`);
  }

  // 마감일은 목록에 없다 — 공개 공고당 상세 1회 (실측 큐피스트 13건)
  return Promise.all(
    postings.map(async ({ recruitNo, ...posting }): Promise<ScrapeResult> => {
      const deadline = parseRiversDeadline(
        await fetchJson(`${RIVERS_API_BASE}/career/positions/${recruitNo}`),
      );
      return { ...posting, ...(deadline && { deadline }) };
    }),
  );
};
