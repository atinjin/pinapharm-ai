# LLM 호출 경로를 OpenRouter로 전환 — 설계

- 작성일: 2026-10-09
- 결정: PM이 "Anthropic API를 직접 쓰지 않고 OpenRouter를 쓴다"고 지시(2026-10-09).
- 관련: [AI 상담 비용 통제 스펙](2026-10-09-ai-cost-control-design.md) — 이 문서는 그 스펙의 C2(가격표)·C7(캐싱)·PR0 실호출 검증에 영향을 준다.

## 1. 확인한 사실 (2026-10-09)

| 항목 | 내용 | 근거 |
|---|---|---|
| Anthropic 호환 입력 | OpenRouter는 Anthropic Messages API와 호환되는 입력("Anthropic Skin")을 제공한다. Claude Code는 `ANTHROPIC_BASE_URL=https://openrouter.ai/api` + Bearer 토큰(`ANTHROPIC_AUTH_TOKEN`)으로 붙는다. 네이티브 tool use와 thinking 블록을 그대로 전달한다 | [Claude Code 연동 문서](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration.md) |
| 모델 ID | `anthropic/claude-opus-4.8`, `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-5.5` 형식 | `GET https://openrouter.ai/api/v1/models` |
| 단가 | Anthropic 정가와 같다. 예: opus-4.8 입력 $5/M, 출력 $25/M, 캐시 읽기 $0.5/M, 캐시 쓰기 $6.25/M. haiku-4.5 $1/$5 | 같은 모델 목록 API |
| usage·비용 | OpenAI 호환 응답에는 `usage.cost`(credits)와 cached/cache_write 토큰이 자동 포함된다. Anthropic Skin 응답의 usage 형식은 **미확인** | [Usage accounting 문서](https://openrouter.ai/docs/cookbook/administration/usage-accounting.md) |
| 제공자 보장 | Claude Code는 Anthropic 1P 제공자에서만 동작을 보장하므로 Anthropic 1P를 우선 제공자로 두라고 권한다 | Claude Code 연동 문서 |

`langchain-anthropic`의 `ChatAnthropic`은 `base_url`(`anthropic_api_url`)과 `default_headers`를 받는다(설치본 `chat_models.py:946, 974`).

## 2. 선택지

**A. Anthropic Skin + 기존 ChatAnthropic 유지 (채택)**
- `ChatAnthropic`의 base_url만 OpenRouter로 바꾸고 인증을 OpenRouter 키로 바꾼다.
- 장점: 코드 변경이 생성자 한 곳으로 모인다. 도구 호출, `tool_choice`, `cache_control`, `usage_metadata` 의미가 그대로라 비용 통제 스펙(PR0~PR4)과 기존 테스트 mock 구조를 거의 그대로 쓸 수 있다.
- 단점: 사실상 Claude 계열 모델 전용이다. OpenRouter가 응답에 넣는 `cost` 필드를 받을 수 있는지 미확인이라, 비용은 계속 토큰 × 단가로 계산해야 할 수 있다.

**B. OpenAI 호환 엔드포인트 + ChatOpenAI**
- 장점: Claude 외 모델(GPT, Gemini, 오픈 모델)로 바꾸기 쉽고, 응답의 `usage.cost`를 그대로 원장에 쓸 수 있다.
- 단점: 메시지·도구 형식, 캐시 브레이크포인트 방식, `tool_choice` 의미가 달라져 PR0 코드(`_llm_view`의 tool_use 블록 처리)와 비용 스펙 C2·C7을 다시 설계해야 한다. 테스트도 상당 부분 바뀐다.

A를 먼저 적용한다. 전환 비용이 작고 되돌리기 쉬우며, B는 메인 모델을 Claude 외로 바꾸기로 결정할 때(비용 스펙 D2) 다시 검토한다.

## 3. 설계 (A)

### 3.1 새 모듈 `agent/app/llm.py`
- `PROVIDER = os.environ.get("LLM_PROVIDER", "openrouter")` — 값은 `openrouter` 또는 `anthropic`. `anthropic`은 직접 호출 경로를 비상용으로 남겨 두는 것이다.
- `OPENROUTER_BASE_URL = "https://openrouter.ai/api"` (SDK가 `/v1/messages`를 붙인다).
- `to_openrouter_slug(model: str) -> str`
  - 이미 `/`가 들어 있으면 그대로 반환한다.
  - Anthropic 네이티브 ID를 슬러그로 바꾼다: 끝의 날짜(`-YYYYMMDD`)를 떼고, 마지막 두 숫자 마디를 점으로 잇고, `anthropic/`을 붙인다. 예: `claude-opus-4-8` → `anthropic/claude-opus-4.8`, `claude-haiku-4-5-20251001` → `anthropic/claude-haiku-4.5`.
  - 기존 `.env`의 `ANTHROPIC_MODEL`, `TRIAGE_MODEL`, `PLAN_MODEL` 값을 고치지 않아도 동작하게 하려는 것이다.
- `chat_model(model: str, **kwargs) -> ChatAnthropic`
  - openrouter: `ChatAnthropic(model=to_openrouter_slug(model), base_url=OPENROUTER_BASE_URL, api_key=<키>, default_headers={...}, **kwargs)`.
    - 인증 헤더: OpenRouter 문서는 Bearer 토큰을 쓴다. Anthropic SDK는 `api_key`를 `x-api-key`로 보내므로 `default_headers`에 `Authorization: Bearer <키>`를 넣는다. 실제로 어느 헤더가 통하는지는 실호출로 확인한다.
    - 앱 식별 헤더 `HTTP-Referer`, `X-Title: PinaPharm`(선택, OpenRouter 대시보드 구분용).
  - anthropic: 지금과 같은 `ChatAnthropic(model=model, **kwargs)`.
  - 키가 없으면 호출 시점에 명확한 오류(`OPENROUTER_API_KEY 미설정`)를 낸다. import 시점에 실패하지 않는다(테스트가 키 없이 돈다).
- 키 환경변수: `OPENROUTER_API_KEY`.

### 3.2 호출부
- `graph._chat_model()`, `triage._model()`, `planner._plan_model()`은 이름과 반환 타입(`ChatAnthropic`)을 유지하고 내부에서 `llm.chat_model(...)`을 부른다. 테스트의 patch 대상이 그대로 유지된다.
- `eval/__main__.py`의 키 확인: provider가 openrouter면 `OPENROUTER_API_KEY`를, anthropic이면 `ANTHROPIC_API_KEY`를 확인한다.
- `agent/.env.example`, README 빠른 시작을 갱신한다.

### 3.3 제공자 고정과 데이터 보존 (건강정보)
- 상담 내용은 건강정보(민감정보)다. OpenRouter의 제공자 라우팅으로 **Anthropic 1P에 고정**하고, 학습·보존을 허용하는 제공자를 배제한다.
- 요청 본문의 OpenRouter `provider` 필드(`order: ["anthropic"]`, `allow_fallbacks: false`, `data_collection: "deny"`)를 `ChatAnthropic(model_kwargs=...)`로 실어 보낸다. Anthropic Skin이 이 필드를 받는지는 실호출로 확인한다. 받지 않으면 OpenRouter 계정 설정(Privacy, Provider 설정)으로 대체하고 그 사실을 기록한다.
- OpenRouter가 개인정보 처리 위탁·국외이전 대상에 추가된다. 로드맵 E5(개인정보 고지)에 반영해야 한다.

### 3.4 비용 통제 스펙에 미치는 영향
- C2 가격표: OpenRouter 단가가 Anthropic 정가와 같으므로 토큰 × 단가 계산은 유지한다. OpenRouter 크레딧 구매 수수료는 미확인이므로, 확인되면 `pricing.py`에 배수로 반영한다. Skin 응답에 `cost`가 오면 그 값을 우선 쓴다.
- C7 캐싱: Skin이 `cache_control`과 `cache_read_input_tokens`/`cache_creation_input_tokens`를 그대로 전달하는지 실호출로 확인한다. 전달하지 않으면 PR4 설계를 다시 본다.
- PR0 실호출 검증(PINAPHARM-4)과 PR1 기준선은 OpenRouter 경로로 수행한다.

## 4. 실호출 확인 항목 (OPENROUTER_API_KEY 필요)
1. 기본 호출 성공과 인증 헤더(Bearer vs x-api-key)
2. 스트리밍 + 도구 호출(bind_tools) 왕복
3. `tool_choice: {"type": "none"}` + tools 정의 + 이력의 tool 블록(PR0 finalize 경로)
4. `usage_metadata`의 cache 필드, 응답의 비용 필드 유무
5. `cache_control` 자동 캐싱 적중(같은 프리픽스 2회 호출 시 cache_read > 0)
6. `provider` 필드 수용 여부와 실제 응답 제공자(Anthropic) 확인
7. triage(max_tokens=10, temperature 0), planner 호출

## 5. 범위 밖
- OpenAI 호환 경로(B), Claude 외 모델 평가
- web 쪽 Voyage 임베딩(LLM과 무관, 변경 없음)
