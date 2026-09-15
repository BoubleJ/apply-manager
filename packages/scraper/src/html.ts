/**
 * 공고 본문 HTML → 평문 변환.
 * 자체 채용페이지 어댑터(naver/kakao/kakaobank)는 설명을 HTML 조각으로 받는다 —
 * description은 사람이 읽고 직군 분류 LLM에도 들어가므로 태그를 걷어내고 줄바꿈만 남긴다.
 */

/** description 저장 상한 — 공고 본문은 길어야 수천 자고, 분류 LLM도 앞부분만 쓴다. */
export const MAX_DESCRIPTION_LENGTH = 4000;

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
  [/&middot;/g, '·'],
  [/&rarr;/g, '→'],
  [/&bull;/g, '•'],
  [/&lsquo;/g, "'"],
  [/&rsquo;/g, "'"],
  [/&ldquo;/g, '"'],
  [/&rdquo;/g, '"'],
  // &amp;는 반드시 마지막 — 먼저 풀면 "&amp;lt;"가 "<"로 잘못 풀린다
  [/&amp;/g, '&'],
];

/** &#8211; 같은 수치 참조 — 워드프레스는 제목·본문의 문장부호를 전부 이 형태로 내보낸다 */
const NUMERIC_ENTITY = /&#(\d+);|&#x([0-9a-f]+);/gi;

/**
 * HTML 엔티티만 푼다 (태그는 건드리지 않음).
 * 제목처럼 태그가 없는 짧은 문자열에 쓴다 — 본문은 htmlToText가 이 함수를 포함해 처리한다.
 */
export function decodeHtmlEntities(html: string): string {
  let text = html.replace(NUMERIC_ENTITY, (match, dec: string | undefined, hex: string | undefined) => {
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match;
  });
  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function htmlToText(html: string): string {
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table|section)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_DESCRIPTION_LENGTH);
}
