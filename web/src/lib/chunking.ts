// 문서를 임베딩·검색 단위(청크)로 분할한다. 문단(빈 줄) 경계를 우선하고,
// 한 문단이 상한을 넘으면 오버랩을 둔 고정 윈도우로 강제 분할한다.
export function chunk(
  text: string,
  opts: { maxChars?: number; overlap?: number } = {}
): string[] {
  const maxChars = opts.maxChars ?? 500;
  const overlap = opts.overlap ?? 80;
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const stride = Math.max(1, maxChars - overlap);
  const hardSplit = (s: string): string[] => {
    const out: string[] = [];
    for (let start = 0; start < s.length; start += stride) {
      out.push(s.slice(start, start + maxChars));
      if (start + maxChars >= s.length) break;
    }
    return out;
  };

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const p of paragraphs) {
    if (p.length > maxChars) units.push(...hardSplit(p));
    else units.push(p);
  }

  const chunks: string[] = [];
  let cur = "";
  for (const u of units) {
    if (!cur) cur = u;
    else if ((cur + "\n\n" + u).length <= maxChars) cur = `${cur}\n\n${u}`;
    else {
      chunks.push(cur);
      cur = u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
