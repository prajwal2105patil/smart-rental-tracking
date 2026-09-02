import type { Ledger } from "@/lib/types"
import { cn, inr } from "@/lib/utils"

/**
 * The running total, plus the three buckets kept apart.
 *
 * Waste, billable and avoided are three different kinds of money. Adding them into one
 * headline produces a figure that dies on the first question, so the header shows what
 * has actually been actioned and the breakdown shows what is still exposed.
 */
export default function ValueLedger({ ledger, compact = false }: { ledger?: Ledger; compact?: boolean }) {
  const recovered = ledger?.total_recovered_inr ?? 0
  const e = ledger?.exposure

  if (compact) {
    return (
      <div className="flex items-baseline gap-2.5">
        <span className="label">recovered</span>
        <span className="num text-[19px] font-semibold tabular-nums text-hazard">{inr(recovered)}</span>
        {!!ledger?.entries.length && (
          <span className="label">{ledger.entries.length} action{ledger.entries.length > 1 ? "s" : ""}</span>
        )}
      </div>
    )
  }

  const buckets = [
    { k: "Waste already burned", v: e?.waste_inr ?? 0, note: "R1 · R2 · R3 · R7", tone: "text-critical" },
    { k: "Still billable",       v: e?.recoverable_inr ?? 0, note: "R4 · R6", tone: "text-warning" },
    { k: "Downtime avoided",     v: e?.avoided_inr ?? 0, note: "R5", tone: "text-nominal" },
  ]

  return (
    <section className="border border-hairline bg-surface">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <p className="label">recovered this session</p>
          <p className="num mt-1 text-[34px] font-semibold leading-none text-hazard">{inr(recovered)}</p>
        </div>
        <p className="label max-w-[26ch] text-right leading-relaxed">
          every action writes an immutable row
        </p>
      </header>

      <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
        {buckets.map(b => (
          <div key={b.k} className="bg-surface px-5 py-3.5">
            <p className="label">{b.k}</p>
            <p className={cn("num mt-1 text-[19px] font-semibold leading-none", b.tone)}>{inr(b.v)}</p>
            <p className="label mt-1.5 tracking-[0.1em]">{b.note}</p>
          </div>
        ))}
      </div>

      {!!ledger?.entries.length && (
        <ul className="max-h-52 overflow-y-auto border-t border-hairline">
          {[...ledger.entries].reverse().map(en => (
            <li key={en.entry_id}
                className="flex items-baseline gap-3 border-b border-hairline/60 px-5 py-2.5 last:border-0">
              <span className="num text-[11px] text-slate">{en.rule_id ?? "—"}</span>
              <span className="num text-[12px] font-medium text-chalk">{en.equipment_id}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-steel">{en.action}</span>
              <span className="num text-[12.5px] font-medium text-hazard">{inr(en.est_value_inr)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-hairline px-5 py-2.5 text-[11.5px] leading-relaxed text-slate">
        Waste is money already spent, billable is money still owed, avoided is downtime not
        yet incurred. They are three different claims and are never added together.
      </p>
    </section>
  )
}
