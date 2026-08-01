import { defineConfig } from 'drizzle-kit';

/**
 * push/pull만 세션 풀러(5432)로 돌린다.
 *
 * 트랜잭션 풀러(6543)는 연결 하나를 질의 단위로 돌려쓰기 때문에 drizzle-kit의 연속
 * introspection 질의에서 응답이 섞인다 — CHECK 제약 조회 자리에 foreign key 결과가 들어와
 * `TypeError: ... (reading 'replace')`로 죽는다 (2026-08-01 실측, drizzle-kit 0.31.10).
 * 앱 클라이언트는 client.ts의 prepare:false로 이 함정을 피하지만 drizzle-kit엔 그런 옵션이 없다.
 *
 * 5432여도 반드시 pooler 호스트여야 한다 — 직접 연결(db.<ref>.supabase.co)은 IPv6 전용이라
 * 이 WSL2 환경에서 접속되지 않는다.
 */
function toSessionPooler(url: string): string {
  return url.replace(/:6543(?=[/?]|$)/, ':5432');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // generate는 접속 정보가 필요 없다. push/pull 시에만 DATABASE_URL이 필요하다.
  dbCredentials: { url: toSessionPooler(process.env.DATABASE_URL ?? '') },
});
