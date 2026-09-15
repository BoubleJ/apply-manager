import { describe, expect, it } from 'vitest';
import { loadJsonFixture } from '../../test/fixture';
import { greenlabsApiUrl, parseGreenlabsResponse } from './greenlabs';

// fixture: greenlabs.co.kr/wp-json/wp/v2/recruit 실측 응답 3건에서 본문만 줄인 것 (2026-08).
// 두 번째 공고 제목에는 워드프레스 수치 엔티티(&#8211; &#038;)를 심어 뒀다.
describe('parseGreenlabsResponse', () => {
  it('공고 제목·URL·본문을 뽑고 제목의 엔티티를 푼다', () => {
    const postings = parseGreenlabsResponse(loadJsonFixture('greenlabs-recruit.json'));

    expect(postings).toHaveLength(3);
    expect(postings[0]).toMatchObject({
      title: '커머스팀 리더 (Commerce Team Lead)',
      url: 'https://greenlabs.co.kr/recruit/%ec%bb%a4%eb%a8%b8%ec%8a%a4%ed%8c%80-%eb%a6%ac%eb%8d%94-commerce-team-lead/',
    });
    // 엔티티를 안 풀면 목록에 '&#8211;'이 그대로 보인다
    expect(postings[1]?.title).toBe('팜모닝 Product Engineer – 커머스&AI');
    expect(postings[1]?.description).toContain('그린랩스를 소개합니다');
    // 마감일은 사이트 어디에도 없다
    expect(postings[1]?.deadline).toBeUndefined();
  });

  it('발행되지 않은 공고는 제외한다', () => {
    const data = loadJsonFixture('greenlabs-recruit.json') as { status: string }[];
    data[0]!.status = 'draft';

    const postings = parseGreenlabsResponse(data);
    expect(postings).toHaveLength(2);
    expect(postings.map((p) => p.title)).not.toContain('커머스팀 리더 (Commerce Team Lead)');
  });

  it('페이지네이션이 생기면 1페이지만 쓰지 않고 throw한다', () => {
    const [recruit] = loadJsonFixture('greenlabs-recruit.json') as unknown[];
    expect(() => parseGreenlabsResponse(Array.from({ length: 100 }, () => recruit))).toThrow(
      /pagination appeared/,
    );
  });

  it('발행 공고가 하나도 없으면 빈 배열 대신 throw한다', () => {
    expect(() => parseGreenlabsResponse([])).toThrow(/no published postings/);
  });

  it('응답 모양이 바뀌면 throw한다', () => {
    expect(() => parseGreenlabsResponse([{ id: 1, link: 'https://x.kr/a' }])).toThrow();
  });
});

describe('greenlabsApiUrl', () => {
  it('채용페이지 URL의 호스트에서 WP REST 목록 URL을 만든다', () => {
    expect(greenlabsApiUrl('https://greenlabs.co.kr/%ec%b1%84%ec%9a%a9%ec%a0%95%eb%b3%b4/')).toBe(
      'https://greenlabs.co.kr/wp-json/wp/v2/recruit?per_page=100&_fields=id,link,title,content,status',
    );
  });
});
