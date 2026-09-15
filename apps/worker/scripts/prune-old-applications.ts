import { lt } from 'drizzle-orm';
import { applications, createDb } from '@apply-manager/db';
import { retentionCutoff } from '../src/retention';

/**
 * 보존 기간 초과 지원건 자동 삭제 (지원일 기준).
 * appliedAt < (오늘 - RETENTION_MONTHS개월) 인 지원건을 삭제 → application_events는 FK cascade로 함께 삭제.
 * RETENTION_DRY_RUN=1 이면 삭제하지 않고 대상만 출력한다.
 *
 * 실행: pnpm --filter @apply-manager/worker prune-old
 */
const RETENTION_MONTHS = Number(process.env.RETENTION_MONTHS ?? '7');
const DRY_RUN = process.env.RETENTION_DRY_RUN === '1';

/** 오늘 날짜 'YYYY-MM-DD' (KST 기준) */
function kstToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function main(): Promise<void> {
  const cutoff = retentionCutoff(kstToday(), RETENTION_MONTHS);
  const { db, client } = createDb();
  try {
    if (DRY_RUN) {
      const targets = await db
        .select({
          id: applications.id,
          position: applications.position,
          appliedAt: applications.appliedAt,
        })
        .from(applications)
        .where(lt(applications.appliedAt, cutoff));
      console.log(
        `[prune] (dry-run) 기준일 ${cutoff} 미만 지원건 ${targets.length}건 (삭제 안 함)`,
      );
      for (const t of targets) console.log(`  - ${t.appliedAt} · ${t.position}`);
      return;
    }

    const deleted = await db
      .delete(applications)
      .where(lt(applications.appliedAt, cutoff))
      .returning({
        id: applications.id,
        position: applications.position,
        appliedAt: applications.appliedAt,
      });
    console.log(
      `[prune] 기준일 ${cutoff} 미만 지원건 ${deleted.length}건 삭제 완료 (이벤트 cascade 포함, 보존 ${RETENTION_MONTHS}개월)`,
    );
    for (const d of deleted) console.log(`  - ${d.appliedAt} · ${d.position}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[prune] fatal:', error);
  process.exit(1);
});
