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
  it("CRLF(\\r\\n\\r\\n) 프레임 경계도 파싱한다 (sse-starlette)", () => {
    const raw =
      'event: token\r\ndata: {"text":"비타민"}\r\n\r\n' +
      'event: token\r\ndata: {"text":"C"}\r\n\r\n' +
      'event: recommendations\r\ndata: {"ids":[7]}\r\n\r\n' +
      'event: done\r\ndata: {}\r\n\r\n';
    expect(extractFromSSE(raw)).toEqual({ text: "비타민C", ids: [7] });
  });
  it("plan 이벤트는 무시한다(텍스트·ids에 영향 없음)", () => {
    const raw =
      'event: plan\ndata: {"steps":["증상 정리","제품 검색"]}\n\n' +
      'event: token\ndata: {"text":"안녕"}\n\n' +
      'event: recommendations\ndata: {"ids":[5]}\n\n';
    expect(extractFromSSE(raw)).toEqual({ text: "안녕", ids: [5] });
  });
});
