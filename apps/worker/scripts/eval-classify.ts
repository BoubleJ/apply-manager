import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadLlmEnv, stageSchema } from '@apply-manager/shared';
import { classifyMail } from '../src/gmail/classify';
import type { ParsedMail } from '../src/gmail/parse-mail';

/**
 * 메일 분류 정확도 평가 스크립트 (스펙 6장 분류 정확도 평가셋).
 * fixtures/emails/*.json (gitignore됨 — 실제 수신 메일)을 읽어 classifyMail을 실행하고
 * 기대 stage와 비교해 정확도를 출력한다. 모델 교체·프롬프트 수정 시 회귀 확인용 —
 * env(LLM_MODEL_FILTER/EXTRACT)만 바꿔 재실행하면 모델 간 비교가 된다.
 *
 * fixture 형식은 fixtures/README.md 참고.
 */

const fixtureSchema = z.object({
  subject: z.string(),
  from: z.string().default(''),
  body: z.string(),
  receivedAt: z.string().optional(),
  /** 채용 전형과 무관한 메일이면 null */
  expectedStage: stageSchema.nullable(),
});

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/emails',
);

interface EvalRow {
  file: string;
  expected: string;
  predicted: string;
  correct: boolean;
}

async function main(): Promise<void> {
  const llmEnv = loadLlmEnv();

  let files: string[];
  try {
    files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    console.error(`fixture 디렉토리가 없습니다: ${FIXTURES_DIR}`);
    console.error('fixtures/README.md의 형식대로 실제 메일 fixture를 추가하세요.');
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`fixture가 없습니다 (${FIXTURES_DIR}/*.json). fixtures/README.md 참고.`);
    process.exit(1);
  }

  const rows: EvalRow[] = [];
  let filterCorrect = 0;
  let stageTotal = 0;
  let stageCorrect = 0;

  for (const file of files) {
    const raw: unknown = JSON.parse(
      await readFile(path.join(FIXTURES_DIR, file), 'utf8'),
    );
    const fixture = fixtureSchema.parse(raw);
    const mail: ParsedMail = {
      gmailMessageId: file,
      subject: fixture.subject,
      from: fixture.from,
      body: fixture.body,
      receivedAt: fixture.receivedAt ? new Date(fixture.receivedAt) : new Date(),
    };

    const result = await classifyMail(mail, llmEnv); // 순차 실행 (rate limit 고려)

    const expectedRelated = fixture.expectedStage !== null;
    const predictedStage = result.isRecruitingRelated ? result.extraction.stage : null;
    const expected = fixture.expectedStage ?? '(not recruiting)';
    const predicted = predictedStage ?? '(not recruiting)';

    if (expectedRelated === result.isRecruitingRelated) filterCorrect++;
    if (expectedRelated) {
      stageTotal++;
      if (predictedStage === fixture.expectedStage) stageCorrect++;
    }
    const correct = expected === predicted;
    rows.push({ file, expected, predicted, correct });
    console.log(`${correct ? 'PASS' : 'FAIL'} ${file}: expected=${expected} predicted=${predicted}`);
  }

  const overallCorrect = rows.filter((row) => row.correct).length;
  console.log('\n=== 평가 결과 ===');
  console.log(`모델: filter=${llmEnv.modelFilter} extract=${llmEnv.modelExtract}`);
  console.log(
    `필터 정확도 (채용 관련 여부): ${filterCorrect}/${rows.length} (${percent(filterCorrect, rows.length)})`,
  );
  console.log(
    `stage 정확도 (채용 관련 메일 대상): ${stageCorrect}/${stageTotal} (${percent(stageCorrect, stageTotal)})`,
  );
  console.log(
    `전체 정확도: ${overallCorrect}/${rows.length} (${percent(overallCorrect, rows.length)})`,
  );

  const failures = rows.filter((row) => !row.correct);
  if (failures.length > 0) {
    console.log('\n오분류 목록:');
    for (const row of failures) {
      console.log(`  ${row.file}: expected=${row.expected} predicted=${row.predicted}`);
    }
  }
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return '-';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

main().catch((error) => {
  console.error('[eval-classify] fatal:', error);
  process.exit(1);
});
