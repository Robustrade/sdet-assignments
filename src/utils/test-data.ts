import { randomUUID } from "node:crypto";

export function generateUniqueId(prefix = "test"): string {
  return `${prefix}-${randomUUID()}`;
}

export function generateTestEmail(): string {
  return `${generateUniqueId("user")}@example.com`;
}

export function generateTestReference(): string {
  return generateUniqueId("transaction");
}

export function generateIdempotencyKey(): string {
  return randomUUID();
}
