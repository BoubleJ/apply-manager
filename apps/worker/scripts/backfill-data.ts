import type { Stage } from '@apply-manager/shared';

/**
 * Claude가 Gmail 커넥터로 직접 조회한 최근 6개월 채용전형 메일을 분류·그룹핑한 백필 데이터.
 * (무료 티어 LLM으로는 6개월 일괄 처리가 어려워 초기 적재만 수동 수행 — 이후는 sync-gmail 파이프라인)
 *
 * - 회사/직무/단계는 메일 제목·스니펫 기반으로 Claude가 분류
 * - occurredAt은 실제 메일 수신 시각(UTC ISO), gmailMessageId는 역추적용 근거
 * - needsReview=true: 지원완료 메일 미포착, 플랫폼(원티드 등) 경유 추정 등 사용자 확인 권장 건
 */

export interface BackfillEvent {
  stage: Stage;
  /** 메일 수신 시각 (UTC ISO) */
  occurredAt: string;
  gmailMessageId: string;
  summary: string;
  confidence: number;
  needsReview: boolean;
}

export interface BackfillApplication {
  company: string;
  position: string | null;
  /** 지원일 (YYYY-MM-DD) */
  appliedAt: string;
  /** applications.current_stage 캐시로 사용할 최종 단계 */
  finalStage: Stage;
  /** 시간순 정렬된 이벤트 */
  events: BackfillEvent[];
}

const clear = (confidence = 0.95) => ({ confidence, needsReview: false });
const review = (confidence = 0.5) => ({ confidence, needsReview: true });

