# 입사지원 트래커 (Job Application Tracker)

개인용 입사지원 현황 대시보드 + 채용공고 수집 서비스.
Gmail을 조회해 지원 관련 메일을 LLM으로 분류·정리하고, 관심 기업들의 채용공고를 스크래핑해 한 곳에서 보여준다.

## 1. 프로젝트 개요

세 개의 독립적인 실행 단위로 구성된다:

1. **웹 대시보드** — 지원현황/채용공고를 보여주는 Next.js 앱 (조회 중심)
2. **메일 수집 워커** — Gmail API로 메일을 증분 조회하고 LLM으로 분류해 DB에 적재 (GitHub Actions cron)
3. **공고 스크래퍼 워커** — 기업별 ATS/채용페이지에서 공고를 수집해 DB에 적재 (GitHub Actions cron)

## 2. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프론트/API | Next.js (App Router) + TypeScript | RSC 우선, 클라이언트 컴포넌트 최소화 |
| 스타일링 | Tailwind CSS | |
| UI 컴포넌트 | shadcn/ui | 코드가 레포로 복사되는 방식. RSC 호환, Radix 기반 접근성 |
| 차트 | Recharts | 대시보드 단계별 현황 시각화 |
| 서버 상태 | TanStack Query | 클라이언트 인터랙션이 필요한 곳에만 제한적으로 사용 |
| 검증 | Zod | LLM 응답·ATS 응답 등 모든 외부 데이터 경계에서 런타임 검증 |
| DB | Supabase (Postgres) | 무료 티어 |
| ORM | Drizzle ORM | 스키마를 packages/db에서 공유 |
| 워커 런타임 | GitHub Actions cron + tsx | 하루 2~3회 실행 |
| LLM | Groq API (OpenAI 호환) — 필터: `openai/gpt-oss-20b`, 추출: `openai/gpt-oss-120b` | Structured Outputs(JSON Schema) 사용. base URL/모델명은 env로 분리해 업체·모델 교체 가능하게 |
| 스크래핑 | ATS별 어댑터 (fetch 기반), 범용 폴백은 LLM 추출 | 필요 시에만 Playwright |
| 모노레포 | pnpm workspace + Turborepo | |
| 배포 | Vercel (web) | 워커는 배포 없음 (Actions에서 실행) |

## 3. 모노레포 구조

```
.
├── apps/
│   ├── web/                  # Next.js 대시보드
│   │   ├── app/
│   │   │   ├── layout.tsx        # 공통 레이아웃 (네비게이션)
│   │   │   ├── page.tsx          # 지원현황 대시보드 (/)
│   │   │   └── jobs/
│   │   │       └── page.tsx      # 채용공고 리스트 (/jobs)
│   │   └── components/
│   │       ├── ui/               # shadcn 컴포넌트 (Badge, Card, Table 등)
│   │       ├── applications/     # 지원현황 도메인 (SummaryCards, StageFunnel, ApplicationTable, EventTimeline 등)
│   │       └── jobs/             # 공고 도메인 (JobCard, CompanyGroup, JobFilter, CompanyRegisterForm 등)
│   └── worker/               # cron 스크립트 진입점
│       ├── src/
│       │   ├── sync-gmail.ts     # 메일 수집 + LLM 분류
│       │   └── scrape-jobs.ts    # 공고 스크래핑
├── packages/
│   ├── db/                   # Drizzle 스키마 + 클라이언트 (web/worker 공유)
│   ├── scraper/              # ATS별 스크래핑 어댑터
│   │   └── src/
│   │       ├── types.ts          # ScrapeResult, ScrapeAdapter 공통 타입
│   │       ├── registry.ts       # 전략명 → 어댑터 매핑
│   │       └── adapters/
│   │           ├── greeting.ts
│   │           ├── ninehire.ts
│   │           ├── lever.ts
│   │           ├── greenhouse.ts
│   │           └── llm.ts        # 범용 폴백 (자체 채용페이지)
│   └── shared/               # 공용 타입, Zod 스키마, 유틸
├── .github/workflows/
│   ├── sync-gmail.yml        # cron: 하루 3회
│   └── scrape-jobs.yml       # cron: 3일 1회
├── turbo.json
└── pnpm-workspace.yaml
```

