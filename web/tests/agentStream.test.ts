import { describe, it, expect } from "vitest";
import { extractFromSSE } from "@/lib/agentStream";

describe("extractFromSSE", () => {
  it("token 이벤트를 이어붙여 답변을 만든다", () => {
    const raw =
      'event: token\ndata: {"text":"안녕"}\n\n' +
      'event: token\ndata: {"text":"하세요"}\n\n' +
      'event: done\ndata: {}\n\n';
    expect(extractFromSSE(raw)).toEqual({ text: "안녕하세요", ids: [] });
  });
  it("recommendations 이벤트에서 중복 없는 id를 모은다", () => {
    const raw =
      'event: recommendations\ndata: {"ids":[1,2]}\n\n' +
      'event: recommendations\ndata: {"ids":[2,3]}\n\n';
    expect(extractFromSSE(raw).ids).toEqual([1, 2, 3]);
  });
  it("emergency 메시지도 답변에 포함한다", () => {
    const raw = 'event: emergency\ndata: {"message":"병원에 가세요"}\n\n';
    expect(extractFromSSE(raw).text).toBe("병원에 가세요");
  });
});
