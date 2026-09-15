import { z } from 'zod';
import {
  completeStructured,
  loadLlmEnv,
  preprocessHtml,
  type HtmlLink,
  type LlmConfig,
  type PreprocessedHtml,
} from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from '../types';
import { fetchText } from '../fetch';
import { renderWithBrowser } from '../browser';

/**
 * llm 범용 폴백 어댑터 (스펙 7-3) — 자체 채용페이지용.
 * fetch → HTML 전처리(shared 재사용) → LLM Structured Outputs 추출 → Zod 파싱.
 * CSR 감지 시 Playwright 폴백 (optional peer — 미설치면 browser.ts가 명확한 에러를 던진다).
 * URL 환각 방지: 프롬프트로 링크 목록 값만 쓰도록 제약 + 결과를 허용 목록으로 재검증.
 */

// LLM 입력 토큰 상한 (대형 페이지 방어)
const MAX_TEXT_CHARS = 24_000;
const MAX_LINKS = 300;

// Groq strict 모드 미사용이므로 optional 대신 전 필드 필수 + nullable로 설계
const extractedPostingSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  /** YYYY-MM-DD, 마감일 안내가 없으면 null */
  deadline: z.string().nullable(),
});
export const jobExtractionSchema = z.object({
  postings: z.array(extractedPostingSchema),
});
export type JobExtraction = z.infer<typeof jobExtractionSchema>;

/** CSR 페이지 감지 휴리스틱 — 본문 텍스트가 거의 없으면 렌더링이 필요하다고 본다. */
export function isProbablyCsr(page: PreprocessedHtml): boolean {
  return page.text.replace(/\s/g, '').length < 200 || page.links.length === 0;
}

/** 상대 href를 페이지 URL 기준 절대 URL로 변환한다. 변환 불가하면 null. */
export function resolveLinkUrl(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/** 링크 목록을 절대 URL로 정규화하고 중복을 제거한다. */
export function normalizeLinks(links: HtmlLink[], pageUrl: string): HtmlLink[] {
  const seen = new Set<string>();
  const normalized: HtmlLink[] = [];
  for (const link of links) {
    const url = resolveLinkUrl(link.href, pageUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({ text: link.text, href: url });
  }
  return normalized;
}

/**
 * LLM 추출 결과를 ScrapeResult[]로 변환한다.
 * 허용 목록(페이지의 실제 링크)에 없는 URL은 환각으로 간주해 버리고 경고 로그를 남긴다.
 */
export function toScrapeResults(
  extraction: JobExtraction,
  allowedUrls: ReadonlySet<string>,
  pageUrl: string,
): ScrapeResult[] {
  const results: ScrapeResult[] = [];
  for (const posting of extraction.postings) {
    const url = resolveLinkUrl(posting.url, pageUrl);
    if (!url || !allowedUrls.has(url)) {
      console.warn(
        `[scraper:llm] dropped posting with hallucinated URL: "${posting.title}" (${posting.url})`,
      );
      continue;
    }
    results.push({
      title: posting.title,
      url,
      ...(posting.description && { description: posting.description }),
      ...(posting.deadline && { deadline: posting.deadline }),
    });
  }
  return results;
}

const SYSTEM_PROMPT = [
  '너는 회사 채용페이지에서 채용공고 목록을 추출하는 도구다.',
  '입력으로 페이지 본문 텍스트와 페이지에 실제로 존재하는 링크 목록([텍스트](URL))을 받는다.',
  '규칙:',
  '- 개별 채용공고만 추출한다. 네비게이션/블로그/SNS/회사소개 링크는 공고가 아니다.',
  '- url은 반드시 제공된 링크 목록에 있는 URL을 글자 그대로 사용한다. 새 URL을 만들거나 수정하지 마라.',
  '- description은 페이지 텍스트에 해당 공고의 설명이 있을 때만 한 줄로 요약하고, 없으면 null.',
  '- deadline은 페이지에 마감일이 명시된 경우만 YYYY-MM-DD로 적고, 상시채용이거나 없으면 null.',
  '- 공고가 하나도 없으면 postings를 빈 배열로 반환한다.',
].join('\n');

export function buildJobExtractionPrompt(
  text: string,
  links: HtmlLink[],
): string {
  const linkList = links
    .slice(0, MAX_LINKS)
    .map((link) => `- [${link.text}](${link.href})`)
    .join('\n');
  return [
    '## 페이지 본문 텍스트',
    text.slice(0, MAX_TEXT_CHARS),
    '',
    '## 페이지의 링크 목록 (url은 이 목록의 값만 사용)',
    linkList,
  ].join('\n');
}

export const scrapeLlm: ScrapeAdapter<LlmConfig> = async (config) => {
  const llmEnv = loadLlmEnv();

  let html = config.needsBrowser
    ? await renderWithBrowser(config.url)
    : await fetchText(config.url);
  let page = preprocessHtml(html);

  // CSR 감지 시 Playwright 폴백 (needsBrowser 미설정이었던 경우)
  if (!config.needsBrowser && isProbablyCsr(page)) {
    html = await renderWithBrowser(config.url);
    page = preprocessHtml(html);
  }

  const links = normalizeLinks(page.links, config.url);
  const extraction = await completeStructured({
    model: llmEnv.modelExtract,
    baseUrl: llmEnv.baseUrl,
    apiKey: llmEnv.apiKey,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildJobExtractionPrompt(page.text, links),
    schema: jobExtractionSchema,
    schemaName: 'job_postings_extraction',
    temperature: 0,
  });

  const allowedUrls = new Set(links.map((link) => link.href));
  return toScrapeResults(extraction, allowedUrls, config.url);
};
