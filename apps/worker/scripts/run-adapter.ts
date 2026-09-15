import { runAdapter } from '@apply-manager/scraper';
import { parseScrapeConfig, type ScrapeStrategy } from '@apply-manager/shared';

/**
 * 임시 진단용: 특정 전략+URL로 어댑터를 실행해 ScrapeResult[]를 JSON으로 출력한다.
 * 수동 적재(scrape-company) 시 크론 어댑터와 title·url을 글자단위로 맞춰 해시를 일치시키기 위함.
 * 사용: pnpm --filter @apply-manager/worker tsx scripts/run-adapter.ts <strategy> <url>
 */
async function main(): Promise<void> {
  const [strategy, url] = process.argv.slice(2);
  if (!strategy || !url) throw new Error('usage: run-adapter <strategy> <url>');
  const config = parseScrapeConfig(strategy as ScrapeStrategy, { url });
  const results = await runAdapter(config);
  process.stdout.write(JSON.stringify(results, null, 2));
  process.stderr.write(`\n[run-adapter] ${strategy} ${url} → ${results.length} postings\n`);
}

main().catch((error) => {
  console.error('[run-adapter] fatal:', error);
  process.exit(1);
});
