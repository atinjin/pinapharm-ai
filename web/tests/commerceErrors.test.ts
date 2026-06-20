import { describe, it, expect } from "vitest";
import { commerceStatus } from "@/lib/commerceErrors";

describe("commerceStatus", () => {
  it("maps payment codes", () => {
    expect(commerceStatus("AMOUNT_MISMATCH")).toBe(400);
    expect(commerceStatus("PAYMENT_FAILED")).toBe(502);
    expect(commerceStatus("NOT_FOUND")).toBe(404);
    expect(commerceStatus("OUT_OF_STOCK")).toBe(409);
  });
});
