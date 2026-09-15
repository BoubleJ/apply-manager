import { createDb, type Db } from "@apply-manager/db";

/**
 * RSC/Server Action 공용 lazy Drizzle 클라이언트.
 *
 * - 모듈 로드 시점이 아니라 첫 호출 시점에 연결을 만들므로
 *   DATABASE_URL 없이도 next build가 가능하다 (페이지는 force-dynamic).
 * - dev HMR로 모듈이 재평가돼도 연결이 늘지 않도록 globalThis에 캐시한다.
 */
const globalForDb = globalThis as unknown as { __jobTrackerDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__jobTrackerDb) {
    globalForDb.__jobTrackerDb = createDb().db;
  }
  return globalForDb.__jobTrackerDb;
}
