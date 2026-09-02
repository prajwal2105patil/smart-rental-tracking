import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import RotatingEarth, { type GlobeMarker } from "@/components/ui/wireframe-dotted-globe"
import type { AssetRow, Config } from "@/lib/types"
import MachineSilhouette from "@/components/MachineSilhouette"
import { cn } from "@/lib/utils"

/**
 * Where the fleet physically is.
 *
 * Positions are the last GPS fix each machine actually emitted, projected onto a
 * lat/long graticule rather than a drawn coastline. That is a deliberate choice: a
 * hand-traced country outline would be decorative and slightly wrong, while a labelled
 * coordinate grid is honest about what the data is and reads as an instrument.
 *
 * A parked machine stops emitting, so its dot sits where it was last seen - which is
 * exactly the point for a machine nobody can account for.
 */

const TONE: Record<string, string> = {
  OVERDUE: "#ff5b45", UNASSIGNED: "#ff5b45", IDLE: "#ffab2e",
  ACTIVE: "#3ddc97", AT_YARD: "#6ea8ff", IN_SERVICE: "#6ea8ff",
}

const PAD = 46
const W = 720
const H = 460

export default function FleetMap({
  assets, config,
}: { assets: AssetRow[]; config?: Config }) {
  const [hover, setHover] = useState<AssetRow | null>(null)
  const [view, setView] = useState<"globe" | "plot">("globe")
  const [focusId, setFocusId] = useState<string | null>(null)

  const located = assets.filter(
    (a) => typeof a.latitude === "number" && typeof a.longitude === "number",
  )

  // One marker per machine plus one per branch, so the globe carries the same truth as
  // the plot. Machines that need action are emphasised rather than merely coloured.
  const globeMarkers = useMemo<GlobeMarker[]>(() => {
    const machines = located.map((a) => ({
      id: a.equipment_id,
      lat: a.latitude as number,
      lon: a.longitude as number,
      tone: TONE[a.status] ?? "#9aa5b6",
      label: a.equipment_id,
      detail: `${a.type} · ${a.status}`,
      emphasis: a.status === "OVERDUE" || a.status === "UNASSIGNED",
    }))
    const yards = Object.entries(config?.branches ?? {}).map(([id, b]) => ({
      id,
      lat: b.lat,
      lon: b.lon,
      tone: "#ffcd11",
      label: `${id} ${b.city}`,
      detail: "dealer branch",
    }))
    return [...yards, ...machines]
  }, [located, config])

  // Every hook above this line: the early return below runs on the first render, when
  // assets is still empty, and a hook after it would change the hook count once the
  // data lands. That is exactly the error the boundary caught.
  if (!located.length) {
    return (
      <section className="border border-hairline bg-surface px-5 py-10 text-center">
        <p className="label">no position fixes in the telemetry yet</p>
      </section>
    )
  }

  const branches = Object.entries(config?.branches ?? {})


  // Default to a machine that is EARNING: assigned, producing, best utilisation of the
  // working fleet. The flags panel already carries everything that is wrong; opening on
  // a broken machine made the board look like nothing was working at all.
  // Hovering any marker - including a red one - still takes over.
  const focus = located.find((a) => a.equipment_id === focusId)
    ?? [...located]
      .sort((a, b) => {
        const aw = a.status === "ACTIVE" ? 0 : 1
        const bw = b.status === "ACTIVE" ? 0 : 1
        return aw - bw || b.utilization_pct - a.utilization_pct
      })[0]

  // Same thresholds the rules use, so a bar on this card and a bar in the table agree.
  const warnPct = (config?.idle_utilisation_warn ?? 0.35) * 100
  const critPct = (config?.idle_utilisation_crit ?? 0.2) * 100

  // What is actually working right now, grouped by type. The card above shows the
  // machine that needs attention; this shows the fleet that does not - a dealer needs
  // both, and the board only ever surfaced the problems.
  const working = located.filter((a) => a.status === "ACTIVE")
  const byType = Object.entries(
    working.reduce<Record<string, AssetRow[]>>((m, a) => {
      (m[a.type] ??= []).push(a)
      return m
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length)

  // Bounds from everything we plot, so branches never fall outside the frame.
  const lats = [...located.map((a) => a.latitude as number), ...branches.map(([, b]) => b.lat)]
  const lons = [...located.map((a) => a.longitude as number), ...branches.map(([, b]) => b.lon)]
  const minLat = Math.min(...lats) - 1.4, maxLat = Math.max(...lats) + 1.4
  const minLon = Math.min(...lons) - 1.4, maxLon = Math.max(...lons) + 1.4

  const px = (lon: number) => PAD + ((lon - minLon) / (maxLon - minLon)) * (W - PAD * 2)
  // latitude increases upward, screen y increases downward
  const py = (lat: number) => PAD + (1 - (lat - minLat) / (maxLat - minLat)) * (H - PAD * 2)

  const latTicks = ticks(minLat, maxLat)
  const lonTicks = ticks(minLon, maxLon)

  return (
    <section className="min-w-0 border border-hairline bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] text-hazard">E</span>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
            Where the fleet is
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="label">{located.length} fixes · 4 branches</span>
          <div className="flex">
            {(["globe", "plot"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                  view === v
                    ? "border-hazard/60 bg-hazard/10 text-hazard"
                    : "border-hairline-bright text-slate hover:text-chalk",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* The globe is the arresting view; the flat plot is the one you read positions
          off. Both draw from the same fixes, so neither can disagree with the other. */}
      {view === "globe" ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <RotatingEarth
            markers={globeMarkers}
            focus={[78, 21]}
            height={520}
            onMarkerHover={setFocusId}
          />

          {/* The globe is square; the card fills the width beside it rather than leaving
              dead space, and shows whichever machine the pointer is over. */}
          {focus && (
            <aside className="flex min-w-0 flex-col border border-hairline bg-ground">
              <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
                <div className="min-w-0">
                  <p className="num text-[17px] font-semibold leading-none text-chalk">
                    {focus.equipment_id}
                  </p>
                  <p className="mt-1.5 truncate text-[12.5px] text-steel">{focus.type}</p>
                </div>
                <span className={cn(
                  "shrink-0 border px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-[0.12em]",
                  focus.status === "OVERDUE" || focus.status === "UNASSIGNED"
                    ? "border-critical/50 text-critical"
                    : focus.status === "IDLE"
                      ? "border-warning/50 text-warning"
                      : "border-nominal/40 text-nominal",
                )}>
                  {focus.status}
                </span>
              </header>

              <div className="flex items-center justify-center border-b border-hairline px-4 py-4">
                <MachineSilhouette
                  type={focus.type}
                  tone={TONE[focus.status] ?? "#f2f4f8"}
                  className="h-auto w-full max-w-[240px]"
                />
              </div>

              <dl className="flex flex-col">
                {[
                  ["site", focus.site_id ?? "NO SITE"],
                  ["operator", focus.operator_id ?? "NO OPERATOR"],
                  ["branch", focus.branch_id ?? "—"],
                  ["position", `${focus.latitude?.toFixed(4)}, ${focus.longitude?.toFixed(4)}`],
                  ["last fix", focus.last_fix ? focus.last_fix.replace("T", " ").slice(0, 16) : "—"],
                  ["utilisation", `${focus.utilization_pct.toFixed(1)}%`],
                ].map(([k, v]) => (
                  <div key={k}
                       className="flex items-baseline justify-between gap-3 border-b border-hairline/60 px-4 py-2">
                    <dt className="label">{k}</dt>
                    <dd className={cn("num text-[12.5px]",
                      v === "NO SITE" || v === "NO OPERATOR" ? "text-critical" : "text-chalk")}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>

              <Link to={`/asset/${focus.equipment_id}`}
                    className="mt-auto flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface">
                <span className="text-[12.5px] text-steel">
                  {focus.flags_count > 0
                    ? `${focus.flags_count} rule${focus.flags_count > 1 ? "s" : ""} firing`
                    : "no rules firing"}
                </span>
                <span className="label">open →</span>
              </Link>
            </aside>
          )}
        </div>
      ) : (
      // Capped: the viewBox is 720x460, so at full width on a 1700px screen the plot
      // scaled past a thousand pixels tall and the fleet spread out of view.
      <div className="relative mx-auto max-w-[860px] p-4">
        {hover && (
          <div className="pointer-events-none absolute z-10 border border-hairline-bright bg-ground px-3 py-2"
               style={{ left: 16, top: 16 }}>
            <p className="num text-[13px] font-semibold text-chalk">{hover.equipment_id}</p>
            <p className="num mt-0.5 text-[11.5px] text-steel">
              {hover.type} · {hover.status}
            </p>
            <p className="num mt-0.5 text-[11px] text-slate">
              {hover.latitude?.toFixed(4)}, {hover.longitude?.toFixed(4)}
            </p>
          </div>
        )}

        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
             aria-label={`Map of ${located.length} machines across four dealer branches`}>
          {/* graticule */}
          {latTicks.map((lat) => (
            <g key={`la${lat}`}>
              <line x1={PAD} x2={W - PAD} y1={py(lat)} y2={py(lat)} stroke="#1b2230" strokeWidth={1} />
              <text x={PAD - 8} y={py(lat) + 3} textAnchor="end" fill="#616d7e"
                    fontFamily="'IBM Plex Mono',monospace" fontSize={9}>{lat.toFixed(0)}°N</text>
            </g>
          ))}
          {lonTicks.map((lon) => (
            <g key={`lo${lon}`}>
              <line x1={px(lon)} x2={px(lon)} y1={PAD} y2={H - PAD} stroke="#1b2230" strokeWidth={1} />
              <text x={px(lon)} y={H - PAD + 16} textAnchor="middle" fill="#616d7e"
                    fontFamily="'IBM Plex Mono',monospace" fontSize={9}>{lon.toFixed(0)}°E</text>
            </g>
          ))}
          <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2}
                fill="none" stroke="#2a3444" strokeWidth={1} />

          {/* branch pins, drawn under the machines */}
          {branches.map(([id, b]) => (
            <g key={id}>
              <circle cx={px(b.lon)} cy={py(b.lat)} r={16} fill="none"
                      stroke="#ffcd11" strokeWidth={1} opacity={0.35} />
              <path d={`M${px(b.lon) - 6} ${py(b.lat)} h12 M${px(b.lon)} ${py(b.lat) - 6} v12`}
                    stroke="#ffcd11" strokeWidth={1.2} />
              <text x={px(b.lon)} y={py(b.lat) - 24} textAnchor="middle" fill="#ffcd11"
                    fontFamily="'IBM Plex Mono',monospace" fontSize={10} letterSpacing="1.2">
                {b.city.toUpperCase()}
              </text>
              <text x={px(b.lon)} y={py(b.lat) + 30} textAnchor="middle" fill="#616d7e"
                    fontFamily="'IBM Plex Mono',monospace" fontSize={9}>{id}</text>
            </g>
          ))}

          {/* machines */}
          {located.map((a) => {
            const cx = px(a.longitude as number)
            const cy = py(a.latitude as number)
            const tone = TONE[a.status] ?? "#9aa5b6"
            const hot = a.status === "OVERDUE" || a.status === "UNASSIGNED"
            return (
              <g key={a.equipment_id}
                 onMouseEnter={() => setHover(a)}
                 onMouseLeave={() => setHover(null)}
                 style={{ cursor: "pointer" }}>
                {hot && <circle cx={cx} cy={cy} r={9} fill={tone} opacity={0.18} />}
                {/* 2px surface ring so overlapping dots stay countable */}
                <circle cx={cx} cy={cy} r={5} fill={tone} stroke="#0a0e15" strokeWidth={2} />
                <title>{`${a.equipment_id} — ${a.status}`}</title>
              </g>
            )
          })}
        </svg>
      </div>
      )}

      {view === "globe" && working.length > 0 && (
        <div className="border-t border-hairline">
          <header className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-3.5">
            <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
              Working right now
            </h4>
            <span className="label">
              {working.length} assigned and producing · hover to locate
            </span>
          </header>

          <div className="grid gap-px bg-hairline p-px sm:grid-cols-2 lg:grid-cols-4">
            {byType.map(([type, machines]) => (
              <div key={type} className="bg-surface px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <MachineSilhouette type={type} tone="#3ddc97" className="h-[38px] w-auto" />
                  <div className="text-right">
                    <p className="num text-[19px] font-semibold leading-none text-nominal">
                      {machines.length}
                    </p>
                    <p className="label mt-1">{type}</p>
                  </div>
                </div>

                <ul className="mt-3 flex flex-col gap-1.5 border-t border-hairline pt-2.5">
                  {machines
                    .slice()
                    .sort((a, b) => b.utilization_pct - a.utilization_pct)
                    .map((m) => (
                      <li key={m.equipment_id}>
                        <button
                          onMouseEnter={() => setFocusId(m.equipment_id)}
                          onClick={() => setFocusId(m.equipment_id)}
                          className={cn(
                            "flex w-full items-baseline gap-2 text-left transition-colors",
                            focusId === m.equipment_id ? "text-hazard" : "hover:text-chalk",
                          )}
                        >
                          <span className="num text-[12px] font-medium text-chalk">
                            {m.equipment_id}
                          </span>
                          <span className="num text-[11px] text-slate">{m.site_id}</span>
                          <span className="num ml-auto text-[11.5px] text-nominal">
                            {m.utilization_pct.toFixed(0)}%
                          </span>
                        </button>
                        {/* utilisation as a bar, so a weak one is visible without reading */}
                        <span className="mt-1 block h-[3px] w-full bg-hairline">
                          <span
                            className="block h-full"
                            style={{
                              width: `${Math.min(100, m.utilization_pct)}%`,
                              background: m.utilization_pct < critPct
                                ? "#ff5b45"
                                : m.utilization_pct < warnPct ? "#ffab2e" : "#3ddc97",
                            }}
                          />
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline px-5 py-3">
        {[
          ["OVERDUE / UNASSIGNED", "#ff5b45"],
          ["IDLE", "#ffab2e"],
          ["ACTIVE", "#3ddc97"],
          ["AT YARD", "#6ea8ff"],
        ].map(([label, c]) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: c }} aria-hidden />
            <span className="label">{label}</span>
          </span>
        ))}
        <span className="label ml-auto">hover a dot for its last fix</span>
      </div>

      {/* the two that matter, called out rather than left to be found */}
      <ul className="border-t border-hairline">
        {located
          .filter((a) => a.status === "UNASSIGNED")
          .map((a) => (
            <li key={a.equipment_id}>
              <Link to={`/asset/${a.equipment_id}`}
                    className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-2.5",
                      "border-b border-hairline/60 transition-colors last:border-0 hover:bg-raised")}>
                <span className="num text-[13px] font-semibold text-critical">{a.equipment_id}</span>
                <span className="text-[12.5px] text-steel">
                  last seen at {a.latitude?.toFixed(3)}, {a.longitude?.toFixed(3)} — no site on record
                </span>
                <span className="label ml-auto">open →</span>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  )
}

/** Whole-degree gridlines across the plotted range, capped so labels never crowd. */
function ticks(min: number, max: number): number[] {
  const step = Math.max(1, Math.ceil((max - min) / 6))
  const out: number[] = []
  for (let v = Math.ceil(min); v <= Math.floor(max); v += step) out.push(v)
  return out
}
