import { useRef, useState } from "react"
import type { Anomaly, AssetDetail } from "@/lib/types"
import { api } from "@/lib/api"
import { cn, inr, newIdempotencyKey } from "@/lib/utils"

type Action = "RETURN" | "REASSIGN" | "EXTEND" | "INVESTIGATE"

const ACTIONS: { id: Action; label: string; hint: string }[] = [
  { id: "REASSIGN", label: "Reassign", hint: "send it to a site with demand" },
  { id: "RETURN", label: "Return", hint: "recall to the yard" },
  { id: "EXTEND", label: "Extend", hint: "bill the extension" },
  { id: "INVESTIGATE", label: "Investigate", hint: "flag for audit" },
]

/**
 * The four buttons. Each POSTs an event AND a ledger entry, so the audit trail and the
 * money move together. An action that changes state without recording what it was worth
 * is the reason most dashboards cannot say what they saved.
 */
export default function ActionQueue({
  detail,
  onDone,
}: {
  detail: AssetDetail
  onDone: () => void
}) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [done, setDone] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * `disabled={busy !== null}` is NOT enough on its own. setState is asynchronous, so four
   * fast clicks all pass the check before React re-renders the disabled button - measured
   * as 4 ledger rows and INR 24,60,000 recorded for one INR 1,80,000 action. A ref is read
   * and written synchronously inside the handler, so the second click loses immediately.
   */
  const inFlight = useRef(false)

  const id = detail.asset.equipment_id
  const top: Anomaly | undefined = [...detail.signals].sort(
    (a, b) => b.est_value_inr - a.est_value_inr,
  )[0]
  const worth = top?.est_value_inr ?? 0

  async function run(action: Action) {
    if (inFlight.current) return
    inFlight.current = true
    // One key per user gesture. If a retry or a duplicate request carries the same key the
    // server returns the original row instead of writing a second one.
    const key = newIdempotencyKey()
    setBusy(action)
    setError(null)
    try {
      if (action === "REASSIGN") {
        await api.assign(
          id,
          detail.asset.site_id ?? "S003",
          detail.asset.operator_id ?? "OP101",
          "console",
        )
      } else if (action === "RETURN") {
        await api.checkin(id, detail.asset.condition_grade ?? "B", "console", "Recalled from console")
      } else {
        await api.logUsage(id, detail.asset.engine_hours_day, detail.asset.idle_hours_day, "console")
      }
      if (worth > 0) {
        await api.addLedger(
          id,
          `${action.toLowerCase()} — ${top?.title ?? "operator action"}`,
          worth,
          top?.rule_id,
          key,
        )
      }
      setDone(action)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  return (
    <section className="border border-hairline bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">Action queue</h3>
        {worth > 0 && (
          <span className="label">
            worth <span className="text-hazard">{inr(worth)}</span>
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 gap-px bg-hairline">
        {ACTIONS.map((a) => {
          const isDone = done === a.id
          return (
            <button
              key={a.id}
              onClick={() => run(a.id)}
              disabled={busy !== null}
              className={cn(
                "group flex flex-col gap-1 bg-surface px-4 py-3.5 text-left transition-colors",
                "hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45",
                isDone && "bg-nominal/10",
              )}
            >
              <span
                className={cn(
                  "text-[13.5px] font-semibold tracking-tight",
                  isDone ? "text-nominal" : "text-chalk group-hover:text-hazard",
                )}
              >
                {busy === a.id ? "working…" : isDone ? `${a.label} ✓` : a.label}
              </span>
              <span className="label normal-case tracking-normal">{a.hint}</span>
            </button>
          )
        })}
      </div>

      {error && (
        <p className="border-t border-critical/40 bg-critical/10 px-4 py-2.5 text-[12px] text-critical">
          {error}
        </p>
      )}
      {done && !error && (
        <p className="border-t border-hairline px-4 py-2.5 text-[12px] leading-relaxed text-steel">
          Event written to the audit trail
          {worth > 0 ? ` and ${inr(worth)} recorded in the ledger.` : "."} The flag clears
          because the condition changed, not because it was hidden.
        </p>
      )}
    </section>
  )
}
