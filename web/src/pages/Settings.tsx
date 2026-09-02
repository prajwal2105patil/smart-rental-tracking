import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useResilientQuery } from "@/lib/useResilientQuery"
import { api } from "@/lib/api"
import { cn, inr } from "@/lib/utils"

/**
 * Assumptions on screen, editable, with the formula printed beside them.
 *
 * This is the screen that turns "where did that number come from?" from a challenge
 * into the best thirty seconds of the demo - change the input, watch every figure move.
 */
export default function Settings() {
  const qc = useQueryClient()
  const { data: config, isLoading, error: loadError, retry } = useResilientQuery(
    ["config"], api.config,
  )
  const { data: ledger } = useQuery({ queryKey: ["ledger"], queryFn: api.ledger })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await api.patchConfig(body)
      await qc.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : "update rejected")
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    // Destructive and irreversible: it clears every event and ledger row taken so far.
    // One misplaced click during a demo should not be able to do that silently.
    const entries = ledger?.entries.length ?? 0
    if (!window.confirm(
      `Reset the demo?

This clears ${entries} ledger row(s) and every event recorded ` +
      `in this session, and restores the original seed state. It cannot be undone.`
    )) return
    setBusy(true)
    try {
      await api.reset()
      await qc.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : "reset failed")
    } finally {
      setBusy(false)
    }
  }

  const field =
    "w-full border border-hairline bg-ground px-3 py-2 font-mono text-[13px] text-chalk outline-none focus:border-hazard"

  const THRESHOLDS: { key: string; label: string; step?: number }[] = [
    { key: "idle_utilisation_warn", label: "idle utilisation — warn", step: 0.01 },
    { key: "idle_utilisation_crit", label: "idle utilisation — critical", step: 0.01 },
    { key: "service_interval_hours", label: "service interval (hours)", step: 10 },
    { key: "transit_days", label: "transit days (yard → site)", step: 1 },
    { key: "service_days", label: "service days off the board", step: 1 },
    { key: "due_soon_days", label: "due-back reminder window (days)", step: 1 },
    { key: "zero_output_min_days", label: "zero output — minimum days", step: 1 },
    { key: "coolant_warn_c", label: "coolant warn (°C)", step: 1 },
    { key: "coolant_failure_c", label: "coolant failure (°C)", step: 1 },
  ]

  // Rendering the form while the config query has not resolved showed nine empty number
  // inputs on a page that otherwise looked fully operational - an operator could type a
  // threshold derived from nothing at all.
  // Branch on `error`, NOT `isError`. A data-less query that is refetching resets its
  // status to 'pending', so isError oscillates every poll and the screen flickers between
  // "loading" and "failed" - measured flipping every 3 seconds. React Query keeps the
  // `error` object populated until a fetch actually succeeds, so it is the stable signal.
  if (loadError)
    return (
      <div className="border border-critical/40 bg-critical/[0.07] px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-critical">
          Settings unavailable
        </p>
        <p className="mt-2 max-w-[52ch] text-[14px] text-steel">
          The console cannot read the current thresholds, so it will not show you fields to
          edit. Nothing has been changed.
        </p>
        <button
          onClick={() => retry()}
          className="mt-5 border border-hazard bg-hazard px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ground"
        >
          Retry
        </button>
      </div>
    )
  if (isLoading || !config)
    return <p className="label py-20 text-center">reading the current assumptions…</p>

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-chalk">Assumptions</h1>
          <p className="mt-1.5 max-w-[64ch] text-[14px] text-steel">
            Every threshold the rules use lives here. There is not one numeric literal in the
            rules code — change a number and every figure on the board recomputes.
          </p>
        </div>
        <button
          onClick={reset}
          disabled={busy}
          className="border border-hairline-bright px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-steel hover:border-hazard hover:text-hazard disabled:opacity-40"
        >
          Reset demo state
        </button>
      </header>

      {error && (
        <p className="border border-critical/40 bg-critical/10 px-4 py-3 text-[12.5px] text-critical">
          {error}
        </p>
      )}

      {/* -------------------- the formulas, printed -------------------- */}
      <section className="border border-hairline bg-surface p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">The formulas</h2>
        <pre className="mt-3 overflow-x-auto border-l-2 border-l-hazard bg-ground px-4 py-3 font-mono text-[12px] leading-[1.8] text-steel">
{`utilisation   = engine_hours_day / (engine_hours_day + idle_hours_day)
hourly_rate   = day_rate / (engine_hours_day + idle_hours_day)
idle_waste    = idle_hours_day × operating_days × hourly_rate
rental_line   = day_rate × operating_days
overdue_value = days_overdue × day_rate
window        = (check_in_date − check_out_date).days + 1`}
        </pre>
      </section>

      {/* -------------------- day rates -------------------- */}
      <section className="border border-hairline bg-surface">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
            Day rates (INR)
          </h2>
          <span className="label">
            basis <span className="text-hazard">{config?.rate_basis ?? "—"}</span>
          </span>
        </header>

        <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(config?.day_rates ?? {}).map(([type, rate]) => (
            <label key={type} className="flex flex-col gap-2 bg-surface px-4 py-3.5">
              <span className="label">{type}</span>
              <input
                type="number"
                step={500}
                defaultValue={rate}
                className={field}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (v && v !== rate) patch({ day_rates: { [type]: v } })
                }}
              />
              <span className="label normal-case tracking-normal">
                catalogue-implied {inr(config?.day_rates_price_implied?.[type] ?? 0)}
              </span>
            </label>
          ))}
        </div>

        <p className="border-t border-hairline px-5 py-3 text-[11.5px] leading-relaxed text-slate">
          The published card is the default. The catalogue-implied column scales the published
          excavator rate by the real median list-price ratio for that class, taken from 806,485
          transactions — offered as a cross-check, not a replacement. It has one known weakness:
          the source has no grader category, so Grader is proxied by road pavers and prices above
          an excavator, which is wrong for real equipment.
        </p>
      </section>

      {/* -------------------- thresholds -------------------- */}
      <section className="border border-hairline bg-surface">
        <header className="border-b border-hairline px-5 py-3.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">Thresholds</h2>
        </header>
        <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
          {THRESHOLDS.map((t) => {
            const current = config?.[t.key] as number | undefined
            return (
              <label key={t.key} className="flex flex-col gap-2 bg-surface px-4 py-3.5">
                <span className="label">{t.label}</span>
                <input
                  type="number"
                  step={t.step ?? 1}
                  defaultValue={current}
                  className={field}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (!Number.isNaN(v) && v !== current) patch({ [t.key]: v })
                  }}
                />
                <span className="num text-[11px] text-slate">{t.key}</span>
              </label>
            )
          })}
        </div>
      </section>

      {/* -------------------- what it moves -------------------- */}
      <section className="grid gap-px bg-hairline sm:grid-cols-3">
        {[
          { k: "waste already burned", v: ledger?.exposure.waste_inr, tone: "text-critical" },
          { k: "still billable", v: ledger?.exposure.recoverable_inr, tone: "text-warning" },
          { k: "downtime avoided", v: ledger?.exposure.avoided_inr, tone: "text-nominal" },
        ].map((s) => (
          <div key={s.k} className="bg-surface px-5 py-4">
            <p className="label">{s.k}</p>
            <p className={cn("num mt-1.5 text-[23px] font-semibold leading-none", s.tone)}>
              {s.v === undefined ? "—" : inr(s.v)}
            </p>
          </div>
        ))}
      </section>

      {/* -------------------- branch network -------------------- */}
      <section className="border border-hairline bg-surface">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
            Branch network
          </h2>
          <span className="label">real dealer branches from the source catalogue</span>
        </header>
        <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(config?.branches ?? {}).map(([id, b]) => (
            <div key={id} className="bg-surface px-4 py-3.5">
              <p className="num text-[13px] font-semibold text-chalk">{id}</p>
              <p className="mt-0.5 text-[13px] text-steel">{b.city}</p>
              <p className="num mt-1.5 text-[11px] text-slate">
                {b.lat.toFixed(3)}, {b.lon.toFixed(3)}
              </p>
            </div>
          ))}
        </div>
        <p className="border-t border-hairline px-5 py-3 text-[11.5px] leading-relaxed text-slate">
          Inter-branch transit is a stated assumption, not data. The source catalogue has no
          distances, and its delivery column measures order-to-delivery for a purchase — median
          15 days, identical at all four Indian branches — which is not yard-to-site transit.
        </p>
      </section>
    </div>
  )
}
