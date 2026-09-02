import { useState } from "react"
import type { AvailabilityAnswer, Config } from "@/lib/types"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * The Monday question. One input row, one answer.
 *
 * This is a booking commitment, not a demand forecast. The dealer needs to know which
 * machine can be promised on a date, and a predicted-demand chart cannot tell them that.
 */
export default function AvailabilityAsk({ config }: { config?: Config }) {
  const [type, setType] = useState("Excavator")
  const [site, setSite] = useState("S003")
  const [from, setFrom] = useState("2025-05-19")
  const [days, setDays] = useState(10)
  const [answer, setAnswer] = useState<AvailabilityAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const types = Object.keys(
    config?.day_rates ?? { Excavator: 0, Bulldozer: 0, Crane: 0, Grader: 0 },
  )
  const sites = Object.keys(config?.site_branch ?? { S001: "", S002: "", S003: "" })

  async function ask() {
    setBusy(true)
    setError(null)
    try {
      setAnswer(await api.availability(type, site, from, days))
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed")
    } finally {
      setBusy(false)
    }
  }

  const field =
    "w-full border border-hairline bg-ground px-3 py-2 font-mono text-[12.5px] text-chalk outline-none focus:border-hazard"

  return (
    <section className="border border-hairline bg-surface">
      <header className="border-b border-hairline px-5 py-3.5">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
          Can I promise this machine?
        </h3>
        <p className="mt-1 text-[12.5px] text-slate">A customer is on the phone. Answer them.</p>
      </header>

      {/* Two columns, not four: this panel lives in a narrow sidebar and a four-up
          grid truncates the selects to "Exc…" and "S0…". */}
      <div className="grid grid-cols-2 gap-3 px-5 py-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">type</span>
          <select className={field} value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">site</span>
          <select className={field} value={site} onChange={(e) => setSite(e.target.value)}>
            {sites.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">needed from</span>
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">days</span>
          <input
            type="number"
            min={1}
            className={field}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 1)}
          />
        </label>
      </div>

      <div className="px-5 pb-4">
        <button
          onClick={ask}
          disabled={busy}
          className="w-full bg-hazard px-4 py-2.5 text-[13px] font-semibold tracking-tight text-ground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "checking the fleet…" : "Check availability"}
        </button>
      </div>

      {error && (
        <p className="border-t border-critical/40 bg-critical/10 px-5 py-3 text-[12px] text-critical">
          {error}
        </p>
      )}

      {answer && (
        <div
          className={cn(
            "border-t px-5 py-4",
            answer.can_commit
              ? "border-nominal/40 bg-nominal/[0.06]"
              : "border-warning/40 bg-warning/[0.06]",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={cn(
                "font-mono text-[13px] font-semibold tracking-[0.1em]",
                answer.can_commit ? "text-nominal" : "text-warning",
              )}
            >
              {answer.can_commit ? "YES" : "NO"}
            </span>
            {answer.equipment_id && (
              <span className="num text-[18px] font-semibold text-chalk">{answer.equipment_id}</span>
            )}
            {answer.free_from && <span className="label">free {answer.free_from}</span>}
            <span className="label ml-auto">
              confidence <span className="text-hazard">{(answer.confidence * 100).toFixed(0)}%</span>
            </span>
          </div>
          <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-chalk">
            {answer.reason}
          </p>
          {answer.alternatives.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3">
              {answer.alternatives.map((alt, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] text-steel">
                  <span className="text-slate">—</span>
                  {alt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