라우팅은 App Router 관례를 따른다 — `app/` 하위 폴더 경로가 곧 URL이며, 각 `page.tsx`는 RSC로서 `packages/db`를 직접 조회하고 표현은 `components/` 하위 도메인 컴포넌트에 위임한다.

## 4. DB 스키마 (Drizzle)

지원현황은 "현재 상태 컬럼"이 아니라 **이벤트 로그**로 쌓는다. 대시보드의 단계별 현황은 이벤트를 집계해 도출한다. LLM 분류가 틀렸을 때 원본 메일로 역추적할 수 있어야 한다.

### companies
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| name | text | 회사명 |
| careers_url | text | 채용페이지 URL (사람이 보는 용도) |
| scrape_strategy | enum | `greeting` \| `ninehire` \| `lever` \| `greenhouse` \| `llm` |
| scrape_config | jsonb | 전략별 설정 (아래 8-3 참고). 전략별 Zod 스키마로 검증 |
| reapply_policy | enum | 재지원 가능 여부: `allowed` \| `not_allowed` \| `conditional` \| `unknown` (기본값 unknown) |
| duplicate_apply_policy | enum | 중복지원(동시 복수 포지션 지원) 가능 여부: `allowed` \| `not_allowed` \| `conditional` \| `unknown` |
| policy_note | text nullable | 채용페이지 원문 근거 문구 (예: "재지원은 6개월 이후 가능합니다") |
| policy_source_url | text nullable | 정책 문구를 발견한 페이지 URL (역추적용) |
| policy_checked_at | timestamptz nullable | 마지막 정책 추출 시각 |
| created_at | timestamptz | |

### job_postings
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| title | text | 공고명 |
| category | enum | 개발 직군 분류: `frontend` \| `backend` \| `fullstack` \| `mobile` \| `devops` \| `data_ai` \| `qa` \| `etc_dev` — 비개발 직군 공고는 수집 단계에서 제외되므로 이 테이블에 존재하지 않는다 (7-7 참고) |
| url | text | 원문 URL |
| description | text nullable | 요약/본문 |
| deadline | date nullable | 마감일 (상시채용이면 null) |
| content_hash | text unique | 중복 수집 방지용 해시 (company_id + title + url 기반) |
| status | enum | `open` \| `closed` |
| first_seen_at | timestamptz | |
| last_seen_at | timestamptz | 스크래핑 시마다 갱신, 미발견 시 closed 처리 근거 |

### applications
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| job_posting_id | uuid FK nullable | 공고와 매칭되면 연결 |
| position | text | 지원 직무 |
| applied_at | date | 지원일 |
| current_stage | enum | 이벤트 집계로 파생되는 캐시 값 (아래 stage enum과 동일) |
| created_at | timestamptz | |

### application_events
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| application_id | uuid FK → applications | |
| stage | enum | `applied` \| `document_passed` \| `document_rejected` \| `assignment` \| `interview_1` \| `interview_1_passed` \| `interview_2` \| `final_passed` \| `rejected` \| `offer` \| `withdrawn` |
| occurred_at | timestamptz | 메일 수신 시각 기준 |
| gmail_message_id | text nullable | 근거 메일 ID (역추적용) |
| summary | text nullable | LLM이 추출한 한 줄 요약 |
| confidence | real nullable | LLM 분류 신뢰도 |
| needs_review | boolean default false | 낮은 confidence 또는 비정상 상태 전이 감지 시 true |
| created_at | timestamptz | |

### gmail_sync_state
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | int PK (단일 행) | |
| history_id | text | Gmail 증분 동기화 커서 |
| last_synced_at | timestamptz | |

### processed_messages
| 컬럼 | 타입 | 설명 |
|---|---|---|
| gmail_message_id | text PK | 중복 처리 방지 |
| is_recruiting_related | boolean | 채용 무관 메일도 기록해 재처리 방지 |
| processed_at | timestamptz | |

## 5. 페이지 명세

### 5-1. 지원현황 대시보드 (`/`)

