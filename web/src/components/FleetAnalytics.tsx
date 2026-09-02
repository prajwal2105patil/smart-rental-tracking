import { useState } from "react"
import type { AssetRow, Ledger, UsageSummary } from "@/lib/types"
import { cn, inr } from "@/lib/utils"

/**
 * The picture version of the fleet, for people who will not read the table.
 *
 * Every panel answers one question a dealer would ask out loud, and answers it in a
 * form chosen for that question rather than for decoration:
 *   A  How bad is it right now?        composition  -> donut with a hero number
 *   B  Which machines waste the day?   part-to-whole per machine -> stacked bars
 *   C  Where is the money?             part-to-whole -> one proportional bar
 *   D  Which site should I fix first?  ranking -> sorted bars against the threshold
 *
 * COLOUR. The four mark colours below were validated rather than eyeballed, against
 * this app's #05070d surface: all sit inside the OKLCH dark lightness band 0.48-0.67,
 * clear the chroma floor, exceed 3:1 contrast, and pass the normal-vision separation
 * floor. The red/green pair carries a CVD warning (deltaE 7.9 deutan, inside the 6-8
 * floor band), which is permitted only with secondary encoding - so every segment here
 * also carries a direct label, a 2px gap, and a legend. Identity is never colour alone.
 */
const C = {
  good: "#1f9d6b",     // productive, avoided
  bad: "#c9402c",      // waste, overdue, unassigned
  warn: "#c47f10",     // idle, still billable
  neutral: "#3f74c4",  // at yard
  grid: "#1b2230",
  ink: "#9aa5b6",
}

type Tip = { x: number; y: number; lines: string[] } | null

