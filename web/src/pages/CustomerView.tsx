import { useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AssetRow, Config } from "@/lib/types"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import { useResilientQuery } from "@/lib/useResilientQuery"
import { cn, inr } from "@/lib/utils"
import MachineSilhouette from "@/components/MachineSilhouette"
import Explain from "@/components/Explain"
import HireDetail from "@/components/HireDetail"
import SOSBanner from "@/components/SOSBanner"

/**
 * What the customer sees.
 *
 * The same data as the dealer's board and a completely different screen, on purpose.
 *
 *  1. SCOPE. A customer sees the machines at THEIR site and nothing else. The fleet
 *     ledger and other sites' figures are not withheld to be coy - showing them would
 *     be showing this customer another customer's numbers.
 *
 *  2. LANGUAGE. Nobody renting an excavator wants to read "R2 fired at 0.35 utilisation
 *     threshold". Every line answers what am I paying, what is coming back when, what is
 *     about to go wrong, and what should I do - in words, with the number beside it.
 *
 *  3. IT ENDS IN A BUTTON. A page that tells a hirer their machine is idling and then
 *     leaves them to find a phone number has not finished the job. Every finding here
 *     resolves into a request the yard actually receives.
 *
 * A returned machine is off hire and its clock stopped when it went back. Days held run
 * to the return date, never to today - billing somebody for a machine they gave back in
 * April is the single worst thing this page could get wrong.
 */

const DAY = 86_400_000
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY)

/** One hire's own arithmetic, used by the cards and the totals alike so they agree. */
function reckon(a: AssetRow, now: string) {
  const back = a.status === "AT_YARD"
  const until = back ? (a.due_back ?? now) : now
  const held = a.on_hire_from ? Math.max(0, daysBetween(a.on_hire_from, until)) : 0
  const left = !back && a.due_back ? daysBetween(now, a.due_back) : null
  const hoursOn = a.engine_hours_day + a.idle_hours_day
  const idleCost = hoursOn > 0 ? Math.round((a.day_rate / hoursOn) * a.idle_hours_day * held) : 0
  return {
    back, held, left, idleCost,
    billed: held * a.day_rate,
    // What the whole hire comes to if it runs to the agreed return date.
    projected: !back && a.on_hire_from && a.due_back
      ? Math.max(0, daysBetween(a.on_hire_from, a.due_back)) * a.day_rate
      : held * a.day_rate,
  }
}