- 상단 요약 카드: 전체 지원 수, 진행 중, 서류합격률, 최종합격/오퍼 수
- 단계별 퍼널 차트 (Recharts): 지원 → 서류합격 → 1차면접 → 2차면접 → 최종
- 지원 목록 테이블: 회사명, 직무, 지원일, 현재 단계(배지), 최근 이벤트 요약
  - 단계별 필터 (전체 / 진행중 / 서류탈락 / 면접중 / 합격 / 탈락)
  - 행 클릭 시 상세: 해당 지원 건의 이벤트 타임라인 표시
- 데이터 조회는 RSC에서 Drizzle로 직접. 필터링은 URL searchParams 기반 (클라이언트 상태 최소화)

### 5-2. 채용공고 목록 (`/jobs`)

- 기업별 그룹 또는 플랫 리스트 토글
- 공고 카드: 회사명, 공고명, 마감일(D-day), 원문 링크, `open`/`closed` 배지
- 필터: 직군 카테고리(frontend/backend/devops 등), 회사, 진행 중 여부
- 공고 카드에 카테고리 배지 표시, 배지 클릭으로 오분류 수동 수정 (Server Action)
- 신규 공고 표시: `first_seen_at`이 최근 3일 이내면 NEW 배지
- 회사별 재지원/중복지원 정책 배지 (unknown이면 미표시)
- 공고에서 바로 "지원 기록 추가" 액션 (applications 수동 생성, Server Action 사용)
- 회사 등록 UI: 회사명 + 채용페이지 URL + 전략 선택 + scrape_config 입력 폼. 등록 시 지원 정책 추출(7-6) 1회 실행

## 6. 메일 수집 워커 (`sync-gmail.ts`)

### 흐름
1. `gmail_sync_state.history_id`로 Gmail API 증분 조회 (`users.history.list`). 최초 실행이면 최근 N일 검색 쿼리로 대체
2. `processed_messages`에 없는 메일만 처리
3. 파이프라인 (작은 단일 책임 함수들의 조합):
   - `fetchMessages` → `parseMailContent` (제목/본문/발신자 추출, HTML 스트립) → `classifyMail` (LLM) → `matchApplication` (기존 지원 건 매칭 또는 신규 생성) → `validateTransition` (상태 전이 검증) → `persistEvent`
4. 처리 결과와 무관하게 `processed_messages`에 기록, `history_id` 갱신

### LLM 분류
- 2단계 프롬프트, 단계별로 다른 모델 사용:
  1. **필터** (`LLM_MODEL_FILTER`, gpt-oss-20b): 채용 관련 메일인가? (지원 접수/서류 결과/면접 안내/최종 결과/오퍼) — 아니면 즉시 스킵. 물량이 가장 많은 구간이므로 저가 모델 사용
  2. **추출** (`LLM_MODEL_EXTRACT`, gpt-oss-120b): 회사명, 직무, stage(위 enum 중 하나), 한 줄 요약, confidence. 완곡한 한국어 통보 문구의 뉘앙스 해석이 필요하므로 큰 모델 사용
- **Structured Outputs 사용**: 프롬프트로 JSON을 요청하는 방식이 아니라 Groq의 JSON Schema 기반 Structured Outputs로 API 레벨에서 형식을 강제한다. Zod 스키마에서 `z.toJSONSchema()`로 JSON Schema를 생성해 요청에 전달하고, 응답은 동일한 Zod 스키마로 파싱한다 (스키마 정의 단일 소스). 파싱 실패 시 1회 재시도 후 스킵 + 로그
- confidence < 0.7이면 `needs_review: true`로 저장하고 대시보드에서 "확인 필요" 표시
### 지원 건 매칭 (`matchApplication`)
- 회사명 매칭: 정규화(공백/법인격 제거, 소문자화) 후 companies 테이블과 대조. 미등록 회사면 자동 생성
- **지원 건 매칭 우선순위** (같은 회사에 복수 포지션 지원 케이스 구분):
  1. **직무명 정확 일치 (1차 키)**: ATS 자동발송 메일은 공고명을 템플릿 변수로 꽂아 보내므로 지원 접수 메일과 이후 전형 결과 메일의 직무 문자열이 동일하다 (실측 확인됨). LLM이 추출한 직무명을 해당 회사 지원 건의 `position`과 비교해 일치하면 즉시 확정. 정규화는 공백 정리 수준만 — 괄호·하이픈 등은 그대로 비교하는 것이 안전하다
  2. **단일 건 폴백**: 직무명 미기재 또는 불일치 시, 해당 회사의 진행 중 지원 건이 1개뿐이면 그대로 연결
  3. **확정 불가**: 복수 건인데 직무로도 확정되지 않으면 임의로 붙이지 말고 `needs_review: true`로 저장 (잘못 연결되면 두 지원 건의 히스토리가 섞이므로, 추측보다 확인 요청이 옳다)