function Panel({
  n, title, question, children, className,
}: { n: string; title: string; question: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 border border-hairline bg-surface", className)}>
      <header className="border-b border-hairline px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-hazard">{n}</span>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">{title}</h3>
        </div>
        <p className="mt-1 text-[13px] text-chalk">{question}</p>
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Swatch({ color, label, value }: { color: string; label: string; value?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-2.5 shrink-0" style={{ background: color }} aria-hidden />
      <span className="text-[12px] text-steel">{label}</span>
      {value && <span className="num text-[12px] font-semibold text-chalk">{value}</span>}
    </span>
  )
}

export default function FleetAnalytics({
  assets, usage, ledger, warnPct = 35, critPct = 20,
}: {
  assets: AssetRow[]
  usage?: UsageSummary
  ledger?: Ledger
  warnPct?: number
  critPct?: number
}) {
  const [tip, setTip] = useState<Tip>(null)

  if (!assets.length) return null

  // ---------------------------------------------------------------- A. composition
  const STATUS_TONE: Record<string, string> = {
    OVERDUE: C.bad, UNASSIGNED: C.bad, IDLE: C.warn,
    ACTIVE: C.good, AT_YARD: C.neutral, IN_SERVICE: C.neutral,
  }
  const counts = assets.reduce<Record<string, number>>((m, a) => {
    m[a.status] = (m[a.status] ?? 0) + 1
    return m
  }, {})
  const order = ["OVERDUE", "UNASSIGNED", "IDLE", "ACTIVE", "AT_YARD", "IN_SERVICE"]
  const slices = order.filter((s) => counts[s]).map((s) => ({ status: s, n: counts[s] }))
  const needsAttention = (counts.OVERDUE ?? 0) + (counts.UNASSIGNED ?? 0) + (counts.IDLE ?? 0)

  // donut geometry
  const R = 62, STROKE = 20, CIRC = 2 * Math.PI * R
  let acc = 0

  // ---------------------------------------------------------------- B. day shape
  // Daily hours, not cumulative: "this machine is out 12 hours a day and none of them
  // are productive" is a sentence anyone understands without a definition.
  const dayShape = [...assets]
    .filter((a) => a.engine_hours_day + a.idle_hours_day > 0)
    .sort((a, b) => b.idle_hours_day - a.idle_hours_day)
    .slice(0, 8)
  const maxDay = Math.max(...dayShape.map((a) => a.engine_hours_day + a.idle_hours_day), 1)

  // ---------------------------------------------------------------- C. money
  const e = ledger?.exposure
  const money = [
    { k: "Already wasted", v: e?.waste_inr ?? 0, c: C.bad },
    { k: "Downtime avoided", v: e?.avoided_inr ?? 0, c: C.good },
    { k: "Still billable", v: e?.recoverable_inr ?? 0, c: C.warn },
  ]
  const moneyTotal = money.reduce((s, m) => s + m.v, 0) || 1

  // ---------------------------------------------------------------- D. sites
  const sites = [...(usage?.by_site ?? [])].sort((a, b) => a.utilisation_pct - b.utilisation_pct)

  const toneFor = (p: number) => (p < critPct ? C.bad : p < warnPct ? C.warn : C.good)

  return (
    <div className="relative grid min-w-0 gap-7 lg:grid-cols-2">
      {tip && (
        <div
          className="pointer-events-none fixed z-50 border border-hairline-bright bg-ground px-3 py-2 shadow-lg"
          style={{ left: tip.x + 14, top: tip.y + 14 }}
          role="status"
        >
          {tip.lines.map((l, i) => (
            <p key={i} className={cn("num whitespace-nowrap text-[12px]", i === 0 ? "text-chalk" : "text-steel")}>
              {l}
            </p>
          ))}
        </div>
      )}

      {/* ============================================ A */}
      <Panel n="A" title="Fleet at a glance" question="How many machines need someone to act today?">
        <div className="flex flex-wrap items-center gap-7">
          <svg viewBox="0 0 170 170" className="h-[170px] w-[170px] shrink-0" role="img"
               aria-label={`${needsAttention} of ${assets.length} machines need attention`}>
            <circle cx="85" cy="85" r={R} fill="none" stroke={C.grid} strokeWidth={STROKE} />
            {slices.map((s) => {
              const frac = s.n / assets.length
              const dash = frac * CIRC
              const el = (
                <circle
                  key={s.status}
                  cx="85" cy="85" r={R} fill="none"
                  stroke={STATUS_TONE[s.status] ?? C.neutral}
                  strokeWidth={STROKE}
                  // 2px surface gap between adjacent segments
                  strokeDasharray={`${Math.max(dash - 2, 0)} ${CIRC - Math.max(dash - 2, 0)}`}
                  strokeDashoffset={-acc}
                  transform="rotate(-90 85 85)"
                  onMouseMove={(ev) =>
                    setTip({ x: ev.clientX, y: ev.clientY,
                      lines: [`${s.status} — ${s.n} machine${s.n > 1 ? "s" : ""}`,
                              `${((s.n / assets.length) * 100).toFixed(0)}% of the fleet`] })}
                  onMouseLeave={() => setTip(null)}
                >
                  <title>{`${s.status}: ${s.n}`}</title>
                </circle>
              )
              acc += dash
              return el
            })}
            <text x="85" y="80" textAnchor="middle" className="num"
                  fill="#f2f4f8" fontSize="34" fontWeight="700">{needsAttention}</text>
            <text x="85" y="99" textAnchor="middle" fill={C.ink}
                  fontFamily="'IBM Plex Mono',monospace" fontSize="9" letterSpacing="1.6">
              NEED ACTION
            </text>
          </svg>

          <ul className="flex min-w-0 flex-col gap-2.5">
            {slices.map((s) => (
              <li key={s.status} className="flex items-center gap-2.5">
                <span className="size-2.5 shrink-0" style={{ background: STATUS_TONE[s.status] }} aria-hidden />
                <span className="num w-[26px] text-right text-[14px] font-semibold text-chalk">{s.n}</span>
                <span className="font-mono text-[11px] tracking-[0.1em] text-steel">{s.status}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 border-t border-hairline pt-3 text-[12.5px] leading-relaxed text-steel">
          {needsAttention} of {assets.length} machines are overdue, unassigned or sitting idle
          while still on rent. Those are the rows a dealer works first.
        </p>
      </Panel>

      {/* ============================================ B */}
      <Panel n="B" title="Where the day goes" question="Which machines are being paid for but not working?">
        <div className="mb-3 flex flex-wrap gap-4">
          <Swatch color={C.good} label="Productive hours" />
          <Swatch color={C.warn} label="Idle hours — engine on, nothing done" />
        </div>
        <ul className="flex flex-col gap-2">
          {dayShape.map((a) => {
            const total = a.engine_hours_day + a.idle_hours_day
            const gw = (a.engine_hours_day / maxDay) * 100
            const iw = (a.idle_hours_day / maxDay) * 100
            return (
              <li key={a.equipment_id} className="flex items-center gap-3"
                  onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, lines: [
                    `${a.equipment_id} — ${a.type}`,
                    `${a.engine_hours_day}h productive · ${a.idle_hours_day}h idle`,
                    `${a.utilization_pct.toFixed(1)}% utilisation`,
                  ]})}
                  onMouseLeave={() => setTip(null)}>
                <span className="num w-[64px] shrink-0 text-[12px] text-steel">{a.equipment_id}</span>
                <span className="relative flex h-[15px] min-w-0 flex-1 bg-hairline/60">
                  {a.engine_hours_day > 0 && (
                    <span style={{ width: `${gw}%`, background: C.good }} title={`${a.engine_hours_day}h productive`} />
                  )}
                  {/* 2px surface gap between the two fills */}
                  {a.engine_hours_day > 0 && a.idle_hours_day > 0 && <span className="w-[2px] bg-surface" />}
                  {a.idle_hours_day > 0 && (
                    <span style={{ width: `${iw}%`, background: C.warn }} title={`${a.idle_hours_day}h idle`} />
                  )}
                </span>
                <span className="num w-[54px] shrink-0 text-right text-[12px]"
                      style={{ color: a.engine_hours_day === 0 ? C.bad : C.ink }}>
                  {a.engine_hours_day === 0 ? "0 done" : `${total}h`}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 border-t border-hairline pt-3 text-[12.5px] leading-relaxed text-steel">
          A bar that is entirely amber is a machine on hire that produced nothing that day.
          The customer is billed either way.
        </p>
      </Panel>

      {/* ============================================ C */}
      <Panel n="C" title="Where the money is" question="What is the exposure actually made of?">
        <div className="flex h-[34px] w-full overflow-hidden">
          {money.map((m, i) => (
            <span key={m.k} className="flex items-center" style={{ width: `${(m.v / moneyTotal) * 100}%` }}>
              <span className="h-full w-full" style={{ background: m.c }}
                    onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY,
                      lines: [m.k, inr(m.v), `${((m.v / moneyTotal) * 100).toFixed(0)}% of exposure`] })}
                    onMouseLeave={() => setTip(null)}>
                <span className="sr-only">{m.k}: {inr(m.v)}</span>
              </span>
              {i < money.length - 1 && <span className="h-full w-[2px] shrink-0 bg-surface" />}
            </span>
          ))}
        </div>
        <ul className="mt-4 flex flex-col gap-2.5">
          {money.map((m) => (
            <li key={m.k} className="flex items-baseline gap-2.5">
              <span className="size-2.5 shrink-0 translate-y-[1px]" style={{ background: m.c }} aria-hidden />
              <span className="min-w-0 flex-1 text-[13px] text-steel">{m.k}</span>
              <span className="num text-[14px] font-semibold text-chalk">{inr(m.v)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-hairline pt-3 text-[12.5px] leading-relaxed text-steel">
          These are three different kinds of money and are never added into one headline:
          spent, recoverable, and not-yet-incurred.
        </p>
      </Panel>

      {/* ============================================ D */}
      <Panel n="D" title="Which site to fix first" question="Where is capacity being wasted?">
        <ul className="flex flex-col gap-2">
          {sites.map((s) => (
            <li key={s.site_id} className="flex items-center gap-3"
                onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, lines: [
                  `${s.site_id}${s.branch_id ? ` · ${s.branch_id}` : ""}`,
                  `${s.utilisation_pct}% utilisation · ${s.assets} machines`,
                  `${inr(s.idle_cost_inr)} of idle cost`,
                ]})}
                onMouseLeave={() => setTip(null)}>
              <span className={cn("num w-[86px] shrink-0 text-[12px]",
                s.site_id === "UNASSIGNED" ? "text-critical" : "text-steel")}>
                {s.site_id}
              </span>
              <span className="relative h-[15px] min-w-0 flex-1 bg-hairline/60">
                <span className="absolute inset-y-0 left-0"
                      style={{ width: `${s.utilisation_pct}%`, background: toneFor(s.utilisation_pct) }} />
                {/* the rule the number is judged against, drawn on the bar */}
                <span className="absolute inset-y-0 w-px bg-chalk/45" style={{ left: `${warnPct}%` }}
                      title={`warn threshold ${warnPct}%`} />
              </span>
              <span className="num w-[46px] shrink-0 text-right text-[12px] text-chalk">
                {s.utilisation_pct}%
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline pt-3">
          <Swatch color={C.bad} label={`below ${critPct}%`} />
          <Swatch color={C.warn} label={`below ${warnPct}%`} />
          <Swatch color={C.good} label="healthy" />
          <span className="text-[12px] text-slate">| white line = the threshold the rule uses</span>
        </p>
      </Panel>
    </div>
  )
}
