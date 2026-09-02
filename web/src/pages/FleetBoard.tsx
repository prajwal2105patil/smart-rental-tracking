import { Link } from "react-router-dom"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useResilientQuery } from "@/lib/useResilientQuery"
import { api } from "@/lib/api"
import { cn, inr, shortDate } from "@/lib/utils"
import StatusPill from "@/components/StatusPill"
import UtilisationBar from "@/components/UtilisationBar"
import AvailabilityAsk from "@/components/AvailabilityAsk"
import ValueLedger from "@/components/ValueLedger"
import FleetAnalytics from "@/components/FleetAnalytics"
import DemandForecast from "@/components/DemandForecast"
import FleetBriefing from "@/components/FleetBriefing"
import FleetMap from "@/components/FleetMap"
import MetricReport, { type MetricKey } from "@/components/MetricReport"
import SOSBanner from "@/components/SOSBanner"

const RANK: Record<string, number> = {
  OVERDUE: 0, UNASSIGNED: 1, IDLE: 2, IN_SERVICE: 3, ACTIVE: 4, AT_YARD: 5,
}

export default function FleetBoard() {
  const { data: assets, isLoading, error, retry } = useResilientQuery(["assets"], api.assets)
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config, refetchInterval: false })
  const { data: ledger } = useQuery({ queryKey: ["ledger"], queryFn: api.ledger })
  const { data: usage } = useQuery({ queryKey: ["usage"], queryFn: api.usage })
  const { data: maintenance } = useQuery({ queryKey: ["maintenance"], queryFn: api.maintenance })
  const { data: brief } = useQuery({ queryKey: ["briefing"], queryFn: api.briefing })
  const { data: anomalies } = useQuery({ queryKey: ["anomalies"], queryFn: api.anomalies })
  const { data: forecast } = useQuery({ queryKey: ["forecast"], queryFn: api.forecast })
  const [report, setReport] = useState<MetricKey | null>(null)

  // Red rows first. A board that sorts alphabetically makes the operator do the triage.
  const rows = [...(assets ?? [])].sort(
    (a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
      b.flags_count - a.flags_count ||
      a.utilization_pct - b.utilization_pct,
  )

  const warn = (config?.idle_utilisation_warn ?? 0.35) * 100
  const crit = (config?.idle_utilisation_crit ?? 0.2) * 100

  // The old version printed the raw exception and a uvicorn command straight to the
  // operator. Plain English first, a way to recover second, the stack trace last.
  // Branch on `error`, NOT `isError`. A data-less query that is refetching resets its
  // status to 'pending', so isError oscillates every poll and the screen flickers between
  // "loading" and "failed" - measured flipping every 3 seconds. React Query keeps the
  // `error` object populated until a fetch actually succeeds, so it is the stable signal.
  if (error) {
    return (
      <div className="border border-critical/40 bg-critical/[0.07] px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-critical">
          No connection to the fleet
        </p>
        <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-chalk">
          The console cannot reach the rental service.
        </h2>
        <p className="mt-2 max-w-[54ch] text-[14px] leading-relaxed text-steel">
          Nothing has been lost — the event log and the ledger live on the service, not in
          this browser. Check the connection and try again.
        </p>
        <button
          onClick={() => retry()}
          className="mt-5 border border-hazard bg-hazard px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ground"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <MetricReport
        metric={report}
        onClose={() => setReport(null)}
        data={{
          assets: assets ?? [], anomalies: anomalies ?? [],
          maintenance: maintenance ?? [], usage, ledger,
        }}
      />

      <FleetBriefing briefing={brief} onDrill={setReport} />

      <DemandForecast forecast={forecast} />

      {/* Prominent SOS Warning Banner in Middle of Fleet Dashboard */}
      <SOSBanner />

      {/* fleet-level readout */}
      <section className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {([
          { k: "machines on the board", m: "machines", v: String(assets?.length ?? "—") },
          { k: "fleet utilisation", m: "utilisation", v: usage ? `${usage.fleet.utilisation_pct}%` : "—" },
          { k: "downtime hours", m: "downtime", v: usage ? usage.fleet.downtime_hours.toLocaleString("en-IN") : "—" },
          { k: "open exposure", m: "exposure", v: ledger ? inr(ledger.exposure.total_exposure_inr) : "—" },
        ] as const).map((s) => (
          <button
            key={s.k}
            onClick={() => setReport(s.m)}
            className="group bg-surface px-5 py-4 text-left transition-colors hover:bg-raised"
          >
            <p className="label group-hover:text-hazard">{s.k} →</p>
            <p className="num mt-1.5 text-[27px] font-semibold leading-none text-chalk">{s.v}</p>
          </button>
        ))}
      </section>

      {maintenance?.map((m) => (
        <Link
          key={m.equipment_id}
          to={`/asset/${m.equipment_id}`}
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-critical/40 bg-critical/[0.07] px-5 py-3.5 transition-colors hover:bg-critical/[0.12]"
        >
          <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-critical">
            SPN {m.spn} / FMI {m.fmi}
          </span>
          <span className="num text-[14px] font-semibold text-chalk">{m.equipment_id}</span>
          <span className="text-[13px] text-steel">{m.part}</span>
          <span className="num ml-auto text-[13px] text-critical">
            {m.current_temp_c.toFixed(1)}°C · {m.days_to_failure.toFixed(1)} operating days left
          </span>
        </Link>
      ))}

      <FleetAnalytics
        assets={assets ?? []}
        usage={usage}
        ledger={ledger}
        warnPct={warn}
        critPct={crit}
      />

      <FleetMap assets={assets ?? []} config={config} />

      {/* min-w-0: a grid/flex child defaults to min-width:auto and refuses to shrink
          below its content, so the overflow-x-auto wrapper below never engages and the
          whole page scrolls sideways on a phone instead of just the table. */}
      <div className="grid min-w-0 gap-7 xl:grid-cols-[1.6fr_1fr]">
        {/* ------------------------- the board -------------------------- */}
        <section className="min-w-0 border border-hairline bg-surface">
          <header className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-3.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">Fleet board</h2>
            <span className="label">worst first · polls every 5s</span>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline">
                  {["asset", "type", "status", "site", "operator", "utilisation", "idle h/d", "due back", "flags"].map(
                    (h) => (
                      <th key={h} scope="col" className="label px-4 py-2.5 font-normal whitespace-nowrap">{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="label px-4 py-10 text-center">reading the fleet…</td>
                  </tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center">
                      <p className="text-[13px] text-chalk">No machines on the board.</p>
                      <p className="label mt-1.5">nothing is out on rent right now</p>
                    </td>
                  </tr>
                )}
                {rows.map((a) => {
                  const hot = a.status === "OVERDUE" || a.status === "UNASSIGNED"
                  return (
                    <tr
                      key={a.equipment_id}
                      className={cn(
                        "border-b border-hairline/60 transition-colors last:border-0 hover:bg-raised",
                        hot && "bg-critical/[0.045]",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/asset/${a.equipment_id}`}
                          className="num text-[13px] font-semibold text-chalk hover:text-hazard"
                        >
                          {a.equipment_id}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-steel whitespace-nowrap">{a.type}</td>
                      <td className="px-4 py-2.5"><StatusPill status={a.status} /></td>
                      <td className="num px-4 py-2.5 text-[12.5px] whitespace-nowrap">
                        {a.site_id ? (
                          <span className="text-steel">
                            {a.site_id}
                            {a.branch_id && <span className="ml-1.5 text-slate">{a.branch_id}</span>}
                          </span>
                        ) : (
                          <span className="text-critical">NULL</span>
                        )}
                      </td>
                      <td className="num px-4 py-2.5 text-[12.5px] whitespace-nowrap">
                        {a.operator_id ?? <span className="text-critical">NULL</span>}
                      </td>
                      <td className="px-4 py-2.5 min-w-[150px]">
                        <UtilisationBar value={a.utilization_pct} warn={warn} crit={crit} />
                      </td>
                      <td className="num px-4 py-2.5 text-[12.5px] text-steel">{a.idle_hours_day}</td>
                      <td className="num px-4 py-2.5 text-[12.5px] text-steel whitespace-nowrap">
                        {shortDate(a.due_back)}
                      </td>
                      <td className="px-4 py-2.5">
                        {a.flags_count > 0 ? (
                          <span className="inline-flex min-w-[22px] justify-center border border-critical/50 bg-critical/15 px-1.5 py-px font-mono text-[11px] font-semibold text-critical">
                            {a.flags_count}
                          </span>
                        ) : (
                          <span className="label">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-7">
          <AvailabilityAsk config={config} />
          <ValueLedger ledger={ledger} />
        </div>
      </div>

      {/* ------------------------- usage per site -------------------------- */}
      <section className="border border-hairline bg-surface">
        <header className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-3.5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
            Usage per site
          </h2>
          <span className="label">lowest utilisation first — where to redeploy</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline">
                {["site", "branch", "assets", "rented days", "engine h", "idle h", "utilisation", "idle cost"].map(
                  (h) => (
                    <th key={h} scope="col" className="label px-4 py-2.5 font-normal whitespace-nowrap">{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {usage && usage.by_site.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <p className="text-[13px] text-chalk">No site usage yet.</p>
                    <p className="label mt-1.5">usage appears once machines are deployed</p>
                  </td>
                </tr>
              )}
              {usage?.by_site.map((s) => (
                <tr
                  key={s.site_id}
                  className={cn(
                    "border-b border-hairline/60 last:border-0",
                    s.site_id === "UNASSIGNED" && "bg-critical/[0.05]",
                  )}
                >
                  <td className={cn("num px-4 py-2.5 text-[13px] font-medium",
                    s.site_id === "UNASSIGNED" ? "text-critical" : "text-chalk")}>
                    {s.site_id}
                  </td>
                  <td className="num px-4 py-2.5 text-[12.5px] text-slate">{s.branch_id ?? "—"}</td>
                  <td className="num px-4 py-2.5 text-[12.5px] text-steel">{s.assets}</td>
                  <td className="num px-4 py-2.5 text-[12.5px] text-steel">{s.rented_days}</td>
                  <td className="num px-4 py-2.5 text-[12.5px] text-steel">{s.engine_hours}</td>
                  <td className="num px-4 py-2.5 text-[12.5px] text-steel">{s.idle_hours}</td>
                  <td className="px-4 py-2.5 min-w-[150px]">
                    <UtilisationBar value={s.utilisation_pct} warn={warn} crit={crit} />
                  </td>
                  <td className="num px-4 py-2.5 text-[12.5px] text-hazard">{inr(s.idle_cost_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