- **공고 자동 연결**: 신규 지원 건 생성 시(지원 접수 메일), 직무명으로 해당 회사의 `job_postings.title`을 정확 일치 검색해 매칭되면 `job_posting_id`를 자동으로 채운다 (같은 ATS 템플릿 변수이므로 공고명과 메일 속 직무명이 동일할 가능성이 높음). 미매칭이면 null 유지

### 상태 전이 검증 (`validateTransition`)
- LLM 분류 결과를 저장하기 전, 해당 지원 건의 기존 이벤트들과 대조해 논리적으로 불가능한 전이를 순수 함수로 감지한다:
  - 탈락(`document_rejected`, `rejected`) 이후의 진행 이벤트
  - 같은 stage 이벤트 중복 (회사 오매칭 또는 중복 분류 신호)
  - `applied` 이벤트 없는 지원 건에 갑자기 후반 단계 이벤트 (회사명 오인식 신호)
- 감지 시 이벤트를 버리지 않고 `needs_review: true`로 저장한다 (재지원·전형 복귀 등 정상 예외일 수 있으므로 최종 판단은 사용자에게)
- 순수 함수이므로 Vitest 단위 테스트 필수 대상

### 분류 정확도 평가셋
- 실제 수신한 채용 메일 20~30통을 익명화 없이 로컬 fixture로 저장하고 (git에는 커밋하지 않음, `.gitignore` 처리), 각 메일에 기대 stage 정답을 붙인 평가 스크립트를 만든다
- 용도: 모델 교체·프롬프트 수정 시 정확도 회귀 확인. env만 바꿔 재실행하면 모델 간 비교 가능

### 인증
- Gmail API: OAuth 2.0 refresh token 방식. 최초 1회 로컬에서 토큰 발급 스크립트(`scripts/gmail-auth.ts`) 실행 → refresh token을 GitHub Secrets에 저장
- 필요 스코프: `gmail.readonly`

## 7. 공고 스크래퍼 아키텍처

### 7-1. 설계 원칙

- **어댑터는 ATS 단위, 설정은 회사 단위.** 같은 ATS를 쓰는 회사가 몇 곳이든 어댑터 코드는 하나이고, 회사는 `scrape_strategy` + `scrape_config`(식별자 등)만 갖는다
- 모든 어댑터는 동일한 시그니처를 구현하고, 각 ATS의 응답 형태를 공통 타입 `ScrapeResult`로 변환하는 책임까지만 갖는다 (Adapter 패턴)
- upsert, closed 처리, 로깅 등 공통 로직은 오케스트레이터(`scrape-jobs.ts`)에 있고, 어댑터는 "가져와서 변환"만 한다
- 외부 응답은 어댑터 내부에서 반드시 Zod로 검증한다. ATS가 응답 구조를 바꾸면 조용한 데이터 오염 대신 해당 어댑터의 검증 에러로 즉시 드러나야 한다

### 7-2. 공통 인터페이스

```ts
// packages/scraper/src/types.ts
export type ScrapeResult = {
  title: string;
  url: string;
  description?: string;
  deadline?: string; // ISO date
};

export type ScrapeAdapter<TConfig> = (config: TConfig) => Promise<ScrapeResult[]>;
```