export const BACKFILL: BackfillApplication[] = [
  // --- CJ올리브영 ---
  {
    company: 'CJ올리브영',
    position: 'Global Software Engineer-Frontend (글로벌 개발)',
    appliedAt: '2026-07-04',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-07-04T06:11:02Z', gmailMessageId: '19f2bc08143adf03', summary: '지원 정상 완료', ...clear() },
    ],
  },
  {
    company: 'CJ올리브영',
    position: '커머스플랫폼유닛 Front-end 개발',
    appliedAt: '2026-05-02',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-05-02T08:52:39Z', gmailMessageId: '19de7e3d18215242', summary: '지원 정상 완료', ...clear() },
    ],
  },

  // --- 컬리 ---
  {
    company: '컬리',
    position: '커머스 주니어 프론트엔드 개발자',
    appliedAt: '2026-05-18',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-05-18T12:59:34Z', gmailMessageId: '19e3b2ba3a2310fd', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-29T08:30:32Z', gmailMessageId: '19e72db4ac622948', summary: '서류 불합격', ...clear() },
    ],
  },
  {
    company: '컬리',
    position: '풀필먼트 프론트엔드 개발자',
    appliedAt: '2026-05-10',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-05-10T16:20:58Z', gmailMessageId: '19e12b1225f64d76', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-13T05:01:20Z', gmailMessageId: '19e1fb5ffe39fb92', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 삼쩜삼(자비스앤빌런즈) ---
  {
    company: '삼쩜삼(자비스앤빌런즈)',
    position: 'Frontend Engineer(세무기장)',
    appliedAt: '2026-05-09',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-05-09T06:21:18Z', gmailMessageId: '19e0b65c37a7798d', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-12T02:03:14Z', gmailMessageId: '19e19ec942f81585', summary: '서류 불합격 (포지션 방향성 상이)', ...clear() },
    ],
  },
  {
    company: '삼쩜삼(자비스앤빌런즈)',
    position: 'Frontend Engineer(고향사랑기부제)',
    appliedAt: '2026-04-19',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-04-19T15:48:34Z', gmailMessageId: '19da66df1fe3783c', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-04-23T02:26:51Z', gmailMessageId: '19db8295e33ab128', summary: '서류 불합격 (포지션 방향성 상이)', ...clear() },
    ],
  },
  {
    company: '삼쩜삼(자비스앤빌런즈)',
    position: null,
    appliedAt: '2026-01-16',
    finalStage: 'rejected',
    events: [
      { stage: 'assignment', occurredAt: '2026-01-16T04:49:29Z', gmailMessageId: '19bc523161b2b67c', summary: '채용 과제 안내 (제출 기한 1/19) — 지원완료 메일 미포착', ...review() },
      { stage: 'rejected', occurredAt: '2026-01-27T08:34:16Z', gmailMessageId: '19bfe971d1aba332', summary: '과제 전형 불합격', ...review(0.6) },
    ],
  },

  // --- 강남언니 (힐링페이퍼) ---
  {
    company: '강남언니',
    position: '[병원 운영 솔루션] 웹 프론트엔드 개발자 (B2B SaaS)',
    appliedAt: '2026-04-19',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-04-19T05:54:56Z', gmailMessageId: '19da44e6c468ddbb', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-04-23T05:00:52Z', gmailMessageId: '19db8b66186737b0', summary: '서류 불합격 (다음 프로세스 진행 어려움)', ...clear() },
    ],
  },

  // --- 무신사 ---
  {
    company: '무신사',
    position: 'Frontend Engineer (29CM/고객 경험)',
    appliedAt: '2026-04-18',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-04-18T15:50:28Z', gmailMessageId: '19da1494db4b713d', summary: '지원 정상 완료', ...clear() },
    ],
  },

  // --- 카카오모빌리티 ---
  {
    company: '카카오모빌리티',
    position: '웹 프론트엔드 개발자',
    appliedAt: '2026-04-15',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-04-15T14:23:57Z', gmailMessageId: '19d918702615f19b', summary: '지원 정상 완료', ...clear() },
    ],
  },

  // --- 아임웹 ---
  {
    company: '아임웹',
    position: 'Front-end Engineer',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T08:01:31Z', gmailMessageId: '19bcaf9495b2177e', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-20T01:17:28Z', gmailMessageId: '19bd8fa6fefc3407', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 콘텐츠웨이브 ---
  {
    company: '콘텐츠웨이브',
    position: '[Tech] 웹 개발자 / 웹 플레이어 개발자',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T06:53:29Z', gmailMessageId: '19bcabaf86bb52be', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-02-05T08:53:51Z', gmailMessageId: '19c2d02015b067f3', summary: '지원 결과 안내 (불합격)', ...clear() },
    ],
  },

  // --- 오늘의집 ---
  {
    company: '오늘의집',
    position: 'Frontend Engineer, Interior & Life',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T05:21:15Z', gmailMessageId: '19bca668f05ed3b7', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-02-20T05:53:23Z', gmailMessageId: '19c799c2e3f3dda9', summary: '서류 불합격', ...clear() },
    ],
  },
  {
    company: '오늘의집',
    position: 'Frontend Engineer, Client Foundation',
    appliedAt: '2026-01-26',
    finalStage: 'document_rejected',
    events: [
      { stage: 'document_rejected', occurredAt: '2026-01-26T08:50:50Z', gmailMessageId: '19bf97fa9c1510f1', summary: '서류 불합격 — 지원완료 메일 미포착', ...review() },
    ],
  },

  // --- 마이리얼트립 ---
  {
    company: '마이리얼트립',
    position: 'Growth실 광고 Product Engineer - Ad Experience',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T04:41:50Z', gmailMessageId: '19bca4270a8c91fc', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-28T06:00:28Z', gmailMessageId: '19c03306886178bd', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 놀유니버스 ---
  {
    company: '놀유니버스',
    position: '[집중채용] Software Engineer, Frontend - 웹개발',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T04:37:36Z', gmailMessageId: '19bca3e9993f675a', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-30T09:25:13Z', gmailMessageId: '19c0e3890035ad8d', summary: '서류 불합격', ...clear() },
    ],
  },
  {
    company: '놀유니버스',
    position: 'Software Engineer, Frontend - 해외 숙소',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T04:40:24Z', gmailMessageId: '19bca4128d53a8d2', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-02-24T02:00:42Z', gmailMessageId: '19c8d60940cd3b97', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- PFCT (피에프씨테크놀로지스) ---
  {
    company: 'PFCT',
    position: 'Frontend Engineer(프론트엔드 엔지니어)',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T03:16:13Z', gmailMessageId: '19bc9f4151ab1311', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-23T01:30:14Z', gmailMessageId: '19be87935da98bef', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- t'order Inc. ---
  {
    company: "t'order Inc.",
    position: '광고플랫폼팀 Front-End 시니어 개발자',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T03:06:02Z', gmailMessageId: '19bc9eabcc547c5d', summary: '지원 정상 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-02-20T06:41:46Z', gmailMessageId: '19c79c87d078d084', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 화이트큐브 ---
  {
    company: '화이트큐브',
    position: '[챌린저스] 프론트엔드 개발자 (3년 이상)',
    appliedAt: '2026-01-22',
    finalStage: 'document_rejected',
    events: [
      { stage: 'document_rejected', occurredAt: '2026-01-22T00:00:32Z', gmailMessageId: '19be300bb1b78193', summary: '서류 불합격 — 지원완료 메일 미포착', ...review() },
    ],
  },

  // --- 레디포스트 (ReadyPost) ---
  {
    company: '레디포스트',
    position: '주니어 프론트엔드 개발자',
    appliedAt: '2026-01-15',
    finalStage: 'document_rejected',
    events: [
      { stage: 'document_rejected', occurredAt: '2026-01-15T04:23:40Z', gmailMessageId: '19bbfe51ea425bd5', summary: '서류 불합격 — 지원완료 메일 미포착', ...review() },
    ],
  },

  // --- 토스증권 ---
  {
    company: '토스증권',
    position: 'Frontend Developer',
    appliedAt: '2026-03-31',
    finalStage: 'rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-03-31T15:29:05Z', gmailMessageId: '19d448341476ac38', summary: '지원 정상 접수', ...clear() },
      { stage: 'document_passed', occurredAt: '2026-04-06T07:02:11Z', gmailMessageId: '19d6199531165bb2', summary: '서류 합격 — 사전과제 안내', ...clear() },
      { stage: 'assignment', occurredAt: '2026-04-18T05:00:03Z', gmailMessageId: '19d9ef5d6fa0a0dc', summary: '사전과제 전달 (수행 6시간, 4/18 진행)', ...clear() },
      { stage: 'rejected', occurredAt: '2026-04-24T00:00:00Z', gmailMessageId: '19dbcc9484a44a55', summary: '과제 전형 불합격', ...clear() },
    ],
  },
  {
    company: '토스증권',
    position: 'Frontend UX Engineer',
    appliedAt: '2026-03-31',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-03-31T14:29:10Z', gmailMessageId: '19d444c6bf947776', summary: '지원 정상 접수', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-04-06T23:00:18Z', gmailMessageId: '19d65068779a002b', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 토스뱅크 ---
  {
    company: '토스뱅크',
    position: 'Frontend Developer',
    appliedAt: '2026-03-31',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-03-31T13:03:29Z', gmailMessageId: '19d43fe0d7a499f6', summary: '지원 정상 접수 (2026 전직군 대규모 채용)', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-04-02T07:00:21Z', gmailMessageId: '19d4cfe3708eddd5', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 토스 (토스커뮤니티) ---
  {
    company: '토스',
    position: '[FE 모닥불] Frontend Developer',
    appliedAt: '2026-04-26',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-04-26T13:29:04Z', gmailMessageId: '19dc9fab874434e6', summary: '지원 정상 접수', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-11T05:30:03Z', gmailMessageId: '19e158391aae089e', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 토스인슈어런스 ---
  {
    company: '토스인슈어런스',
    position: 'Frontend Developer',
    appliedAt: '2026-07-03',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-07-03T18:05:14Z', gmailMessageId: '19f2927fea7aedd7', summary: '지원 정상 접수', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-07-08T09:00:53Z', gmailMessageId: '19f40f56fad31784', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 당근 ---
  {
    company: '당근',
    position: 'Software Engineer, Frontend | 커뮤니티 (모임)',
    appliedAt: '2026-05-24',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-05-24T15:14:04Z', gmailMessageId: '19e5a8ce9d54cbc2', summary: '지원서 도착', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-28T07:56:45Z', gmailMessageId: '19e6d95fb0a282b3', summary: '전형 결과 불합격', ...clear() },
    ],
  },
  {
    company: '당근',
    position: 'Software Engineer, Frontend - 커머스',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T04:48:06Z', gmailMessageId: '19bca483061d0860', summary: '지원서 도착', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-19T03:40:56Z', gmailMessageId: '19bd457687cb74bd', summary: '전형 결과 불합격', ...clear() },
    ],
  },
  {
    company: '당근',
    position: 'Software Engineer, Frontend - 프론트엔드코어 (Product)',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T04:49:07Z', gmailMessageId: '19bca4921f31b88a', summary: '지원서 도착', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-27T01:07:39Z', gmailMessageId: '19bfcfdf9b9d976a', summary: '전형 결과 불합격', ...clear() },
    ],
  },

  // --- 당근페이 ---
  {
    company: '당근페이',
    position: 'Software Engineer, Frontend - 당근페이',
    appliedAt: '2026-01-17',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T04:47:07Z', gmailMessageId: '19bca4749382db1a', summary: '지원서 도착', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-01-23T01:08:00Z', gmailMessageId: '19be864d87914f92', summary: '전형 결과 불합격', ...clear() },
    ],
  },

  // --- 우아한형제들 ---
  {
    company: '우아한형제들',
    position: 'WebFrontend(주문접수채널)',
    appliedAt: '2026-05-24',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-05-24T13:41:14Z', gmailMessageId: '19e5a37efb35b509', summary: '지원서 접수 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-26T06:29:02Z', gmailMessageId: '19e62f8f40f88ca1', summary: '이후 전형 미진행 (불합격)', ...clear() },
    ],
  },
  {
    company: '우아한형제들',
    position: 'WebFrontend(CX프로덕트)',
    appliedAt: '2026-05-24',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-05-24T13:39:38Z', gmailMessageId: '19e5a36782443ffb', summary: '지원서 접수 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-06-16T00:37:14Z', gmailMessageId: '19ecddc6cfb28a40', summary: '이후 전형 미진행 (불합격)', ...clear() },
    ],
  },

  // --- 카카오뱅크 ---
  {
    company: '카카오뱅크',
    position: '프론트엔드 개발자',
    appliedAt: '2026-04-15',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-04-15T16:50:53Z', gmailMessageId: '19d920d8a76d4af8', summary: '입사지원서 제출 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-05-15T09:30:22Z', gmailMessageId: '19e2af905dc407b6', summary: '서류전형 불합격', ...clear() },
    ],
  },

  // --- AB180 (나인하이어 접수) ---
  {
    company: 'AB180',
    position: 'Frontend Engineer',
    appliedAt: '2026-06-01',
    finalStage: 'document_rejected',
    events: [
      { stage: 'applied', occurredAt: '2026-06-01T16:21:37Z', gmailMessageId: '19e83fdaa36565c9', summary: '지원서 접수 완료', ...clear() },
      { stage: 'document_rejected', occurredAt: '2026-06-04T05:00:14Z', gmailMessageId: '19e9100e9907829e', summary: '서류 불합격', ...clear() },
    ],
  },

  // --- 월급쟁이부자들 (나인하이어) ---
  {
    company: '월급쟁이부자들',
    position: 'Sr. Software Engineer(FE)',
    appliedAt: '2026-06-03',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-06-03T09:28:59Z', gmailMessageId: '19e8cd098b6412b3', summary: '지원서 접수 완료 (이후 담당자 메시지 2건은 플랫폼 확인 필요)', ...clear(0.8) },
    ],
  },

  // --- 번개장터 (나인하이어) ---
  {
    company: '번개장터',
    position: 'Frontend Software Engineer',
    appliedAt: '2026-01-17',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-01-17T03:29:39Z', gmailMessageId: '19bca0062e3bf30b', summary: '지원서 접수 완료', ...clear() },
    ],
  },

  // --- Channel Talk (Lever) ---
  {
    company: 'Channel Talk',
    position: 'Software Engineer',
    appliedAt: '2026-04-19',
    finalStage: 'applied',
    events: [
      { stage: 'applied', occurredAt: '2026-04-19T07:16:02Z', gmailMessageId: '19da498af2fa32ee', summary: 'Application received', ...clear() },
    ],
  },

  // --- 인프랩 (랠릿) ---
  {
    company: '인프랩',
    position: '프론트엔드 개발자',
    appliedAt: '2026-04-22',
    finalStage: 'document_rejected',
    events: [
      { stage: 'document_rejected', occurredAt: '2026-04-22T08:08:00Z', gmailMessageId: '19db43b5bdfbd1b0', summary: '서류 불합격 — 지원완료 메일 미포착', ...review() },
    ],
  },

  // --- 플레이스앤 (원티드 경유 서류통과 알림) ---
  {
    company: '플레이스앤',
    position: 'Software Engineer, Front-end (네이버 계열사)',
    appliedAt: '2026-01-27',
    finalStage: 'document_passed',
    events: [
      { stage: 'document_passed', occurredAt: '2026-01-27T05:07:13Z', gmailMessageId: '19bfdd946eea3855', summary: '서류 통과 (원티드 면접 일정 리마인드로 확인) — 확인 권장', ...review() },
    ],
  },
];

