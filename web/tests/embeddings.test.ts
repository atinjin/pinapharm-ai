import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { embed } from "@/lib/embeddings";

afterEach(() => vi.unstubAllGlobals());

describe("embed (voyage)", () => {
  it("posts to voyage and returns vectors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.VOYAGE_API_KEY = "test-key";

    const out = await embed(["a", "b"], "document");
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("voyageai.com");
    expect(JSON.parse(init.body).input_type).toBe("document");
    expect(init.headers.Authorization).toContain("test-key");
  });

  it("EMBEDDING_MODEL이 없으면 기본 모델은 voyage-4-lite", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [1] }] }) });
    vi.stubGlobal("fetch", fetchMock);
    process.env.VOYAGE_API_KEY = "test-key";
    const prev = process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_MODEL;
    vi.resetModules();
    try {
      const mod = await import("@/lib/embeddings");
      await mod.embed(["x"], "query");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("voyage-4-lite");
      expect(mod.EMBEDDING_MODEL_NAME).toBe("voyage-4-lite");
    } finally {
      if (prev !== undefined) process.env.EMBEDDING_MODEL = prev;
    }
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad" }));
    process.env.VOYAGE_API_KEY = "test-key";
    await expect(embed(["x"], "query")).rejects.toThrow();
  });
});

describe("embed retry (429·5xx)", () => {
  const okRes = { ok: true, status: 200, json: async () => ({ data: [{ embedding: [1, 0] }] }) };
  const errRes = (status: number, retryAfter?: string) => ({
    ok: false,
    status,
    text: async () => "err",
    headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.VOYAGE_API_KEY = "test-key";
  });
  afterEach(() => vi.useRealTimers());

  it("429 두 번 뒤 성공하면 벡터를 돌려준다", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errRes(429))
      .mockResolvedValueOnce(errRes(429))
      .mockResolvedValueOnce(okRes);
    vi.stubGlobal("fetch", fetchMock);
    const p = embed(["x"], "query");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual([[1, 0]]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("5xx도 재시도한다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errRes(503)).mockResolvedValueOnce(okRes);
    vi.stubGlobal("fetch", fetchMock);
    const p = embed(["x"], "query");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual([[1, 0]]);
  });

  it("재시도 3회를 소진하면 throw한다(총 4회 호출)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errRes(429));
    vi.stubGlobal("fetch", fetchMock);
    const p = embed(["x"], "query");
    const assertion = expect(p).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("4xx(429 제외)는 재시도하지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errRes(401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(embed(["x"], "query")).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Retry-After(초)를 존중해 그만큼 기다린 뒤 재시도한다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errRes(429, "2")).mockResolvedValueOnce(okRes);
    vi.stubGlobal("fetch", fetchMock);
    const p = embed(["x"], "query");
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toEqual([[1, 0]]);
  });

  it("총 대기 상한(5초)을 넘기면 더 기다리지 않고 throw한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errRes(429, "60"));
    vi.stubGlobal("fetch", fetchMock);
    const p = embed(["x"], "query");
    const assertion = expect(p).rejects.toThrow(/429/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
