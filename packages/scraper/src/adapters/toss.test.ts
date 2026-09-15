import { describe, expect, it } from 'vitest';
import { loadJsonFixture } from '../../test/fixture';
import { parseTossResponse } from './toss';

// fixture: api-public.toss.im .../career/jobs 실측 응답에서 3건만 남기고 본문을 줄인 것 (2026-08).
// Job Category는 Backend(개발) / Sales(비개발) / All(모름)로 하나씩 배치했다.
describe('parseTossResponse', () => {
  it('제목 뒤에 계열사를 붙이고 마감일·본문을 뽑는다', () => {
    const postings = parseTossResponse(loadJsonFixture('toss-jobs.json'));

    // Sales 1건은 비개발로 걸러진다
    expect(postings).toHaveLength(2);
    // 제목에 계열사가 없으면 붙인다 — 안 붙이면 계열사끼리 구분이 안 된다
    expect(postings[0]).toMatchObject({
      title: 'AML Manager (토스증권)',
      url: 'https://toss.im/career/job-detail?gh_jid=5287825003',
    });
    expect(postings[0]?.description).toBeTruthy();
    expect(postings[0]?.deadline).toBeUndefined();

    // 제목에 이미 계열사가 드러나면 덧붙이지 않는다
    expect(postings[1]?.title).toBe('토스플레이스 하반기 전직군 얼리버드 전형(~8/10)');
    expect(postings[1]?.deadline).toBe('2026-08-10');
  });

  it('모르는 Job Category는 통과시킨다 — 개발 공고를 조용히 흘리지 않는다', () => {
    const data = loadJsonFixture('toss-jobs.json') as {
      success: { metadata: { name: string; value: unknown }[] }[];
    };
    for (const job of data.success) {
      const field = job.metadata.find((f) => f.name.includes('Job Category'))!;
      field.value = '새로 생긴 카테고리';
    }
    expect(parseTossResponse(data)).toHaveLength(3);
  });

  it('미노출 공고는 제외한다', () => {
    const data = loadJsonFixture('toss-jobs.json') as {
      success: { metadata: { name: string; value: unknown }[] }[];
    };
    data.success[0]!.metadata.find((f) => f.name.includes('미노출'))!.value = 'True';

    const postings = parseTossResponse(data);
    expect(postings).toHaveLength(1);
    expect(postings.map((p) => p.title)).not.toContain('AML Manager (토스증권)');
  });

  it('resultType이 SUCCESS가 아니면 throw한다', () => {
    const data = { ...(loadJsonFixture('toss-jobs.json') as object), resultType: 'FAIL' };
    expect(() => parseTossResponse(data)).toThrow(/unexpected resultType "FAIL"/);
  });

  it('공고가 하나도 없으면 빈 배열 대신 throw한다', () => {
    expect(() => parseTossResponse({ resultType: 'SUCCESS', success: [] })).toThrow(
      /no postings/,
    );
  });

  it('응답 모양이 바뀌면 throw한다', () => {
    expect(() => parseTossResponse({ resultType: 'SUCCESS', success: [{ title: 'x' }] })).toThrow();
  });
});
