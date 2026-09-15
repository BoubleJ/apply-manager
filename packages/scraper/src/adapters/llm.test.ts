import { describe, expect, it } from 'vitest';
import { preprocessHtml } from '@apply-manager/shared';
import {
  buildJobExtractionPrompt,
  isProbablyCsr,
  normalizeLinks,
  toScrapeResults,
} from './llm';

const PAGE_URL = 'https://example.com/careers';

describe('isProbablyCsr', () => {
  it('본문이 비어 있는 CSR 셸을 감지한다', () => {
    const page = preprocessHtml(
      '<html><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
    expect(isProbablyCsr(page)).toBe(true);
  });

  it('본문 텍스트와 링크가 충분하면 SSR로 판단한다', () => {
    const jobs = Array.from(
      { length: 20 },
      (_, i) => `<li><a href="/jobs/${i}">백엔드 엔지니어 ${i}번 포지션 (경력 3년 이상)</a></li>`,
    ).join('');
    const page = preprocessHtml(`<html><body><h1>채용중인 포지션</h1><ul>${jobs}</ul></body></html>`);
    expect(isProbablyCsr(page)).toBe(false);
  });
});

describe('normalizeLinks', () => {
  it('상대 경로를 절대 URL로 변환하고 중복을 제거한다', () => {
    const links = normalizeLinks(
      [
        { text: 'FE', href: '/jobs/fe' },
        { text: 'FE dup', href: 'https://example.com/jobs/fe' },
        { text: 'broken', href: 'http://' },
      ],
      PAGE_URL,
    );
    expect(links).toEqual([{ text: 'FE', href: 'https://example.com/jobs/fe' }]);
  });
});

describe('toScrapeResults', () => {
  const allowed = new Set(['https://example.com/jobs/fe']);

  it('허용 목록에 있는 URL만 통과시킨다 (환각 방지)', () => {
    const results = toScrapeResults(
      {
        postings: [
          { title: 'FE 엔지니어', url: '/jobs/fe', description: null, deadline: '2026-08-01' },
          { title: '환각 공고', url: 'https://example.com/jobs/hallucinated', description: null, deadline: null },
        ],
      },
      allowed,
      PAGE_URL,
    );
    expect(results).toEqual([
      { title: 'FE 엔지니어', url: 'https://example.com/jobs/fe', deadline: '2026-08-01' },
    ]);
  });
});

describe('buildJobExtractionPrompt', () => {
  it('본문 텍스트와 링크 목록을 포함한다', () => {
    const prompt = buildJobExtractionPrompt('채용 중', [
      { text: 'FE', href: 'https://example.com/jobs/fe' },
    ]);
    expect(prompt).toContain('채용 중');
    expect(prompt).toContain('[FE](https://example.com/jobs/fe)');
  });
});
