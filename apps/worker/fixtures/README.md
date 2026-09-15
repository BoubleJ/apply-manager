# 메일 분류 평가셋 fixture

`scripts/eval-classify.ts`가 사용하는 평가셋이다. 실제 수신한 채용 메일 20~30통을
`fixtures/emails/*.json`으로 저장하고 기대 stage 정답을 붙인다 (스펙 6장).

**`fixtures/emails/`는 실제 개인 메일이므로 git에 커밋하지 않는다** — 루트
`.gitignore`에 `apps/worker/fixtures/emails/`가 이미 등록되어 있다.

## 파일 형식

파일당 메일 1통, JSON 형식:

```json
{
  "subject": "[회사명] 서류 전형 결과 안내",
  "from": "recruit@example.com",
  "body": "안녕하세요, OOO님. 아쉽지만 좋은 결과를 드리지 못하게 되었습니다...",
  "receivedAt": "2026-05-01T09:30:00+09:00",
  "expectedStage": "document_rejected"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `subject` | O | 메일 제목 |
| `from` | X | 발신자 (`이름 <주소>` 형식 권장, 생략 시 빈 문자열) |
| `body` | O | 본문 텍스트 (HTML이면 태그 제거 후 텍스트만) |
| `receivedAt` | X | 수신 시각 (ISO 8601) — 분류에는 쓰이지 않음 |
| `expectedStage` | O | 기대 stage. 채용 전형과 무관한 메일이면 `null` |

`expectedStage` 허용 값: `applied`, `document_passed`, `document_rejected`,
`assignment`, `interview_1`, `interview_1_passed`, `interview_2`, `final_passed`,
`rejected`, `offer`, `withdrawn`, 또는 `null`(채용 무관 — 필터가 걸러야 함).

채용 무관 메일(뉴스레터, 스카우트 제안 등)도 몇 통 섞어야 필터(1단계) 정확도를
같이 측정할 수 있다.

## 실행

```sh
# apps/worker 디렉토리 기준, LLM_* env 필요 (.env 또는 shell export)
pnpm --filter @apply-manager/worker eval-classify
```

모델을 바꿔 비교하려면 env만 바꿔 재실행한다:

```sh
LLM_MODEL_EXTRACT=other/model pnpm --filter @apply-manager/worker eval-classify
```
