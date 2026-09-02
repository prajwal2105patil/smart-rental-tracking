import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Indian digit grouping - 6,20,000 not 620,000. The audience reads lakhs. */
export function inr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 })
}

export function pct(n: number): string {
  return `${n.toFixed(1)}%`
}

export function shortDate(d?: string | null): string {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short",
  })
}

/**
 * One key per user gesture, sent as Idempotency-Key. The server returns the original row
 * for a repeat key instead of appending a second one, so a retry or a duplicated request
 * can never inflate the ledger.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
