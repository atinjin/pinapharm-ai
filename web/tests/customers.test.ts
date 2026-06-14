import { describe, it, expect } from "vitest";
import { resolveCustomer, getHealthProfile, saveHealthProfile } from "@/lib/customers";

describe("resolveCustomer", () => {
  it("새 session_id는 customer를 생성한다", async () => {
    const id = await resolveCustomer("sess-new-" + Date.now());
    expect(typeof id).toBe("number");
  });
  it("같은 session_id는 같은 customer를 반환한다", async () => {
    const s = "sess-same-" + Date.now();
    const a = await resolveCustomer(s);
    const b = await resolveCustomer(s);
    expect(a).toBe(b);
  });
});

describe("health profile", () => {
  it("프로필이 없으면 빈 값을 반환한다", async () => {
    const cid = await resolveCustomer("sess-empty-" + Date.now());
    const p = await getHealthProfile(cid);
    expect(p.conditions).toEqual([]);
    expect(p.ageBand).toBeNull();
  });
  it("리스트는 합집합 병합, 스칼라는 보존한다", async () => {
    const cid = await resolveCustomer("sess-merge-" + Date.now());
    await saveHealthProfile(cid, { ageBand: "30대", medications: ["혈압약"] });
    const p = await saveHealthProfile(cid, { medications: ["오메가3", "혈압약"], pregnancy: "임신" });
    expect(p.medications.sort()).toEqual(["오메가3", "혈압약"]);
    expect(p.ageBand).toBe("30대");
    expect(p.pregnancy).toBe("임신");
  });
});
