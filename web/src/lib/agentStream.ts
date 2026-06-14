// 에이전트 SSE 본문(text)에서 어시스턴트 답변과 추천 product id를 추출하는 순수 함수.
export function extractFromSSE(raw: string): { text: string; ids: number[] } {
  let text = "";
  const ids: number[] = [];
  for (const frame of raw.split("\n\n")) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    try {
      if (event === "token") text += JSON.parse(data).text ?? "";
      else if (event === "emergency") text += JSON.parse(data).message ?? "";
      else if (event === "recommendations") {
        const arr = JSON.parse(data).ids;
        if (Array.isArray(arr)) for (const id of arr) if (!ids.includes(id)) ids.push(id);
      }
    } catch {
      // 파싱 불가 프레임은 무시
    }
  }
  return { text, ids };
}
