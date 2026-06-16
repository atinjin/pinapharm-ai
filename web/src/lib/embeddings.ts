const PROVIDER = process.env.EMBEDDING_PROVIDER ?? "voyage";
const MODEL = process.env.EMBEDDING_MODEL ?? "voyage-3.5-lite";

/** 텍스트 배열을 임베딩한다. inputType: 색인="document", 질의="query". */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (PROVIDER !== "voyage") throw new Error(`지원하지 않는 EMBEDDING_PROVIDER: ${PROVIDER}`);
  const key = process.env.VOYAGE_API_KEY ?? process.env.VOYAGE_TOKEN;
  if (!key) throw new Error("VOYAGE_API_KEY 가 설정되지 않았습니다");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (!res.ok) throw new Error(`voyage embeddings 실패: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export const EMBEDDING_MODEL_NAME = MODEL;
