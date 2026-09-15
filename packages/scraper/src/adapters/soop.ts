import type { SoopConfig } from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { htmlToText } from '../html';

/**
 * SOOP(구 아프리카TV) 자체 채용페이지 어댑터 — recruit.sooplive.com (실측 2026-07).
 *
 * 오늘날 드문 순수 SSR PHP 페이지다. 목록(recruit_list.php) HTML에 전 공고가 들어 있어
 * JS 렌더링도 내부 API 호출도 필요 없다 (실측 25건 전부 원본 HTML에 존재).
 * 직군 탭(Tech/Business/...)은 URL 파라미터가 아니라 클라이언트 필터라 목록은 항상 전체가 온다 —
 * 직군 필터링은 오케스트레이터의 분류에 맡긴다.
 *
 * 공고 상세는 목록의 절대 링크(recruit_list_sub.php?division=..&sub_idx=..&e_idx=..)이고,
 * 본문은 div.board_detail 안에 있다. 그 뒤의 div.aside_board는 "유사한 공고" 사이드바라 본문이 아니다.
 */

/** 목록 카드: <li><a href="...recruit_list_sub.php?..."> … </a></li> */
const CARD_PATTERN =
  /<li><a href="(https:\/\/recruit\.sooplive\.com\/recruit_list_sub\.php\?[^"]+)">([\s\S]*?)<\/a><\/li>/g;
const TITLE_PATTERN = /<strong>([\s\S]*?)<\/strong>/;
const BOARD_DETAIL_PATTERN = /<div class="board_detail"[^>]*>/;
const ASIDE_PATTERN = /<div class="aside_board"|<div class="recruit_footer"/;

/** <dt>label</dt><dd>value</dd>에서 value를 꺼낸다 */
function definitionField(block: string, label: string): string | undefined {
  const match = block.match(
    new RegExp(`<dt>\\s*${label}\\s*</dt>\\s*<dd>([^<]*)</dd>`),
  );
  return match?.[1]?.trim() || undefined;
}

/**
 * "채용 기간" 값 → ISO 날짜. 실측 전 공고가 "채용완료시"(상시)라 날짜 케이스는 방어적으로만 처리한다.
 * "2026.07.31" / "2026-07-31" 형태만 인정하고 그 외(상시·기간 표현)는 마감일 없음으로 본다.
 */
export function parseSoopDeadline(value: string | undefined): string | undefined {
  const match = value?.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** 목록 HTML을 검증하고 ScrapeResult[]로 변환한다 (fixture 테스트 대상 순수 함수). */
export function parseSoopList(html: string): ScrapeResult[] {
  const results: ScrapeResult[] = [];
  for (const [, url, block] of html.matchAll(CARD_PATTERN)) {
    // 카드에 제목이 없으면 마크업이 바뀐 것이다 — 조용히 건너뛰지 않고 즉시 실패
    if (!url || !block) {
      throw new Error('soop: malformed job card in list HTML');
    }
    const title = block.match(TITLE_PATTERN)?.[1]?.trim();
    if (!title) {
      throw new Error(`soop: card without title in list HTML: ${block.slice(0, 80)}`);
    }
    const deadline = parseSoopDeadline(definitionField(block, '채용 기간'));
    results.push({ title, url, ...(deadline && { deadline }) });
  }
  if (results.length === 0) {
    throw new Error('soop: no job cards found in list HTML');
  }
  return results;
}

/** 상세 HTML의 div.board_detail 본문만 평문으로 뽑는다 (fixture 테스트 대상 순수 함수). */
export function extractSoopDescription(html: string): string | undefined {
  const start = html.search(BOARD_DETAIL_PATTERN);
  if (start === -1) return undefined;
  const rest = html.slice(start);
  const end = rest.search(ASIDE_PATTERN);
  return htmlToText(end === -1 ? rest : rest.slice(0, end)) || undefined;
}

export const scrapeSoop: ScrapeAdapter<SoopConfig> = async (config) => {
  const results = parseSoopList(await fetchText(config.url));
  // 상세는 공고당 1회 요청 — 실측 25건이라 부담이 작다
  return Promise.all(
    results.map(async (result) => {
      const description = extractSoopDescription(await fetchText(result.url));
      return { ...result, ...(description && { description }) };
    }),
  );
};
