import { describe, expect, it } from 'vitest';
import { loadJsonFixture } from '../../test/fixture';
import { parseRiversDeadline, parseRiversPositions } from './rivers';

// fixture: api.rivers.saramin.co.kr/career/493/positions 실측 응답에서 4건만 남기고 본문을 줄인 것 (2026-08).
// 공개 개발 1건 / 공개 비개발 1건 / 마감(INACT) 1건 / 미노출(recruitSitePostingYn=NO) 1건.
const ORIGIN = 'https://cupist.career.rivers.co.kr';

describe('parseRiversPositions', () => {
  it('공개 중인 공고만 제목·URL·본문으로 뽑는다', () => {
    const { postings, totalPages } = parseRiversPositions(
      loadJsonFixture('rivers-positions.json'),
      ORIGIN,
    );

    expect(totalPages).toBe(1);
    // 마감(INACT) 1건 + 미노출 1건은 걸러진다
    expect(postings).toHaveLength(2);
    expect(postings[0]).toMatchObject({
      recruitNo: 6517,
      title: '[글로벌 AI Chat] 백엔드 개발자',
      url: `${ORIGIN}/position/6517`,
    });
    expect(postings[0]?.description).toBeTruthy();
    // 마감일은 목록에 없다 — 상세에서만 온다
    expect(postings[0]?.deadline).toBeUndefined();
  });

  it('마감된 공고는 목록에 남아 있어도 제외한다', () => {
    const { postings } = parseRiversPositions(loadJsonFixture('rivers-positions.json'), ORIGIN);
    expect(postings.map((p) => p.title)).not.toContain('백엔드 개발자 (Python)');
  });

  it('응답 모양이 바뀌면 throw한다', () => {
    expect(() => parseRiversPositions({ body: { content: [{ recruitNo: 1 }] } }, ORIGIN)).toThrow();
  });
});

describe('parseRiversDeadline', () => {
  it('상시채용(ALWAYS)이면 마감일이 없다', () => {
    expect(
      parseRiversDeadline({
        body: { recruitApplyCloseCode: 'ALWAYS', recruitApplyCloseDateTime: '9999-12-31T00:00:00' },
      }),
    ).toBeUndefined();
  });

  it('마감일이 걸려 있으면 YYYY-MM-DD로 뽑는다', () => {
    expect(
      parseRiversDeadline({
        body: { recruitApplyCloseCode: 'DATE', recruitApplyCloseDateTime: '2026-09-30T23:59:59' },
      }),
    ).toBe('2026-09-30');
  });

  it('코드 없이 9999로만 오는 경우도 마감일로 보지 않는다', () => {
    expect(
      parseRiversDeadline({
        body: { recruitApplyCloseCode: null, recruitApplyCloseDateTime: '9999-12-31T00:00:00' },
      }),
    ).toBeUndefined();
  });
});
