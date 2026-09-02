import { useState } from "react"
import { Link } from "react-router-dom"
import type { Forecast } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * What each site is about to need.
 *
 * This is the one panel on the board that talks about the future, so it is the one
 * that has to be most careful about what it claims. Two things keep it honest.
 *
 * It never draws a curve. There is no demand signal in the catalogue behind this
 * build - eleven years of monthly volume flat to within three percent - so a fitted
 * model would produce a horizontal line and call it a prediction. What is projected
 * here is mechanical instead: a site is working a machine type at a rate read off
 * the machine's own cumulative counter, and a machine of that type is booked to
 * leave inside the horizon. The site will be short from the day it goes.
 *
 * And it separates a guess from a fact. A row marked PROJECTED was inferred; a row
 * marked BOOKED is a request somebody actually made. They are never blended into
 * one number, and the badge says which is which before the sentence does.
 */

function Sparkline({ points }: { points: { date: string; engine_hours: number }[] }) {
  if (points.length < 2) return null
  const max = Math.max(...points.map((p) => p.engine_hours), 1)
  const w = 160, h = 26
  const step = w / (points.length - 1)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[26px] w-[160px]" aria-hidden>
      {points.map((p, i) => (
        <rect
          key={p.date}
          x={i * step}
          y={h - (p.engine_hours / max) * h}
          width={Math.max(1.5, step - 2)}
          height={Math.max(1, (p.engine_hours / max) * h)}
          fill="var(--color-hazard)"
          // The last day is the one the projection reads off, so it is the one lit.
          opacity={i === points.length - 1 ? 0.95 : 0.32}
        />
      ))}
    </svg>
  )
}

function Row({ f }: { f: Forecast }) {
  const [open, setOpen] = useState(false)
  const booked = f.basis === "booking"
  const rec = f.recommendation

  return (
    <li className="border-b border-hairline last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-raised"
      >
        <span className={cn(
          "mt-[3px] shrink-0 border px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em]",
          booked ? "border-nominal/50 text-nominal" : "border-info/50 text-info",
        )}>
          {booked ? "booked" : "projected"}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-relaxed text-chalk">{f.headline}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="label">{f.equipment_type}</span>
            <span className="num text-[11.5px] text-slate">
              confidence {f.confidence.toFixed(2)}
            </span>
            {rec?.equipment_id && (
              <span className="num text-[11.5px] text-hazard">cover: {rec.equipment_id}</span>
            )}
          </span>
        </span>

        {f.history.length > 1 && (
          <span className="hidden shrink-0 sm:block">
            <Sparkline points={f.history} />
            <span className="label mt-1 block text-right">{f.history.length}d worked</span>
          </span>
        )}

        <span className="label mt-[3px] shrink-0 group-hover:text-hazard">
          {open ? "hide" : "why"}
        </span>
      </button>

      {open && (
        <div className="border-t border-hairline bg-ground px-5 py-4">
          <p className="label">the signals behind it</p>
          <dl className="mt-2.5 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {f.signals.map((s) => (
              <div key={s.field} className="flex items-baseline justify-between gap-3 border-b border-hairline/60 pb-1.5">
                <dt className="font-mono text-[11px] text-slate">{s.field}</dt>
                <dd className="num text-[12.5px] text-chalk">
                  {String(s.value)}
                  {s.threshold !== null && s.threshold !== undefined && (
                    <span className="ml-2 text-[11px] text-slate">/ {String(s.threshold)}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {f.leaving.length > 0 && (
            <p className="mt-3 text-[12.5px] text-steel">
              Leaving:{" "}
              {f.leaving.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link to={`/asset/${id}`} className="num text-chalk hover:text-hazard">{id}</Link>
                </span>
              ))}
            </p>
          )}

          {rec && (
            <div className="mt-4 border-l-2 border-l-hazard bg-hazard/[0.05] px-3 py-2.5">
              <p className="label">recommendation</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-chalk">{rec.reason}</p>
              {rec.alternatives.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {rec.alternatives.map((a) => (
                    <li key={a} className="text-[12.5px] leading-relaxed text-steel">— {a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function DemandForecast({ forecast }: { forecast?: Forecast[] }) {
  const rows = forecast ?? []
  const projected = rows.filter((r) => r.basis === "return").length

  return (
    <section className="min-w-0 border border-hairline bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-hazard">P</span>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
            What each site will need
          </h3>
        </div>
        <span className="label">
          {projected} projected · {rows.length - projected} booked
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-nominal">
          No site is due to lose a machine it is working inside the horizon.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((f) => <Row key={`${f.site_id}-${f.equipment_type}-${f.needed_from}`} f={f} />)}
        </ul>
      )}

      <p className="border-t border-hairline px-5 py-2.5 text-[11.5px] leading-relaxed text-slate">
        Projected, not fitted. A site working a type at a measured rate loses a machine of
        that type inside the horizon, so it will be short from the day it goes. The rate is
        read off each machine's own cumulative counter, never a typed-in field. Booked rows
        are requests already made and are never blended with the projections.
      </p>
    </section>
  )
}