```ts
// packages/scraper/src/registry.ts
import { scrapeGreeting } from './adapters/greeting';
import { scrapeNinehire } from './adapters/ninehire';
import { scrapeLever } from './adapters/lever';
import { scrapeGreenhouse } from './adapters/greenhouse';
import { scrapeLlm } from './adapters/llm';

// scrape_strategy enum과 키가 1:1로 대응해야 하며,
// satisfies로 컴파일 타임에 누락을 잡는다
export const adapters = {
  greeting: scrapeGreeting,
  ninehire: scrapeNinehire,
  lever: scrapeLever,
  greenhouse: scrapeGreenhouse,
  llm: scrapeLlm,
} as const;
```

`scrape_config`는 전략별로 형태가 다르므로 Discriminated Union으로 정의하고, 전략별 Zod 스키마로 검증 후 어댑터에 전달한다.

### 7-3. ATS별 어댑터 명세

**중요: 구현 시 반드시 실제 엔드포인트를 검증부터 할 것.** 아래는 접근 방법 가이드이며, 각 어댑터 구현 전에 해당 ATS를 쓰는 실제 회사 페이지 1곳을 대상으로 네트워크 요청(개발자도구 Network 탭 기준의 XHR/fetch 요청)을 확인해 정확한 엔드포인트와 응답 구조를 파악한 뒤, 그 실제 응답으로 Zod 스키마를 작성한다.

#### lever
- 공개 API 확정: `https://api.lever.co/v0/postings/{site}?mode=json`
- `scrape_config`: `{ site: string }` (예: 회사 slug)
- 응답의 `text`(제목), `hostedUrl`, `categories` 활용

#### greenhouse
- 공개 API 확정: `https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs`
- `scrape_config`: `{ boardToken: string }`
- 응답의 `jobs[].title`, `jobs[].absolute_url` 활용

#### greeting (그리팅)
- 공식 Open API(oapi.greetinghr.com)는 기업 고객용 인증이 필요하므로 사용하지 않는다
- 그리팅 채용페이지(`{company}.greetinghr.com` 또는 커스텀 도메인에서 그리팅으로 연결)는 Next.js 기반이므로 접근 순서:
  1. 페이지 HTML fetch 후 `__NEXT_DATA__` script 태그의 JSON에서 공고 목록 추출 시도
  2. 안 되면 페이지가 호출하는 내부 API(XHR) 엔드포인트를 찾아 직접 호출
- `scrape_config`: `{ url: string }` (그리팅 채용페이지 URL)

#### ninehire (나인하이어)
- 채용페이지 형태: `{company}.ninehire.site` 또는 커스텀 도메인
- greeting과 동일한 접근 순서 (`__NEXT_DATA__` → 내부 API 탐색)
- `scrape_config`: `{ url: string }`
- **검증 샘플: 라포랩스 `https://rapportlabs.kr/jobs`** — 커스텀 도메인 + 나인하이어 조합이라 어댑터와 7-5 판별법(리소스 도메인 확인)을 함께 검증할 수 있다

#### llm (범용 폴백)
- ATS를 쓰지 않고 자체 채용페이지를 만든 회사용
- 흐름:
  1. `fetch(url)`로 HTML 확보. 본문에 공고 텍스트가 없으면(CSR) Playwright로 렌더링 후 HTML 확보
  2. 전처리: script/style 제거, 텍스트 + 앵커 링크 목록(`{ text, href }[]`)만 추출해 토큰 절약
  3. LLM(`LLM_MODEL_EXTRACT`)에 텍스트와 링크 목록을 주고 공고 배열을 Structured Outputs로 추출. **URL은 제공한 링크 목록에 있는 값만 사용하도록 프롬프트로 제약** (환각 방지)
  4. Zod 파싱, 실패 시 1회 재시도 후 해당 회사 스킵 + 로그
- `scrape_config`: `{ url: string, needsBrowser?: boolean }` (Playwright 필요 여부를 캐시)

### 7-4. 오케스트레이터 동작 (`scrape-jobs.ts`)

