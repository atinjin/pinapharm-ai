import { describe, it, expect } from "vitest";
import { normalize, serialize, deserialize, cosineTopK } from "@/lib/vectors";

describe("vectors", () => {
  it("normalize makes unit length", () => {
    const v = normalize([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0.6, 6);
  });

  it("serialize/deserialize round-trips Float32", () => {
    const v = normalize([1, 2, 3, 4]);
    const back = Array.from(deserialize(serialize(v)));
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i], 5));
  });

  it("cosineTopK ranks by similarity (normalized dot)", () => {
    const q = normalize([1, 0]);
    const chunks = [
      { id: 1, embedding: serialize(normalize([1, 0])) },
      { id: 2, embedding: serialize(normalize([0, 1])) },
      { id: 3, embedding: serialize(normalize([1, 1])) },
    ];
    const top = cosineTopK(q, chunks, 2);
    expect(top.map((t) => t.id)).toEqual([1, 3]);
    expect(top[0].score).toBeCloseTo(1, 5);
  });
});
