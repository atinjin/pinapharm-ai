import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate" }));
    process.env.VOYAGE_API_KEY = "test-key";
    await expect(embed(["x"], "query")).rejects.toThrow();
  });
});
