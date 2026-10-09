const PROVIDER = process.env.EMBEDDING_PROVIDER ?? "voyage";
const MODEL = process.env.EMBEDDING_MODEL ?? "voyage-4-lite";

// 429·5xx 재시도: 지수 백오프(0.5→1→2초), Retry-After 우선, 총 대기 상한을 넘기면 포기
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_TOTAL_WAIT_MS = 5000;

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

// Retry-After: 초(정수) 또는 HTTP-date. 해석 불가면 null.
function retryAfterMs(res: Response): number | null {
  const raw = res.headers?.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 텍스트 배열을 임베딩한다. inputType: 색인="document", 질의="query". */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (PROVIDER !== "voyage") throw new Error(`지원하지 않는 EMBEDDING_PROVIDER: ${PROVIDER}`);
  const key = process.env.VOYAGE_API_KEY ?? process.env.VOYAGE_TOKEN;
  if (!key) throw new Error("VOYAGE_API_KEY 가 설정되지 않았습니다");

  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
    });
    if (res.ok) {
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    }
    const delay = retryAfterMs(res) ?? BASE_DELAY_MS * 2 ** attempt;
    if (!isRetryable(res.status) || attempt >= MAX_RETRIES || waited + delay > MAX_TOTAL_WAIT_MS) {
      throw new Error(`voyage embeddings 실패: ${res.status} ${await res.text()}`);
    }
    waited += delay;
    await sleep(delay);
  }
}

export const EMBEDDING_MODEL_NAME = MODEL;
