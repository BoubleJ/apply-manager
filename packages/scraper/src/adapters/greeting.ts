import { z } from 'zod';
import type { GreetingConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchJson, fetchText } from '../fetch';
import { extractNextData, toIsoDate } from '../next-data';
import { htmlToText } from '../html';

/**
 * greeting(그리팅) 어댑터 — 스펙 7-3의 1순위 접근(__NEXT_DATA__)이 실측으로 확인됨.
 *
 * 실측(2026-07, oliveyoung.career.greetinghr.com): 페이지가 react-query dehydratedState를
 * __NEXT_DATA__에 내장하며, queryKey ["openings"]인 쿼리의 state.data에 공고 전체 목록이 들어 있다
 * (203건 전부 SSR 페이로드에 포함 — 별도 내부 API 호출 불필요).
 * 공고 상세 URL은 {origin}/o/{openingId} (실측 200 확인).
 *
 * 신형 그리팅 페이지 폴백(실측 2026-07, careers.devsisters.com): 일부 테넌트는 ["openings"]가
 * SSR에 비어 있고 목록을 클라이언트에서 공개 API로 로드한다. 이 경우 __NEXT_DATA__의
 * queryKey에서 workspaceId를 찾아 같은 API를 직접 호출한다 (응답의 공고 스키마는 SSR과 동일,
 * 단 dueDate/deploy는 없음).
 */

const greetingOpeningSchema = z.object({
  openingId: z.number(),
  title: z.string(),
  /** 마감일 — 상시채용이면 null */
  dueDate: z.string().nullish(),
  /** false면 비공개(미게시) 공고 */
  deploy: z.boolean().nullish(),
  openingJobPosition: z
    .object({
      openingJobPositions: z
        .array(
          z.object({
            workspaceJob: z.object({ job: z.string().nullish() }).nullish(),
            workspaceOccupation: z.object({ occupation: z.string().nullish() }).nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const greetingNextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      dehydratedState: z.object({
        queries: z.array(
          z.object({
            queryKey: z.unknown(),
            state: z.object({ data: z.unknown() }),
          }),
        ),
      }),
    }),
  }),
});

type GreetingOpening = z.infer<typeof greetingOpeningSchema>;

function mapOpenings(openings: GreetingOpening[], origin: string): ScrapeResult[] {
  return openings
    .filter((opening) => opening.deploy !== false)
    .map((opening) => {
      const jobs = (opening.openingJobPosition?.openingJobPositions ?? [])
        .map((position) => position.workspaceJob?.job)
        .filter((job): job is string => Boolean(job));
      return {
        title: opening.title,
        url: `${origin}/o/${opening.openingId}`,
        ...(jobs.length > 0 && { description: jobs.join(', ') }),
        ...(opening.dueDate && { deadline: toIsoDate(opening.dueDate) }),
      };
    });
}

/** 페이지 HTML에서 공고 목록을 추출한다 (fixture 테스트 대상 순수 함수). */
export function parseGreetingPage(html: string, pageUrl: string): ScrapeResult[] {
  const nextData = greetingNextDataSchema.parse(extractNextData(html));
  const openingsQuery = nextData.props.pageProps.dehydratedState.queries.find(
    (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'openings',
  );
  if (!openingsQuery) {
    throw new Error('greeting: ["openings"] query not found in __NEXT_DATA__');
  }
  const openings = z.array(greetingOpeningSchema).parse(openingsQuery.state.data);
  return mapOpenings(openings, new URL(pageUrl).origin);
}

/**
 * __NEXT_DATA__의 queryKey들에서 workspaceId를 찾는다 (신형 페이지 API 폴백용).
 * 예: ["publicCareer","getCareerBootInfo",{"locale":"ko","workspaceId":12227}]
 */
export function extractGreetingWorkspaceId(html: string): number | null {
  const nextData = greetingNextDataSchema.parse(extractNextData(html));
  for (const query of nextData.props.pageProps.dehydratedState.queries) {
    if (!Array.isArray(query.queryKey)) continue;
    for (const part of query.queryKey) {
      if (
        typeof part === 'object' &&
        part !== null &&
        'workspaceId' in part &&
        typeof (part as { workspaceId: unknown }).workspaceId === 'number'
      ) {
        return (part as { workspaceId: number }).workspaceId;
      }
    }
  }
  return null;
}

const greetingOpeningDetailSchema = z.object({
  openingsInfo: z.object({
    title: z.string(),
    /** 공고 본문 HTML */
    detail: z.string().nullish(),
    /** 마감일 — 상시채용이면 null */
    dueDate: z.string().nullish(),
    status: z.string().nullish(),
  }),
});

export interface GreetingOpeningDetail {
  title: string;
  status: string | undefined;
  deadline: string | undefined;
  description: string | undefined;
}

/**
 * 그리팅 공고 상세({origin}/ko/o/{id}) HTML에서 제목·마감일·본문을 뽑는다
 * (fixture 테스트 대상 순수 함수).
 *
 * 채용페이지 목록이 꺼진 테넌트(soomgo 등)도 상세 페이지는 살아 있어 여기서 정보를 얻는다.
 * 구조가 바뀌어 getOpeningById 쿼리를 못 찾으면 조용히 빈 값을 내지 않고 throw한다.
 */
export function parseGreetingOpeningDetail(html: string): GreetingOpeningDetail {
  const nextData = greetingNextDataSchema.parse(extractNextData(html));
  const query = nextData.props.pageProps.dehydratedState.queries.find(
    (item) => Array.isArray(item.queryKey) && item.queryKey[1] === 'getOpeningById',
  );
  if (!query) {
    throw new Error('greeting: getOpeningById query not found in __NEXT_DATA__');
  }
  const data = z
    .object({ data: greetingOpeningDetailSchema })
    .parse(query.state.data).data.openingsInfo;
  return {
    title: data.title,
    status: data.status ?? undefined,
    deadline: data.dueDate ? toIsoDate(data.dueDate) : undefined,
    description: data.detail ? htmlToText(data.detail) || undefined : undefined,
  };
}

const greetingApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(greetingOpeningSchema),
});

/** 신형 페이지가 클라이언트에서 호출하는 공개 공고 목록 API (실측: careers.devsisters.com) */
function greetingOpeningsApiUrl(workspaceId: number): string {
  return `https://api.greetinghr.com/ats/public/employee-referral/v1.1/workspaces/${workspaceId}/openings`;
}

export const scrapeGreeting: ScrapeAdapter<GreetingConfig> = async (config) => {
  const html = await fetchText(config.url);
  const fromPage = parseGreetingPage(html, config.url);
  if (fromPage.length > 0) return fromPage;

  // SSR에 공고가 없으면 신형 페이지일 수 있다 → 공개 API 폴백 (실제 0건이면 API도 0건)
  const workspaceId = extractGreetingWorkspaceId(html);
  if (workspaceId === null) return fromPage;
  const response = greetingApiResponseSchema.parse(
    await fetchJson(greetingOpeningsApiUrl(workspaceId)),
  );
  if (!response.success) {
    throw new Error(`greeting: openings API returned success=false (workspaceId ${workspaceId})`);
  }
  return mapOpenings(response.data, new URL(config.url).origin);
};
