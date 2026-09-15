import {
  assertNever,
  type ScrapeConfig,
  type ScrapeStrategy,
} from '@apply-manager/shared';
import type { ScrapeAdapter, ScrapeResult } from './types';
import { scrapeGreeting } from './adapters/greeting';
import { scrapeNinehire } from './adapters/ninehire';
import { scrapeLever } from './adapters/lever';
import { scrapeGreenhouse } from './adapters/greenhouse';
import { scrapeJobflex } from './adapters/jobflex';
import { scrapeBanksalad } from './adapters/banksalad';
import { scrapeNaver } from './adapters/naver';
import { scrapeKakao } from './adapters/kakao';
import { scrapeKakaobank } from './adapters/kakaobank';
import { scrapeSoop } from './adapters/soop';
import { scrapeSoomgo } from './adapters/soomgo';
import { scrapeSocar } from './adapters/socar';
import { scrapeFlexteam } from './adapters/flexteam';
import { scrapeAbly } from './adapters/ably';
import { scrapeDunamu } from './adapters/dunamu';
import { scrapeDealicious } from './adapters/dealicious';
import { scrapeBucketplace } from './adapters/bucketplace';
import { scrapeMillie } from './adapters/millie';
import { scrapeLlm } from './adapters/llm';

/**
 * 전략명 → 어댑터 매핑 (스펙 7-2).
 * satisfies로 scrape_strategy enum과 키가 1:1로 대응함을 컴파일 타임에 보장한다
 * — 전략이 추가되면 여기서 컴파일 에러가 난다.
 */
export const adapters = {
  greeting: scrapeGreeting,
  ninehire: scrapeNinehire,
  lever: scrapeLever,
  greenhouse: scrapeGreenhouse,
  jobflex: scrapeJobflex,
  banksalad: scrapeBanksalad,
  naver: scrapeNaver,
  kakao: scrapeKakao,
  kakaobank: scrapeKakaobank,
  soop: scrapeSoop,
  soomgo: scrapeSoomgo,
  socar: scrapeSocar,
  flexteam: scrapeFlexteam,
  ably: scrapeAbly,
  dunamu: scrapeDunamu,
  dealicious: scrapeDealicious,
  bucketplace: scrapeBucketplace,
  millie: scrapeMillie,
  llm: scrapeLlm,
} as const satisfies {
  [S in ScrapeStrategy]: ScrapeAdapter<Extract<ScrapeConfig, { strategy: S }>>;
};

/**
 * 검증된 ScrapeConfig(shared parseScrapeConfig 결과)를 해당 어댑터로 디스패치한다.
 * 오케스트레이터용 헬퍼 — switch + assertNever로 exhaustive 처리.
 */
export function runAdapter(config: ScrapeConfig): Promise<ScrapeResult[]> {
  switch (config.strategy) {
    case 'greeting':
      return adapters.greeting(config);
    case 'ninehire':
      return adapters.ninehire(config);
    case 'lever':
      return adapters.lever(config);
    case 'greenhouse':
      return adapters.greenhouse(config);
    case 'jobflex':
      return adapters.jobflex(config);
    case 'banksalad':
      return adapters.banksalad(config);
    case 'naver':
      return adapters.naver(config);
    case 'kakao':
      return adapters.kakao(config);
    case 'kakaobank':
      return adapters.kakaobank(config);
    case 'soop':
      return adapters.soop(config);
    case 'soomgo':
      return adapters.soomgo(config);
    case 'socar':
      return adapters.socar(config);
    case 'flexteam':
      return adapters.flexteam(config);
    case 'ably':
      return adapters.ably(config);
    case 'dunamu':
      return adapters.dunamu(config);
    case 'dealicious':
      return adapters.dealicious(config);
    case 'bucketplace':
      return adapters.bucketplace(config);
    case 'millie':
      return adapters.millie(config);
    case 'llm':
      return adapters.llm(config);
    default:
      return assertNever(config);
  }
}
