export function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return vec.map((x) => x / norm);
}

export function serialize(vec: number[]): Buffer {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function deserialize(buf: Buffer): Float32Array {
  // Prisma Bytes는 풀링된 Buffer일 수 있어 정렬을 위해 복사한다
  const copy = Uint8Array.prototype.slice.call(buf);
  return new Float32Array(copy.buffer);
}

type VecChunk<T> = T & { embedding: Buffer };

export function cosineTopK<T>(
  query: number[],
  chunks: VecChunk<T>[],
  k: number
): (T & { score: number })[] {
  const q = Float32Array.from(query);
  const scored = chunks.map((c) => {
    const v = deserialize(c.embedding);
    let dot = 0;
    const n = Math.min(q.length, v.length);
    for (let i = 0; i < n; i++) dot += q[i] * v[i];
    return { ...c, score: dot } as T & { score: number };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
