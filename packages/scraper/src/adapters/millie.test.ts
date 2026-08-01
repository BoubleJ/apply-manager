import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/fixture';
import { parseMillieCareerPage } from './millie';

// fixture: www.millie.town/careers 실측 페이지의 공고 10건 (2026-08)
describe('parseMillieCareerPage', () => {
  it('__NEXT_DATA__에서 공고 목록을 뽑는다', () => {
    const postings = parseMillieCareerPage(loadFixture('millie-careers.html'));

    expect(postings).toHaveLength(10);
    // link_addr이 /ko/o/{id}든 /o/{id}든 greeting 정본 URL 한 형태로 통일한다
    expect(postings[0]).toEqual({
      openingId: '230272',
      url: 'https://millie.career.greetinghr.com/o/230272',
    });
    expect(postings).toContainEqual({
      openingId: '219340',
      url: 'https://millie.career.greetinghr.com/o/219340',
    });
  });

  it('페이지가 밝힌 공고 수와 다르면 throw한다 — 마크업 변경을 조용히 넘기지 않는다', () => {
    const html = loadFixture('millie-careers.html').replace(
      '"totalCount":10',
      '"totalCount":17',
    );
    expect(() => parseMillieCareerPage(html)).toThrow(/page says 17 .* got 10/);
  });

  it('페이지네이션이 생기면 throw한다 — 1페이지만 긁고 나머지를 닫아버리지 않는다', () => {
    const html = loadFixture('millie-careers.html').replace(
      '"totalPage":1',
      '"totalPage":2',
    );
    expect(() => parseMillieCareerPage(html)).toThrow(/pagination appeared/);
  });

  /** 실측 페이지는 공고 URL이 __NEXT_DATA__ 밖에도 나와 문자열 치환이 엉뚱한 곳을 건드린다 — 최소 HTML로 만든다 */
  const pageWith = (data: unknown): string =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { data } },
    })}</script>`;

  it('공고가 하나도 없으면 빈 배열 대신 throw한다', () => {
    const html = pageWith({ totalCount: 0, totalPage: 1, result: [] });
    expect(() => parseMillieCareerPage(html)).toThrow(/no postings found/);
  });

  it('상세 링크에서 openingId를 못 찾으면 throw한다', () => {
    const html = pageWith({
      totalCount: 1,
      totalPage: 1,
      result: [
        { title: '공지', link_addr: 'https://millie.career.greetinghr.com/ko/notice' },
      ],
    });
    expect(() => parseMillieCareerPage(html)).toThrow(/unexpected link_addr/);
  });
});
