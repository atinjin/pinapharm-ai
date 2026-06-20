export type CommerceCode = "NOT_FOUND" | "INACTIVE" | "EMPTY_CART" | "OUT_OF_STOCK" | "INVALID_TRANSITION" | "AMOUNT_MISMATCH" | "PAYMENT_FAILED";

export class CommerceError extends Error {
  constructor(public code: CommerceCode, message: string, public detail?: unknown) {
    super(message);
    this.name = "CommerceError";
  }
}

export function commerceStatus(code: CommerceCode): number {
  switch (code) {
    case "NOT_FOUND": return 404;
    case "OUT_OF_STOCK":
    case "INVALID_TRANSITION": return 409;
    case "PAYMENT_FAILED": return 502;
    case "AMOUNT_MISMATCH": return 400;
    default: return 400; // INACTIVE, EMPTY_CART
  }
}