1. `companies` 전체 순회, `scrape_strategy`로 registry에서 어댑터를 찾아 실행
2. **신규 공고에 직군 분류 적용 (7-7)**: `content_hash` 기준 기존에 없는 공고만 분류하고, 비개발 직군으로 판정되면 DB에 넣지 않고 버린다. 버린 공고의 제목은 실행 로그에 남긴다 (오분류로 개발 공고가 조용히 누락되는 것을 감지할 유일한 수단)
3. 결과를 `content_hash` 기준 upsert. 기존 공고는 `last_seen_at` 갱신
4. 이번 실행에서 발견되지 않은 기존 `open` 공고는 `closed` 처리
5. 회사 단위 실패 격리 (한 회사 실패가 전체를 중단시키지 않음). `Promise.allSettled` 사용, 실패 로그 수집 후 요약 출력

### 7-5. 새 회사 등록 시 전략 판별법

채용페이지에서 공고를 클릭했을 때 이동하는 URL로 판별:
- `greetinghr.com` 포함 → `greeting`
- `ninehire.site` 포함 → `ninehire`
- `jobs.lever.co` 포함 → `lever`
- `boards.greenhouse.io` / `job-boards.greenhouse.io` 포함 → `greenhouse`
- 그 외 자체 페이지 → `llm`

**커스텀 도메인 주의**: ATS를 쓰면서 자체 도메인을 연결한 회사는 위 방법으로 안 걸린다 (예: 라포랩스 `rapportlabs.kr/jobs`는 나인하이어 기반). 이 경우 페이지 HTML 소스의 리소스 도메인으로 판별한다 — 이미지·API 요청이 `image.ninehire.com`, `greetinghr.com` 등을 가리키면 해당 ATS.

### 7-6. 지원 정책 추출기 (재지원/중복지원)

일부 회사는 채용페이지나 FAQ에 재지원 가능 여부("불합격 후 6개월 뒤 재지원 가능" 등), 중복지원 가능 여부("복수 포지션 동시 지원 가능" 등)를 안내한다. 이 정보를 회사 단위로 수집한다.

- **공고 스크래핑과 별도 모듈로 분리한다.** 공고는 매일 바뀌지만 지원 정책은 거의 바뀌지 않으므로 실행 주기가 다르다. ATS API 어댑터(lever, greenhouse)는 이 정보를 주지 않으므로, 전략과 무관하게 모든 회사에 대해 페이지 텍스트 기반으로 동작해야 한다
- **흐름**:
  1. 대상 URL: 정책 안내 위치는 회사마다 다르다 — 공고 목록 페이지 내 FAQ(예: 라포랩스), 별도 안내/FAQ 페이지, 공고 상세 내 유의사항, 또는 아예 없음. 기본은 `careers_url`에서 시도하고, 다른 곳에 있으면 `scrape_config.policyUrl`로 지정한다. policyUrl은 "정책 안내가 적혀 있는 아무 페이지"를 의미하며 FAQ 페이지에 한정하지 않는다 (공고 상세 URL도 가능)
  2. fetch(필요 시 Playwright)로 HTML 확보 → llm 어댑터와 동일한 전처리(텍스트 추출) 재사용
  3. LLM(`LLM_MODEL_EXTRACT`)에 Structured Outputs로 추출: `{ reapplyPolicy, duplicateApplyPolicy, note, sourceQuote }`
  4. **관련 안내가 없으면 반드시 `unknown`으로 답하도록 프롬프트로 강제한다.** 페이지에 없는 정책을 추측으로 만들어내는 것이 최악의 실패 모드다. `note`에는 판단 근거가 된 원문 문구를 그대로 담게 해 검증 가능하게 한다. "가능하지만 6개월 후 권장" 같은 조건부 안내는 `conditional`로 분류하고 뉘앙스는 note가 전달한다
  5. companies 테이블 갱신 + `policy_checked_at` 기록. 결과가 unknown인 회사는 회사 상세에서 policyUrl 입력 + 재실행을 유도한다
- **실행 시점**: 회사 등록 시 1회 + 수동 재실행 액션(회사 상세에서 버튼). 매일 cron에 포함하지 않는다 (불필요한 LLM 비용과 오추출 기회만 늘어남)
- **표시**: `/jobs` 회사 그룹 헤더와 지원 건 상세에 배지로 표시. 특히 지원 건이 탈락(`rejected`, `document_rejected`) 상태이고 해당 회사가 `reapply_policy: allowed`면 "재지원 가능" 힌트를 함께 노출한다