/**
 * 이벤트로는 적재하지 않지만 재처리 방지를 위해 processed_messages에 기록할 메시지 ID.
 * (이메일 인증/검증, 인증번호, 일정 리마인드, NDA, 결과 지연 안내, 파기 안내, 중복 발송, 플랫폼 알림 등)
 */
export const PROCESSED_ONLY: string[] = [
  // 그리팅 "지원서 이메일 확인 안내" (검증 메일)
  '19f2bbfe73ae3e2b', '19e3b2aaf9e33471', '19e12add6cabfbc0', '19de7f986c047ab5',
  '19de80047ec3bbf9', '19de1e6a3a3b0680', '19dcf8ea7e10d0d8', '19e0b64df98fa254',
  '19da44df7afca120', '19da572c30e4e080', '19da57561e15628e', '19da148bba5e2e6d',
  '19d9185586f05abb', '19bc9e8913aff05f', '19bc9f293550e724', '19bca3d3df276a34',
  '19bca3fb4a706816',
  // 인증번호/로그인 코드
  '19d918a65c7baf6a', '19d775701dd118ba',
  // 우아한형제들 지원자 등록 인증메일
  '19e59e8ed6e2991a',
  // 삼쩜삼 일정 리마인드
  '19bc511e79ecc190', '19bbf624a01942ba',
  // 토스증권 NDA 서명 요청 / 사전과제 일정 안내(assignment 이벤트와 중복)
  '19d672188aa9f57c', '19d67217b8365fe6',
  // 카카오뱅크 서류결과 지연 안내
  '19e00ced30e8dc16',
  // 한화시스템 지원정보 파기 안내
  '19f40fbc6878d886',
  // 월급쟁이부자들 담당자 메시지 도착 (내용은 플랫폼에 있음)
  '19e8cd9c03764b31', '19ea5d13d22be43a',
  // 놀유니버스 서류결과 중복 발송 + 지원완료 중복
  '19c0e38f7d549ffb', '19c0e3a2d7a031ec', '19c0e3a33d4362d1', '19bca3fe0d726292',
  // 검증/근거 부족 (직무 미상 · 검증 메일만 존재): 111퍼센트, Buzzvil
  '19f41e15b6323dd8', '19bca0756a15d1e4',
];