function Hire({
  a, now, config, onRequest, busy,
}: {
  a: AssetRow; now: string; config?: Config
  onRequest: (a: AssetRow, kind: "EXTEND" | "COLLECT") => void
  busy: string | null
}) {
  const [open, setOpen] = useState(false)
  const r = reckon(a, now)
  const warn = (config?.idle_utilisation_warn ?? 0.35) * 100
  const weak = a.utilization_pct < warn

  const tone = r.back
    ? { line: "#6ea8ff", text: "text-info", say: `returned ${a.due_back ?? ""}`.trim() }
    : r.left !== null && r.left < 0
      ? { line: "#ff5b45", text: "text-critical", say: `${-r.left} days past its return date` }
      : r.left !== null && r.left <= 3
        ? { line: "#ffab2e", text: "text-warning", say: r.left === 0 ? "due back today" : `due back in ${r.left} days` }
        : { line: "#3ddc97", text: "text-nominal", say: r.left === null ? "on hire" : `${r.left} days left on hire` }

  return (
    <article className="flex min-w-0 flex-col border border-hairline bg-surface">
      <div className="flex items-start gap-4 border-b border-hairline px-5 py-4">
        <div className="w-[86px] shrink-0">
          <MachineSilhouette type={a.type} tone={tone.line} className="h-auto w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="num text-[18px] font-semibold leading-none text-chalk">{a.equipment_id}</p>
          <p className="mt-1.5 text-[13.5px] text-steel">{a.type}</p>
          <p className={cn("mt-2 text-[13px] font-medium", tone.text)}>{tone.say}</p>
        </div>
        <span className="label shrink-0">grade {a.condition_grade}<Explain what="grade" /></span>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-hairline">
        <div className="bg-surface px-5 py-3">
          <dt className="label">on hire since</dt>
          <dd className="num mt-1 text-[14px] text-chalk">{a.on_hire_from ?? "—"}</dd>
        </div>
        <div className="bg-surface px-5 py-3">
          <dt className="label">{r.back ? "returned" : "due back"}</dt>
          <dd className="num mt-1 text-[14px] text-chalk">{a.due_back ?? "—"}</dd>
        </div>
        <div className="bg-surface px-5 py-3">
          <dt className="label">working / idle each day<Explain what="idle" /></dt>
          <dd className="num mt-1 text-[14px] text-chalk">
            {a.engine_hours_day}h <span className="text-slate">/</span>{" "}
            <span className={weak ? "text-warning" : "text-chalk"}>{a.idle_hours_day}h</span>
          </dd>
        </div>
        <div className="bg-surface px-5 py-3">
          <dt className="label">{r.back ? "this hire cost" : "billed so far"}</dt>
          <dd className="num mt-1 text-[14px] text-chalk">{inr(r.billed)}</dd>
        </div>
      </dl>

      {r.idleCost > 0 && (
        <p className={cn("border-t border-hairline px-5 py-3 text-[12.5px] leading-relaxed",
          weak ? "text-warning" : "text-steel")}>
          {r.back
            ? `Over its ${r.held}-day hire it idled ${a.idle_hours_day}h a day — about `
            : `Idling ${a.idle_hours_day}h a day for ${r.held} days — about `}
          <span className="num font-semibold">{inr(r.idleCost)}</span> of hire paid for
          hours it was switched on and producing nothing.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3">
        {!r.back && (
          <>
            <button
              onClick={() => onRequest(a, "EXTEND")}
              disabled={busy !== null}
              className="border border-hairline-bright px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-chalk transition-colors hover:border-hazard hover:text-hazard disabled:opacity-40"
            >
              {busy === `${a.equipment_id}:EXTEND` ? "…" : "keep it longer"}
            </button>
            <button
              onClick={() => onRequest(a, "COLLECT")}
              disabled={busy !== null}
              className="border border-hairline-bright px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-chalk transition-colors hover:border-hazard hover:text-hazard disabled:opacity-40"
            >
              {busy === `${a.equipment_id}:COLLECT` ? "…" : "come and collect it"}
            </button>
          </>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.12em] text-steel hover:text-hazard"
        >
          {open ? "hide the detail" : "hours & history"}
        </button>
      </div>

      {open && <HireDetail id={a.equipment_id} rate={a.day_rate} />}
    </article>
  )
}

/**
 * Where the machines are, in plan. Deliberately not the dealer's globe: a hirer wants
 * "which corner of my site is it in", and a spinning earth answers another question.
 */
function SitePlot({ machines }: { machines: AssetRow[] }) {
  const pts = machines.filter((m) => m.latitude != null && m.longitude != null)
  if (pts.length === 0) return null

  const lats = pts.map((p) => p.latitude as number)
  const lons = pts.map((p) => p.longitude as number)
  const pad = 0.004
  const [y0, y1] = [Math.min(...lats) - pad, Math.max(...lats) + pad]
  const [x0, x1] = [Math.min(...lons) - pad, Math.max(...lons) + pad]
  const X = (lon: number) => ((lon - x0) / (x1 - x0 || 1)) * 100
  const Y = (lat: number) => (1 - (lat - y0) / (y1 - y0 || 1)) * 100

  return (
    <div className="blueprint relative m-4 h-[260px] border border-hairline bg-ground">
      {pts.map((m) => (
        <div key={m.equipment_id}
             className="absolute -translate-x-1/2 -translate-y-1/2"
             style={{ left: `${X(m.longitude as number)}%`, top: `${Y(m.latitude as number)}%` }}>
          <span className="mx-auto block h-2.5 w-2.5 rounded-full bg-hazard" />
          <span className="mt-1.5 block whitespace-nowrap border border-hairline-bright bg-surface px-1.5 py-0.5">
            <span className="num text-[10.5px] text-chalk">{m.equipment_id}</span>
          </span>
        </div>
      ))}
      <p className="label absolute bottom-2 left-3">
        last seen {pts[0].last_fix?.replace("T", " ").slice(0, 16) ?? "—"}
      </p>
    </div>
  )
}

export default function CustomerView() {
  const session = useSession()
  const site = session?.site_id ?? null
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [selectedEqId, setSelectedEqId] = useState("")
  const [hireDays, setHireDays] = useState(14)
  const [hireNote, setHireNote] = useState("")
  const inFlight = useRef(false)

  const { data: assets, isLoading, error, retry } = useResilientQuery(["assets"], api.assets)
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config, refetchInterval: false })
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: false })
  const { data: risk } = useQuery({ queryKey: ["maintenance"], queryFn: api.maintenance })
  const { data: raised } = useQuery({
    queryKey: ["hire-requests", site],
    queryFn: () => api.hireRequests(site ?? undefined),
    enabled: !!site,
  })

  const now = health?.now ?? ""
  const mine = useMemo(() => (assets ?? []).filter((a) => a.site_id === site), [assets, site])
  const live = useMemo(() => mine.filter((a) => a.status !== "AT_YARD"), [mine])
  const returned = useMemo(() => mine.filter((a) => a.status === "AT_YARD"), [mine])
  const availableAssets = useMemo(() => (assets ?? []).filter((a) => a.status === "AT_YARD" || !a.site_id), [assets])

  async function handleRequestNewHire(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedEqId || inFlight.current) return
    inFlight.current = true
    setBusy(`NEW:${selectedEqId}`)
    setSaid(null)
    try {
      await api.raiseHireRequest({
        equipment_id: selectedEqId,
        kind: "NEW_HIRE",
        actor: session?.actor ?? "a customer",
        site_id: site ?? undefined,
        days: hireDays,
        note: hireNote || "New machine hire request",
      })
      setSaid(`Requested ${selectedEqId} for site ${site ?? "S001"}. Sent to the Yard Supervisor in real time.`)
      setShowNewModal(false)
      setSelectedEqId("")
      setHireNote("")
      await qc.invalidateQueries({ queryKey: ["hire-requests", site] })
    } catch (err) {
      setSaid(err instanceof Error ? `Request failed: ${err.message}` : "Request failed.")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  const sum = useMemo(() => {
    const hoursOn = live.reduce((n, a) => n + a.engine_hours_day + a.idle_hours_day, 0)
    const engine = live.reduce((n, a) => n + a.engine_hours_day, 0)
    const each = mine.map((a) => reckon(a, now))
    return {
      working: hoursOn > 0 ? Math.round((engine / hoursOn) * 1000) / 10 : 0,
      dayCost: live.reduce((n, a) => n + a.day_rate, 0),
      billed: each.reduce((n, r) => n + r.billed, 0),
      projected: each.reduce((n, r) => n + r.projected, 0),
      idle: each.reduce((n, r) => n + r.idleCost, 0),
      late: live.filter((a) => { const l = reckon(a, now).left; return l !== null && l < 0 }),
      soon: live.filter((a) => { const l = reckon(a, now).left; return l !== null && l >= 0 && l <= 3 }),
    }
  }, [mine, live, now])

  const theirRisk = (risk ?? []).filter((m) => mine.some((a) => a.equipment_id === m.equipment_id))

  /** What we would do, in order, in the customer's own words. */
  const todo = useMemo(() => {
    const out: { say: string; why: string; tone: string }[] = []
    for (const m of theirRisk) {
      out.push({
        tone: "text-critical",
        say: `Plan around ${m.equipment_id} — it needs to be swapped`,
        why: `It is running at ${m.current_temp_c}°C and rising ${m.slope}°C a day. That is about ${m.days_to_failure} working days before it would stop on site.`,
      })
    }
    for (const a of sum.late) {
      out.push({
        tone: "text-critical",
        say: `Return ${a.equipment_id}, or ask us to extend it`,
        why: `It is ${-reckon(a, now).left!} days past the agreed date and still being billed at ${inr(a.day_rate)} a day.`,
      })
    }
    const worst = [...live].sort((x, y) => x.utilization_pct - y.utilization_pct)[0]
    if (worst && worst.utilization_pct < (config?.idle_utilisation_warn ?? 0.35) * 100) {
      out.push({
        tone: "text-warning",
        say: `Send ${worst.equipment_id} back early, or move it to a busier face`,
        why: `It works ${worst.engine_hours_day}h and idles ${worst.idle_hours_day}h a day. That idle time has already cost about ${inr(reckon(worst, now).idleCost)}.`,
      })
    }
    for (const a of sum.soon) {
      out.push({
        tone: "text-warning",
        say: `Decide on ${a.equipment_id} — it is due back in ${reckon(a, now).left} days`,
        why: "Tell us now if you need it longer and it stays where it is; otherwise we will come and collect it.",
      })
    }
    if (out.length === 0 && live.length > 0) {
      out.push({
        tone: "text-nominal",
        say: "Nothing needs you today",
        why: "Everything on hire is inside its dates, working well, and showing no fault.",
      })
    }
    return out
  }, [theirRisk, sum, live, now, config])

  async function request(a: AssetRow, kind: "EXTEND" | "COLLECT") {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(`${a.equipment_id}:${kind}`)
    setSaid(null)
    try {
      await api.raiseHireRequest({
        equipment_id: a.equipment_id, kind, actor: session?.actor ?? "a customer",
        site_id: site ?? undefined, days: kind === "EXTEND" ? 14 : undefined,
        note: kind === "EXTEND" ? "Requested from the hire page" : "Ready for collection",
      })
      setSaid(kind === "EXTEND"
        ? `Asked to keep ${a.equipment_id} longer. The yard has it and will confirm the new date.`
        : `Asked for ${a.equipment_id} to be collected. The yard has it and will arrange the pick-up.`)
      await qc.invalidateQueries({ queryKey: ["hire-requests", site] })
    } catch (err) {
      setSaid(err instanceof Error ? `That did not go through: ${err.message}` : "That did not go through.")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  if (error) {
    return (
      <section className="border border-critical/40 bg-critical/[0.06] px-6 py-10 text-center">
        <p className="text-[15px] text-critical">We could not reach the rental system.</p>
        <button onClick={retry}
                className="mt-4 border border-critical px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-critical hover:bg-critical hover:text-ground">
          Try again
        </button>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border border-hairline bg-surface px-6 py-6">
        <div>
          <p className="label">your hire · site {site}</p>
          <h1 className="mt-2.5 text-[26px] font-bold tracking-tight text-chalk">
            {isLoading ? "Loading your machines…"
              : live.length === 0 ? "You have nothing on hire right now."
                : `You have ${live.length} machine${live.length > 1 ? "s" : ""} on hire.`}
          </h1>
          {live.length > 0 && (
            <p className="mt-2.5 max-w-[70ch] text-[14px] leading-relaxed text-steel">
              They are working {sum.working}% of the hours they are switched on
              <Explain what="working" />, at <span className="num">{inr(sum.dayCost)}</span> a
              day in total.
            </p>
          )}
        </div>
        <button
          onClick={() => setShowNewModal((v) => !v)}
          className="border border-hazard bg-hazard px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ground transition-colors hover:bg-hazard/90"
        >
          {showNewModal ? "Cancel" : "+ Book New Machine"}
        </button>
      </header>

      {/* Prominent SOS Warning Banner in Middle of Customer Dashboard */}
      <SOSBanner />

      {showNewModal && (
        <section className="border border-hazard/50 bg-hazard/[0.06] px-6 py-5">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.16em] text-hazard font-bold">
            Book / Request New Machine for Site {site ?? "S001"}
          </h2>
          <form onSubmit={handleRequestNewHire} className="mt-4 flex flex-col gap-4 max-w-xl">
            <div>
              <label className="label block mb-1">Select Machine from Yard</label>
              <select
                value={selectedEqId}
                onChange={(e) => setSelectedEqId(e.target.value)}
                required
                className="w-full border border-hairline bg-ground px-3 py-2 text-[13.5px] text-chalk font-mono focus:border-hazard focus:outline-none"
              >
                <option value="">-- Choose an available machine --</option>
                {availableAssets.map((a) => (
                  <option key={a.equipment_id} value={a.equipment_id}>
                    {a.equipment_id} — {a.type} (Grade {a.condition_grade}, {inr(a.day_rate)}/day)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label block mb-1">Duration (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={hireDays}
                  onChange={(e) => setHireDays(parseInt(e.target.value) || 14)}
                  className="w-full border border-hairline bg-ground px-3 py-2 text-[13.5px] text-chalk font-mono focus:border-hazard focus:outline-none"
                />
              </div>
              <div>
                <label className="label block mb-1">Target Site</label>
                <input
                  type="text"
                  readOnly
                  value={site ?? "S001"}
                  className="w-full border border-hairline bg-surface px-3 py-2 text-[13.5px] text-steel font-mono opacity-80"
                />
              </div>
            </div>
            <div>
              <label className="label block mb-1">Requirements / Note for Yard Supervisor</label>
              <input
                type="text"
                placeholder="e.g. Foundation excavation phase starting Monday"
                value={hireNote}
                onChange={(e) => setHireNote(e.target.value)}
                className="w-full border border-hairline bg-ground px-3 py-2 text-[13.5px] text-chalk focus:border-hazard focus:outline-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!selectedEqId || busy !== null}
                className="border border-hazard bg-hazard px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ground disabled:opacity-40"
              >
                {busy ? "Submitting..." : "Send Request to Yard"}
              </button>
            </div>
          </form>
        </section>
      )}


      {sum.billed > 0 && (
        <section className="grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
          <div className="bg-surface px-6 py-5">
            <p className="label">billed so far</p>
            <p className="num mt-2 text-[28px] font-semibold leading-none text-chalk">{inr(sum.billed)}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-slate">
              every hire at this site, each counted only for the days it was actually out
            </p>
          </div>
          <div className="bg-surface px-6 py-5">
            <p className="label">if everything runs to its return date</p>
            <p className="num mt-2 text-[28px] font-semibold leading-none text-chalk">{inr(sum.projected)}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-slate">
              at today's rates, with nothing extended
            </p>
          </div>
          <div className="bg-surface px-6 py-5">
            <p className="label">of that, paid for idle time<Explain what="idle" /></p>
            <p className="num mt-2 text-[28px] font-semibold leading-none text-hazard">{inr(sum.idle)}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-slate">
              {sum.billed > 0 ? `${Math.round((sum.idle / sum.billed) * 100)}% of what you have paid` : ""}
            </p>
          </div>
        </section>
      )}

      {todo.length > 0 && (
        <section className="border border-hairline bg-surface">
          <header className="border-b border-hairline px-5 py-3.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
              What we would do, in this order
            </h2>
          </header>
          <ol className="flex flex-col">
            {todo.map((t, i) => (
              <li key={i} className="flex gap-4 border-b border-hairline/60 px-5 py-4 last:border-0">
                <span className="num mt-[2px] shrink-0 text-[11px] text-hazard">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-[14px] font-medium", t.tone)}>{t.say}</p>
                  <p className="mt-1 max-w-[74ch] text-[13px] leading-relaxed text-steel">{t.why}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {said && (
        <p className="border border-nominal/40 bg-nominal/10 px-5 py-3 text-[13px] text-nominal">{said}</p>
      )}

      {raised?.some((r) => r.status === "DECLINED" || r.status === "ACCEPTED") && (
        <div className="flex flex-col gap-2">
          {raised.filter((r) => r.status === "DECLINED").map((r) => (
            <div key={r.request_id} className="border border-critical/50 bg-critical/10 px-5 py-3.5 text-[13px] text-critical flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-[13.5px]">✖ Hire Request Notification: Request Rejected</p>
                <p className="mt-1 text-[12.5px] text-critical/90">
                  Your request for machine <span className="num font-bold">{r.equipment_id}</span> for Site {r.site_id ?? site ?? "S001"} was <strong>REJECTED</strong> by the Yard Supervisor.
                  {r.rejection_reason && <span className="block mt-1 font-mono text-[12px] text-chalk">— Reason: {r.rejection_reason}</span>}
                </p>
              </div>
              <span className="font-mono text-[10.5px] uppercase opacity-80 shrink-0">{r.request_id}</span>
            </div>
          ))}
          {raised.filter((r) => r.status === "ACCEPTED").map((r) => (
            <div key={r.request_id} className="border border-nominal/50 bg-nominal/10 px-5 py-3.5 text-[13px] text-nominal flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-[13.5px]">✓ Hire Request Notification: Request Approved & Dispatched</p>
                <p className="mt-1 text-[12.5px] text-nominal/90">
                  Your hire request for machine <span className="num font-bold">{r.equipment_id}</span> has been <strong>ACCEPTED</strong> and assigned to your site.
                </p>
              </div>
              <span className="font-mono text-[10.5px] uppercase opacity-80 shrink-0">{r.request_id}</span>
            </div>
          ))}
        </div>
      )}

      {(raised?.length ?? 0) > 0 && (
        <section className="border border-hairline bg-surface px-5 py-4">
          <p className="label">what you have asked us for · request history & notifications</p>
          <ul className="mt-2.5 flex flex-col gap-2">
            {raised!.map((r) => (
              <li key={r.request_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline/40 py-2.5 last:border-0 text-[13px] text-steel">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="num font-semibold text-chalk">{r.equipment_id}</span>
                  <span className="font-mono text-[11px] text-steel">
                    {r.kind === "EXTEND" ? "keep it longer" : r.kind === "NEW_HIRE" ? "request new machine" : "collect it"}
                  </span>
                  {r.note && <span className="text-[12px] text-slate">— {r.note}</span>}
                  <span className="num text-[11.5px] text-slate">{r.raised_at.replace("T", " ")}</span>
                </div>
                <div className="flex items-center gap-2">
                  {r.status === "ACCEPTED" ? (
                    <span className="border border-nominal/60 bg-nominal/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider font-semibold text-nominal">
                      ✓ ACCEPTED & ASSIGNED
                    </span>
                  ) : r.status === "DECLINED" ? (
                    <div className="flex items-center gap-2">
                      <span className="border border-critical/60 bg-critical/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider font-semibold text-critical">
                        ✖ REJECTED
                      </span>
                      {r.rejection_reason && (
                        <span className="text-[12px] text-critical font-medium">
                          ({r.rejection_reason})
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="border border-warning/60 bg-warning/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider font-semibold text-warning">
                      ⏳ PENDING YARD APPROVAL
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {theirRisk.length > 0 && (
        <section className="border border-critical/40 bg-critical/[0.06] px-6 py-5">
          <p className="label">we are getting ahead of a problem</p>
          {theirRisk.map((m) => (
            <p key={m.equipment_id} className="mt-2 max-w-[74ch] text-[13.5px] leading-relaxed text-chalk">
              <span className="num font-semibold">{m.equipment_id}</span> is running hot —
              its coolant is at {m.current_temp_c}°C and rising {m.slope}°C a day. On
              current use it has about{" "}
              <span className="num font-semibold text-critical">{m.days_to_failure} working days</span>{" "}
              before it would fail on site. We will arrange a swap before that happens;
              the part is the {m.part.toLowerCase()}.
            </p>
          ))}
        </section>
      )}

      {live.some((a) => a.latitude != null) && (
        <section className="border border-hairline bg-surface">
          <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
              Where your machines are
            </h2>
            <span className="label">last reported position</span>
          </header>
          <SitePlot machines={live} />
        </section>
      )}

      {live.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {live.map((a) => (
            <Hire key={a.equipment_id} a={a} now={now} config={config}
                  onRequest={request} busy={busy} />
          ))}
        </div>
      )}

      {returned.length > 0 && (
        <section className="flex flex-col gap-4">
          <p className="label">already returned — closed hires, no longer costing you anything</p>
          <div className="grid gap-4 opacity-70 lg:grid-cols-2">
            {returned.map((a) => (
              <Hire key={a.equipment_id} a={a} now={now} config={config}
                    onRequest={request} busy={busy} />
            ))}
          </div>
        </section>
      )}

      <p className="label leading-relaxed">
        every figure here comes from the machine's own telemetry, not from an invoice —
        clock pinned to <span className="num">{now || "—"}</span>
      </p>
    </div>
  )
}
