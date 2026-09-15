import { eq } from 'drizzle-orm';
import { companies, createDb, jobPostings } from '@apply-manager/db';
import { normalizeCompanyName } from '@apply-manager/shared';

/** 임시 진단용: 회사명들의 적재 공고를 출력한다. 사용: tsx scripts/verify-company.ts <회사명...> */
async function main(): Promise<void> {
  const names = process.argv.slice(2);
  const { db, client } = createDb();
  try {
    const all = await db.select().from(companies);
    for (const name of names) {
      const key = normalizeCompanyName(name);
      const co = all.find((c) => normalizeCompanyName(c.name) === key);
      if (!co) {
        console.log(`\n[${name}] 회사 없음`);
        continue;
      }
      const posts = await db
        .select()
        .from(jobPostings)
        .where(eq(jobPostings.companyId, co.id));
      console.log(
        `\n[${co.name}] strategy=${co.scrapeStrategy} careersUrl=${JSON.stringify(co.careersUrl)} — ${posts.length}건`,
      );
      for (const p of posts) {
        console.log(`  ${p.status} | ${p.category} | ${p.title}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[verify-company] fatal:', error);
  process.exit(1);
});
