import { ChatPanel } from "@/components/ChatPanel";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 720, margin: "0 auto" }}>
      <h1>약사 상담</h1>
      <p style={{ color: "#666" }}>건강 고민을 말씀해주세요. 약사가 상담하고 맞는 영양제를 추천해드립니다.</p>
      <ChatPanel />
      <p style={{ marginTop: 24, fontSize: 12, color: "#999" }}>
        본 상담은 의료 진단이 아니며, 영양제는 의약품을 대체하지 않습니다.
      </p>
    </main>
  );
}
