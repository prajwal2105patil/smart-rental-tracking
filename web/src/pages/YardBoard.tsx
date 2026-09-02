import { useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AssetRow, Config } from "@/lib/types"
import { api } from "@/lib/api"
import { actor, useSession } from "@/lib/session"
import { useResilientQuery } from "@/lib/useResilientQuery"
import { cn, inr } from "@/lib/utils"
import StatusPill from "@/components/StatusPill"

/**
 * The yard supervisor's board.
 *
 * A supervisor's day is not the dealer's P&L. It is four questions in order:
 * what is standing in my yard ready to go out, what is coming back and when, what is
 * late, and what must not go out again until it has been serviced. This screen is those
 * four questions and nothing else — no exposure ledger, no rate card, no rules engine.
 *
 * Every action here writes to the same append-only log as the scanner, under the name
 * on the session, so a machine's history reads the same whether it was moved from a
 * phone in the yard or from this table.
 */

const DAY = 86_400_000
const GRADE: Record<string, string> = {
  A: "text-nominal", B: "text-info", C: "text-warning",
}

function days(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY)
}

function Row({
  a, now, config, onAct, busy,
}: {
  a: AssetRow; now: string; config?: Config
  onAct: (id: string, kind: "IN" | "OUT") => void; busy: string | null
}) {
  // A machine standing in the yard is back. It carries the return date of the hire
  // it came off, and annotating that as "101 days late" is nonsense on a returned
  // machine - only something still out can be late.
  const atYard = a.status === "AT_YARD"
  const late = !atYard && a.due_back && now ? days(now, a.due_back) : null
  const interval = config?.service_interval_hours ?? 200
  const dueService = a.hours_since_service >= interval

  return (
    <tr className="border-b border-hairline/60 last:border-0">
      <td className="px-4 py-3">
        <Link to={`/asset/${a.equipment_id}`}
              className="num text-[13.5px] font-semibold text-chalk hover:text-hazard">
          {a.equipment_id}
        </Link>
        <p className="mt-0.5 text-[12px] text-slate">{a.type}</p>
      </td>
      <td className="px-4 py-3"><StatusPill status={a.status} /></td>
      <td className="px-4 py-3">
        <span className={cn("num text-[13px] font-semibold", GRADE[a.condition_grade] ?? "text-chalk")}>
          {a.condition_grade}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={cn("num text-[12.5px]", dueService ? "text-warning" : "text-steel")}>
          {a.hours_since_service}h
        </span>
        <span className="text-[11px] text-slate"> / {interval}h</span>
        {dueService && <p className="label mt-0.5 text-warning">service due</p>}
      </td>
      <td className="px-4 py-3">
        <span className="num text-[12.5px] text-chalk">{a.site_id ?? "—"}</span>
        <p className="mt-0.5 text-[11px] text-slate">{a.operator_id ?? "no operator"}</p>
      </td>
      <td className="px-4 py-3">
        <span className={cn("num text-[12.5px]", atYard ? "text-slate" : "text-chalk")}>
          {a.due_back ?? "—"}
        </span>
        {atYard && a.due_back && <p className="label mt-0.5 text-slate">last hire</p>}
        {late !== null && (
          <p className={cn("label mt-0.5", late < 0 ? "text-critical" : late <= 3 ? "text-warning" : "text-slate")}>
            {late < 0 ? `${-late} days late` : late === 0 ? "due today" : `in ${late} days`}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => onAct(a.equipment_id, a.status === "AT_YARD" ? "OUT" : "IN")}
          disabled={busy !== null}
          className={cn(
            "border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors disabled:opacity-40",
            a.status === "AT_YARD"
              ? "border-hairline-bright text-chalk hover:border-hazard hover:text-hazard"
              : "border-nominal/50 text-nominal hover:bg-nominal hover:text-ground",
          )}
        >
          {busy === a.equipment_id ? "…" : a.status === "AT_YARD" ? "check out" : "check in"}
        </button>
      </td>
    </tr>
  )
}

function Group({
  title, note, rows, tone, ...rest
}: {
  title: string; note: string; rows: AssetRow[]; tone?: string
  now: string; config?: Config
  onAct: (id: string, kind: "IN" | "OUT") => void; busy: string | null
}) {
  return (
    <section className="min-w-0 border border-hairline bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <h2 className={cn("font-mono text-[11px] uppercase tracking-[0.16em]", tone ?? "text-steel")}>
          {title}
        </h2>
        <span className="num text-[13px] font-semibold text-chalk">{rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-nominal">{note}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline">
                {["machine", "status", "grade", "since service", "site · operator", "due back", ""]
                  .map((h) => (
                    <th key={h} scope="col" className="label bg-raised px-4 py-2 font-normal">{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => <Row key={a.equipment_id} a={a} {...rest} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function YardBoard() {
  const session = useSession()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const { data: assets, isLoading, error: dead, retry } = useResilientQuery(["assets"], api.assets)
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config, refetchInterval: false })
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: false })
  // What hirers have asked for. This is the other half of the customer page: a request
  // raised there has to land somewhere a person actually works, or it is theatre.
  const { data: requests } = useQuery({ queryKey: ["hire-requests"], queryFn: () => api.hireRequests() })
  const now = health?.now ?? ""

  const groups = useMemo(() => {
    const all = assets ?? []
    const interval = config?.service_interval_hours ?? 200
    // Only a machine that is STILL OUT can be late or coming back. A returned machine
    // keeps the return date it was hired against, so counting on the date alone made
    // every past hire look overdue - 17 "late" against 12 actually on the ground.
    const out = all.filter((a) => a.status !== "AT_YARD")
    const late = out.filter((a) => a.due_back && now && days(now, a.due_back) < 0)
    const lateIds = new Set(late.map((a) => a.equipment_id))
    return {
      yard: all.filter((a) => a.status === "AT_YARD"),
      late,
      soon: out.filter((a) => {
        if (lateIds.has(a.equipment_id) || !a.due_back || !now) return false
        const d = days(now, a.due_back)
        return d >= 0 && d <= 7
      }),
      service: all.filter((a) => a.hours_since_service >= interval),
      out,
    }
  }, [assets, config, now])

  async function act(id: string, kind: "IN" | "OUT") {
    // Ref, not state: a second click lands before React has re-rendered the disabled
    // attribute, and two check-ins write two events.
    if (inFlight.current) return
    inFlight.current = true
    setBusy(id)
    setError(null)
    setNote(null)
    try {
      if (kind === "OUT") {
        await api.checkout(id, actor())
        setNote(`${id} checked out — assign it a site and operator next.`)
      } else {
        const detail = await api.asset(id)
        await api.checkin(id, detail.asset.condition_grade, actor(), "Returned at the yard")
        setNote(`${id} checked in — condition ${detail.asset.condition_grade} recorded.`)
      }
      await qc.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : "that did not go through")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  if (dead) {
    return (
      <section className="border border-critical/40 bg-critical/[0.06] px-6 py-10 text-center">
        <p className="text-[15px] text-critical">The yard board could not reach the system.</p>
        <button onClick={retry}
                className="mt-4 border border-critical px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-critical hover:bg-critical hover:text-ground">
          Try again
        </button>
      </section>
    )
  }

  const shared = { now, config, onAct: act, busy }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border border-hairline bg-surface px-6 py-6">
        <div className="min-w-0">
          <p className="label">yard · {session?.actor}</p>
          <h1 className="mt-2.5 text-[26px] font-bold tracking-tight text-chalk">
            {isLoading ? "Loading the yard…"
              : `${groups.yard.length} ready to go out, ${groups.out.length} on the ground.`}
          </h1>
          <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-steel">
            Everything you check in or out here is written to the machine's history under
            your name. Scanning a printed tag does exactly the same thing.
          </p>
        </div>
        <button
          onClick={() => nav("/scan")}
          className="shrink-0 border border-hazard bg-hazard px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ground"
        >
          Open the scanner
        </button>
      </header>

      {note && (
        <p className="border border-nominal/40 bg-nominal/10 px-5 py-3 text-[13px] text-nominal">{note}</p>
      )}
      {error && (
        <p className="border border-critical/40 bg-critical/10 px-5 py-3 text-[13px] text-critical">{error}</p>
      )}

      <div className="grid gap-px bg-hairline sm:grid-cols-4">
        {([
          { k: "in the yard", v: groups.yard.length, tone: "text-nominal" },
          { k: "past due back", v: groups.late.length, tone: "text-critical" },
          { k: "back within 7 days", v: groups.soon.length, tone: "text-warning" },
          { k: "service due", v: groups.service.length, tone: "text-warning" },
        ]).map((s) => (
          <div key={s.k} className="bg-surface px-5 py-3.5">
            <p className="label">{s.k}</p>
            <p className={cn("num mt-1 text-[22px] font-semibold leading-none",
              s.v === 0 ? "text-steel" : s.tone)}>{s.v}</p>
          </div>
        ))}
      </div>

      {(requests?.length ?? 0) > 0 && (
        <section className="border border-hazard/40 bg-hazard/[0.05]">
          <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hazard/30 px-5 py-3.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-hazard">
              Customers have asked for these
            </h2>
            <span className="num text-[13px] font-semibold text-hazard">{requests!.length}</span>
          </header>
          <ul className="flex flex-col">
            {requests!.map((r) => (
              <li key={r.request_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline/60 px-5 py-3 last:border-0">
                <span className="num text-[13px] font-semibold text-chalk">{r.equipment_id}</span>
                <span className={cn("border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.12em]",
                  r.kind === "COLLECT" ? "border-info/50 text-info" : "border-warning/50 text-warning")}>
                  {r.kind === "COLLECT" ? "collect it" : "extend it"}
                </span>
                <span className="text-[13px] text-steel">{r.actor}</span>
                {r.site_id && <span className="num text-[12px] text-slate">{r.site_id}</span>}
                {r.note && <span className="text-[12.5px] text-slate">— {r.note}</span>}
                <span className="num ml-auto text-[11.5px] text-slate">
                  {r.raised_at.replace("T", " ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Group title="Standing in the yard" tone="text-nominal" rows={groups.yard}
             note="Nothing is standing idle in the yard — everything is out earning."
             {...shared} />

      <Group title="Past their return date" tone="text-critical" rows={groups.late}
             note="Nothing is late." {...shared} />

      <Group title="Coming back this week" tone="text-warning" rows={groups.soon}
             note="Nothing is due back in the next seven days." {...shared} />

      <Group title="Must not go out before service" tone="text-warning" rows={groups.service}
             note="Every machine is inside its service interval." {...shared} />

      <p className="label leading-relaxed">
        condition grades are recorded at check-in and travel with the machine · service
        interval {config?.service_interval_hours ?? 200}h ·{" "}
        {config ? `rates from ${inr(config.day_rates?.Excavator ?? 0)}/day` : ""}
      </p>
    </div>
  )
}
