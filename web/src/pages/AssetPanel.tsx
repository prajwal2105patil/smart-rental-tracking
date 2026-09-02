import { Link, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useResilientQuery } from "@/lib/useResilientQuery"
import { api } from "@/lib/api"
import { inr } from "@/lib/utils"
import StatusPill from "@/components/StatusPill"
import UtilisationBar from "@/components/UtilisationBar"
import SignalList from "@/components/SignalList"
import ActionQueue from "@/components/ActionQueue"
import TempSparkline from "@/components/TempSparkline"

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="label">{k}</p>
      <p className="num mt-1 text-[14px] text-chalk">{v}</p>
    </div>
  )
}

export default function AssetPanel() {
  const { id = "" } = useParams()
  const qc = useQueryClient()
  const { data, isLoading, error, retry } = useResilientQuery(["asset", id], () => api.asset(id))
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config, refetchInterval: false })

  function refreshEverything() {
    qc.invalidateQueries()
  }

  // Branch on `error`, NOT `isError`. A data-less query that is refetching resets its
  // status to 'pending', so isError oscillates every poll and the screen flickers between
  // "loading" and "failed" - measured flipping every 3 seconds. React Query keeps the
  // `error` object populated until a fetch actually succeeds, so it is the stable signal.
  if (error || (!isLoading && !data))
    return (
      <div className="border border-critical/40 bg-critical/[0.07] px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-critical">
          Could not load {id}
        </p>
        <p className="mt-2 max-w-[52ch] text-[14px] text-steel">
          The machine may not exist, or the rental service is unreachable.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={() => retry()}
            className="border border-hazard bg-hazard px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ground"
          >
            Retry
          </button>
          <Link
            to="/fleet"
            className="border border-hairline-bright px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-chalk hover:border-hazard hover:text-hazard"
          >
            Fleet board
          </Link>
        </div>
      </div>
    )
  if (isLoading || !data) return <p className="label py-20 text-center">reading {id}…</p>

  const a = data.asset
  const util =
    a.engine_hours_day + a.idle_hours_day === 0
      ? 0
      : (a.engine_hours_day / (a.engine_hours_day + a.idle_hours_day)) * 100
  const worst = [...data.signals].sort((x, y) => y.est_value_inr - x.est_value_inr)[0]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link to="/fleet" className="label hover:text-chalk">← fleet board</Link>

      <header className="border border-hairline bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-5 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="num text-[28px] font-bold leading-none tracking-tight text-chalk">
                {a.equipment_id}
              </h1>
              <StatusPill status={data.status} />
            </div>
            <p className="mt-2 text-[13.5px] text-steel">
              {a.type} · {a.model}
              <span className="ml-2 num text-slate">{a.serial_number}</span>
            </p>
          </div>
          {worst && (
            <div className="text-right">
              <p className="label">largest single claim</p>
              <p className="num mt-1 text-[24px] font-semibold leading-none text-hazard">
                {inr(worst.est_value_inr)}
              </p>
              <p className="label mt-1">{worst.rule_id}</p>
            </div>
          )}
        </div>
        <div className="border-t border-hairline px-5 py-3">
          <UtilisationBar
            value={util}
            warn={(config?.idle_utilisation_warn ?? 0.35) * 100}
            crit={(config?.idle_utilisation_crit ?? 0.2) * 100}
          />
        </div>
      </header>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="min-w-0">
            <h2 className="label mb-2.5">signals that fired — field, value, threshold</h2>
            <SignalList signals={data.signals} />
          </section>

          {data.telemetry_series.length > 0 && (
            <section className="border border-hairline bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
                  Engine coolant temperature
                </h2>
                {data.maintenance[0] && (
                  <span className="label">
                    rising{" "}
                    <span className="text-critical">
                      {data.maintenance[0].slope.toFixed(3)}°C/day
                    </span>
                  </span>
                )}
              </div>
              <TempSparkline
                points={data.telemetry_series}
                warn={config?.coolant_warn_c ?? 105}
                failure={config?.coolant_failure_c ?? 115}
              />
              {data.maintenance.map((m) => (
                <div key={m.spn} className="mt-4 border-l-2 border-l-critical bg-critical/[0.06] px-4 py-3">
                  <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-critical">
                    SPN {m.spn} / FMI {m.fmi}
                  </p>
                  <p className="mt-1.5 text-[13.5px] text-chalk">{m.label}</p>
                  <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    <div className="flex justify-between gap-3 border-b border-hairline pb-1.5">
                      <dt className="label">part</dt>
                      <dd className="text-[12.5px] text-steel">{m.part}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-hairline pb-1.5">
                      <dt className="label">operating days left</dt>
                      <dd className="num text-[12.5px] text-critical">{m.days_to_failure.toFixed(2)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[12.5px] text-steel">{m.action}</p>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-slate">
                    Days are operating days, not calendar days — this machine is parked, so the
                    countdown is paused. That is why it must not go out on the next job.
                  </p>
                </div>
              ))}
            </section>
          )}

          <section className="border border-hairline bg-surface">
            <header className="border-b border-hairline px-5 py-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
                Event history — who, what, where, when
              </h2>
            </header>
            <ul className="max-h-[420px] overflow-y-auto">
              {data.events.length === 0 && <li className="label px-5 py-6 text-center">no events yet</li>}
              {[...data.events].reverse().map((e) => (
                <li key={e.event_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline/60 px-5 py-2.5 last:border-0">
                  <span className="num text-[11px] text-slate">
                    {new Date(e.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </span>
                  <span className="font-mono text-[10.5px] tracking-[0.12em] text-hazard">{e.event_type}</span>
                  <span className="label">by {e.actor}</span>
                  {e.site_id && <span className="num text-[11.5px] text-steel">{e.site_id}</span>}
                  {e.notes && <span className="min-w-0 flex-1 truncate text-[12px] text-slate">{e.notes}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <ActionQueue detail={data} onDone={refreshEverything} />

          <section className="border border-hairline">
            <header className="border-b border-hairline bg-surface px-4 py-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">Record</h2>
            </header>
            <div className="grid grid-cols-2 gap-px bg-hairline">
              <Field k="site" v={a.site_id ?? <span className="text-critical">NULL</span>} />
              <Field k="operator" v={a.operator_id ?? <span className="text-critical">NULL</span>} />
              <Field k="checked out" v={a.check_out_date ?? "—"} />
              <Field k="due back" v={a.check_in_date ?? "—"} />
              <Field k="engine h/day" v={a.engine_hours_day} />
              <Field k="idle h/day" v={a.idle_hours_day} />
              <Field k="operating days" v={a.operating_days} />
              <Field k="cumulative hours" v={a.cumulative_operating_hours} />
              <Field k="since service" v={`${a.hours_since_service} h`} />
              <Field k="day rate" v={inr(a.day_rate)} />
              <Field k="condition" v={a.condition_grade} />
              <Field k="on rent" v={a.on_rent ? "yes" : "no"} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
