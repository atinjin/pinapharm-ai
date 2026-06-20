export type CommerceCode = "NOT_FOUND" | "INACTIVE" | "EMPTY_CART" | "OUT_OF_STOCK" | "INVALID_TRANSITION";

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
    default: return 400; // INACTIVE, EMPTY_CART
  }
}