### 7-7. 직군 분류기 (개발 직군만 수집)

수집 대상은 개발 직군 공고뿐이다. 비개발 직군(디자인, PM, 재무, 법무, 마케팅 등)은 분류 단계에서 판정해 **DB에 저장하지 않고 버린다.** 회사마다 공고명 표기가 제각각이므로("웹 프론트엔드 개발자", "FE Engineer", "Software Engineer, Front-End") 정규화된 카테고리를 수집 시점에 1회 부여한다.

- **분류 함수 시그니처**: `classifyCategory(title: string, description?: string) → Category | 'non_dev'`
  - 분류 함수는 판정까지만 책임진다 (`non_dev` 반환 포함). 버릴지 말지는 오케스트레이터의 정책 — SRP 분리
- **2단 하이브리드**:
  1. **키워드 규칙 (1차, 순수 함수)**: 카테고리별 키워드 사전과 대조 (예: frontend ← `frontend`, `front-end`, `프론트`, `FE` / devops ← `devops`, `infra`, `SRE`, `플랫폼 엔지니어` / data_ai ← `AI`, `ML`, `머신러닝`, `딥러닝`, `LLM`, `데이터 엔지니어`, `데이터 사이언티스트`, `Machine Learning`, `MLOps`). 대소문자·하이픈 정규화 후 매칭. 복수 매칭 시 우선순위 규칙 적용 (예: "풀스택" 키워드가 있으면 fullstack 우선). 대부분의 공고가 여기서 결정된다. Vitest 테스트 필수 대상
  2. **LLM 폴백 (2차)**: 규칙에 안 걸린 제목만 LLM(`LLM_MODEL_FILTER`)에 Structured Outputs로 분류 요청. "Product Engineer"처럼 직군이 제목에 드러나지 않는 케이스 대상이며, `description`이 있으면 함께 제공해 정확도를 높인다. 신규 공고에만 실행되므로 호출량은 하루 몇 건 수준
- **실행 위치**: 어댑터가 아니라 오케스트레이터의 후처리 단계 (어댑터는 "가져와서 변환"까지만 — 분류 로직의 단일 소스 유지)
- **오분류 안전망**:
  - 개발 공고가 비개발로 오판되면 조용히 누락되고 되돌릴 기록도 없으므로, **버린 공고 제목은 반드시 실행 로그에 남긴다.** 키워드 규칙은 보수적으로 설계한다 (확신 없으면 non_dev가 아니라 LLM 폴백으로)
  - 수집된 공고의 카테고리 오분류는 `/jobs`에서 배지 클릭으로 수동 수정 가능하게 한다 (Server Action)
  - `etc_dev`는 개발 직군이지만 세부 카테고리 판정이 애매한 경우의 버킷 (분류 불가 ≠ 비개발)

## 8. 구현 원칙

- **관심사 분리**: 데이터 접근(packages/db), 수집 로직(worker/scraper), 표현(web)을 엄격히 분리
- **작고 조합 가능한 함수**: 워커 파이프라인과 어댑터는 단일 책임 함수의 조합으로 구성. 상태 공유가 필요 없는 곳에 클래스를 도입하지 않는다
- **타입 안전성**: DB 스키마 → Drizzle 타입 추론 → 프론트까지 단일 소스. 외부 데이터 경계(LLM 응답, ATS 응답, Gmail 응답)에는 반드시 Zod
- **Discriminated Union + exhaustive check**: stage, scrape_strategy/scrape_config는 유니온 타입으로 정의하고 누락을 컴파일 타임에 잡는다
- **UI 컴포넌트**: `apps/web/components/ui`는 shadcn/ui로 구축한다 (`npx shadcn add`로 추가, 복사된 코드는 우리 소유이므로 필요 시 직접 수정). 도메인 컴포넌트는 `components/applications`, `components/jobs`로 분리하고 ui 컴포넌트를 조합해 구성한다. 표시 전용 컴포넌트와 데이터 연결을 분리. 차트는 shadcn charts(Recharts 래퍼) 사용
- **오버엔지니어링 금지**: 상시 서버 없음. 인증 없음(개인용, 필요 시 basic auth 미들웨어 정도만). 테스트는 순수 함수(회사명 정규화, 해시 생성, ATS 응답 변환, LLM 응답 파싱) 위주로 Vitest 작성. 어댑터 테스트는 실제 응답을 fixture로 저장해 사용

## 9. 환경변수

```
# apps/web, packages/db
DATABASE_URL=

# apps/worker
DATABASE_URL=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=
LLM_MODEL_FILTER=openai/gpt-oss-20b     # 메일 1단계 필터용 (저가)
LLM_MODEL_EXTRACT=openai/gpt-oss-120b   # 메일 stage 추출 + 공고 추출용
```

GitHub Actions에서는 위 값들을 repository secrets로 주입한다.

**LLM 클라이언트 원칙**: Groq은 OpenAI 호환 API이므로, LLM 호출은 base URL·API 키·모델명을 env에서 주입받는 얇은 클라이언트 함수 하나로 감싼다. 코드는 특정 업체를 알지 못하며, 업체/모델 교체는 env 수정만으로 가능해야 한다. Structured Outputs 요청 구성(Zod → JSON Schema)과 응답 Zod 파싱, rate limit(429) 시 지수 백오프 재시도도 이 클라이언트에 모은다.

## 10. 구현 순서 (Phase)

### Phase 1 — 기반
- [ ] 모노레포 셋업 (pnpm + Turborepo, apps/web, apps/worker, packages/db·scraper·shared)
- [ ] Drizzle 스키마 정의 + Supabase 마이그레이션
- [ ] Next.js 기본 레이아웃, 라우팅 (`/`, `/jobs`)
- [ ] shadcn/ui 초기 셋업 (Table, Badge, Card, Select, Tabs, Dialog 등 기본 컴포넌트 추가)

### Phase 2 — 스크래퍼 (확정 API부터)
- [ ] ScrapeAdapter 공통 타입 + registry + scrape_config Discriminated Union
- [ ] lever, greenhouse 어댑터 (공개 API 확정이라 가장 안전한 출발점)
- [ ] 오케스트레이터: 직군 분류(7-7: 키워드 규칙 + LLM 폴백, 비개발 제외 + 로그) + upsert + closed 처리 + 실패 격리
- [ ] `/jobs` 페이지 (목록, 필터, D-day, NEW 배지)
- [ ] GitHub Actions workflow (scrape-jobs.yml)

### Phase 3 — 국내 ATS + 범용 폴백
- [ ] greeting 어댑터 (실제 그리팅 사용 회사 1곳으로 엔드포인트 검증 후 구현)
- [ ] ninehire 어댑터 (동일)
- [ ] llm 어댑터 (fetch → 전처리 → LLM 추출 → Zod, Playwright 폴백 포함)
- [ ] 지원 정책 추출기 (7-6: 등록 시 1회 + 수동 재실행, unknown 기본값 강제)
- [ ] 회사 등록 UI

### Phase 4 — 메일 파이프라인
- [ ] Gmail OAuth 토큰 발급 스크립트
- [ ] 증분 동기화 + 메일 파싱
- [ ] LLM 클라이언트 (env 주입, Structured Outputs, 백오프 재시도)
- [ ] LLM 분류 (2단계 프롬프트, 필터/추출 모델 분리) + matchApplication (직무명 1차 키 매칭, 공고 자동 연결) + validateTransition + 이벤트 적재
- [ ] GitHub Actions workflow (sync-gmail.yml)

### Phase 5 — 대시보드
- [ ] 요약 카드 + 퍼널 차트
- [ ] 지원 목록 테이블 + 필터 (searchParams 기반)
- [ ] 지원 건 상세 타임라인
- [ ] confidence 낮은 이벤트 "확인 필요" 표시 + 수동 수정 액션

### Phase 6 — 마감
- [ ] 순수 함수 단위 Vitest 테스트 (fixture 기반 어댑터 테스트, validateTransition 포함)
- [ ] 메일 분류 정확도 평가셋 (실제 메일 fixture + 기대 stage, gitignore 처리)
- [ ] Vercel 배포 + 접근 보호
