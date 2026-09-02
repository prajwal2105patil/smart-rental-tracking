import { useEffect } from "react"
import { Link } from "react-router-dom"
import type { Anomaly, AssetRow, Ledger, MaintenanceRisk, UsageSummary } from "@/lib/types"
import { cn, inr } from "@/lib/utils"

/**
 * The report behind a number.
 *
 * Every headline figure on this board is a summary of specific machines and specific
 * rules. A dealer who reads "9 critical" and cannot ask "which nine?" has to trust the
 * number; one who can click it does not have to. So each tile opens the working: the
 * rows that produced it, the threshold that judged them, and a way into each machine.
 *
 * Nothing here is fetched. It reads the same data the tiles were rendered from, so the
 * report can never disagree with the figure that opened it.
 */

export type MetricKey =
  | "critical" | "overdue" | "due_soon" | "service"
  | "machines" | "utilisation" | "downtime" | "exposure"

type Row = { id?: string; k: string; v: string; note?: string; tone?: string }

interface Report {
  title: string
  figure: string
  how: string
  columns: [string, string, string]
  rows: Row[]
  empty?: string
}

function severityTone(s: string) {
  return s === "CRITICAL" ? "text-critical" : s === "WARNING" ? "text-warning" : "text-info"
}

function build(
  key: MetricKey,
  { assets, anomalies, maintenance, usage, ledger }: {
    assets: AssetRow[]; anomalies: Anomaly[]; maintenance: MaintenanceRisk[]
    usage?: UsageSummary; ledger?: Ledger
  },
): Report {
  const byRule = (r: string) => anomalies.filter((a) => a.rule_id === r)
  const sig = (a: Anomaly, field: string) =>
    a.signals.find((s) => s.field === field)?.value ?? "—"

  switch (key) {
    case "critical": {
      const crit = anomalies.filter((a) => a.severity === "CRITICAL")
        .sort((a, b) => b.est_value_inr - a.est_value_inr)
      return {
        title: "Critical flags",
        figure: String(crit.length),
        how: "Every rule firing at CRITICAL severity, worth most first. A machine can appear more than once — different rules, different money.",
        columns: ["machine", "rule", "at stake"],
        rows: crit.map((a) => ({
          id: a.equipment_id, k: a.equipment_id,
          v: inr(a.est_value_inr),
          note: `${a.rule_id} · ${a.title}`,
          tone: "text-critical",
        })),
        empty: "Nothing critical on the board.",
      }
    }

    case "overdue": {
      const late = byRule("R6").sort((a, b) => b.est_value_inr - a.est_value_inr)
      return {
        title: "Past their return date",
        figure: String(late.length),
        how: "R6 fires when the pinned clock is past a machine's check-in date and it is still on rent. Value is days late multiplied by its day rate — money you can still bill, not money lost.",
        columns: ["machine", "days late", "billable"],
        rows: late.map((a) => ({
          id: a.equipment_id, k: a.equipment_id,
          v: inr(a.est_value_inr),
          note: `${sig(a, "days_overdue")} days past ${sig(a, "check_in_date")}`,
          tone: "text-critical",
        })),
        empty: "Nothing is past its return date.",
      }
    }

    case "due_soon": {
      const soon = byRule("R8")
      return {
        title: "Coming back shortly",
        figure: String(soon.length),
        how: "R8 fires inside the reminder window before a machine is due, which is the only stretch where a dealer can still act — chase the customer, or commit it to the next booking. Worth nothing yet, deliberately.",
        columns: ["machine", "due", "days left"],
        rows: soon.map((a) => ({
          id: a.equipment_id, k: a.equipment_id,
          v: `${sig(a, "days_until_return")} days`,
          note: `due back ${sig(a, "check_in_date")} · ${sig(a, "site_id")}`,
          tone: "text-info",
        })),
        empty: "Nothing due back in the reminder window.",
      }
    }

    case "service": {
      const rows: Row[] = [
        ...byRule("R5").map((a) => ({
          id: a.equipment_id, k: a.equipment_id,
          v: `${sig(a, "hours_since_service")} h`,
          note: `past the ${a.signals.find((s) => s.field === "hours_since_service")?.threshold ?? ""} interval`,
          tone: "text-warning",
        })),
        ...maintenance.map((m) => ({
          id: m.equipment_id, k: m.equipment_id,
          v: `${m.days_to_failure.toFixed(2)} days`,
          note: `SPN ${m.spn}/FMI ${m.fmi} · ${m.current_temp_c}°C rising ${m.slope}°C/day · ${m.part}`,
          tone: "text-critical",
        })),
      ]
      return {
        title: "Service risk",
        figure: String(byRule("R5").length),
        how: "Two different signals. R5 is a threshold: hours since last service. The fault code is a trend — a rolling coolant mean and a least-squares slope, extrapolated to the failure temperature. Days to failure are OPERATING days, so the countdown pauses while a machine sits in the yard.",
        columns: ["machine", "detail", "headroom"],
        rows,
        empty: "No machine is showing a service risk.",
      }
    }

    case "machines": {
      const counts = assets.reduce<Record<string, number>>((m, a) => {
        m[a.status] = (m[a.status] ?? 0) + 1
        return m
      }, {})
      return {
        title: "Machines on the board",
        figure: String(assets.length),
        how: "Status is computed from the append-only event log on every read, never stored. Act on a machine and its status changes because the underlying condition changed.",
        columns: ["status", "what it means", "machines"],
        rows: Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([status, n]) => ({
            k: status, v: String(n),
            note: {
              OVERDUE: "on rent, past its return date",
              UNASSIGNED: "on rent, attached to no site",
              IDLE: "on rent, engine producing nothing",
              ACTIVE: "assigned and producing",
              AT_YARD: "back with the dealer, available",
              IN_SERVICE: "off the board for maintenance",
            }[status] ?? "",
            tone: status === "OVERDUE" || status === "UNASSIGNED" ? "text-critical"
              : status === "IDLE" ? "text-warning" : "text-nominal",
          })),
      }
    }

    case "utilisation": {
      const sites = usage?.by_site ?? []
      return {
        title: "Fleet utilisation",
        figure: usage ? `${usage.fleet.utilisation_pct}%` : "—",
        how: "engine hours ÷ (engine hours + idle hours), across every machine. Sites are listed worst first — that is the order to redeploy in.",
        columns: ["site", "machines · idle cost", "utilisation"],
        rows: sites.map((s) => ({
          k: s.site_id, v: `${s.utilisation_pct}%`,
          note: `${s.assets} machines · ${inr(s.idle_cost_inr)} idle cost`,
          tone: s.utilisation_pct < 20 ? "text-critical"
            : s.utilisation_pct < 35 ? "text-warning" : "text-nominal",
        })),
      }
    }

    case "downtime": {
      const worst = [...assets]
        .map((a) => ({ a, idle: a.idle_hours_day }))
        .filter((x) => x.idle > 0)
        .sort((x, y) => y.idle - x.idle)
        .slice(0, 12)
      return {
        title: "Downtime hours",
        figure: usage ? usage.fleet.downtime_hours.toLocaleString("en-IN") : "—",
        how: "Idle hours across the whole fleet: the engine is on and the machine is producing nothing. The customer is billed for those hours either way, which is what makes them the leak.",
        columns: ["machine", "site · utilisation", "idle h/day"],
        rows: worst.map(({ a, idle }) => ({
          id: a.equipment_id, k: a.equipment_id,
          v: `${idle} h`,
          note: `${a.site_id ?? "NO SITE"} · ${a.utilization_pct.toFixed(1)}% utilisation`,
          tone: a.utilization_pct < 20 ? "text-critical" : "text-warning",
        })),
      }
    }

    case "exposure": {
      const e = ledger?.exposure
      const rows: Row[] = []
      if (e) {
        for (const [bucket, label] of [
          ["waste", "already burned"], ["recoverable", "still billable"],
          ["avoided", "downtime avoided"],
        ] as const) {
          for (const [id, v] of Object.entries(e.by_asset[bucket] ?? {})) {
            rows.push({
              id, k: id, v: inr(v), note: label,
              tone: bucket === "waste" ? "text-critical"
                : bucket === "recoverable" ? "text-warning" : "text-nominal",
            })
          }
        }
      }
      return {
        title: "Open exposure",
        figure: e ? inr(e.total_exposure_inr) : "—",
        how: "Three different kinds of money, never blended into one claim: money already spent, money still billable, and downtime not yet incurred. Within each, a machine counts once — several rules can fire on the same rental line.",
        columns: ["machine", "bucket", "amount"],
        rows: rows.sort((a, b) => b.v.length - a.v.length),
      }
    }
  }
}

export default function MetricReport({
  metric, onClose, data,
}: {
  metric: MetricKey | null
  onClose: () => void
  data: {
    assets: AssetRow[]; anomalies: Anomaly[]; maintenance: MaintenanceRisk[]
    usage?: UsageSummary; ledger?: Ledger
  }
}) {
  useEffect(() => {
    if (!metric) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [metric, onClose])

  if (!metric) return null
  const r = build(metric, data)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ground/85 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${r.title} report`}
    >
      <div
        className="w-full max-w-[760px] border border-hairline-bright bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <p className="label">report</p>
            <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-chalk">{r.title}</h2>
          </div>
          <div className="flex items-start gap-4">
            <p className="num text-[30px] font-semibold leading-none text-hazard">{r.figure}</p>
            <button
              onClick={onClose}
              aria-label="Close report"
              className="border border-hairline-bright px-2.5 py-1 font-mono text-[11px] text-steel hover:border-hazard hover:text-hazard"
            >
              ESC
            </button>
          </div>
        </header>

        <p className="border-b border-hairline bg-raised px-6 py-3 text-[12.5px] leading-relaxed text-steel">
          <span className="label mr-2">how it is worked out</span>
          {r.how}
        </p>

        {r.rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13.5px] text-nominal">
            {r.empty ?? "Nothing to report."}
          </p>
        ) : (
          <div className="max-h-[52vh] overflow-y-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-surface-alt">
                <tr className="border-b border-hairline">
                  {r.columns.map((c) => (
                    <th key={c} scope="col" className="label bg-raised px-6 py-2 font-normal">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={`${row.k}-${i}`} className="border-b border-hairline/60 last:border-0">
                    <td className="px-6 py-2.5">
                      {row.id ? (
                        <Link to={`/asset/${row.id}`} onClick={onClose}
                              className="num text-[13px] font-semibold text-chalk hover:text-hazard">
                          {row.k}
                        </Link>
                      ) : (
                        <span className={cn("num text-[13px] font-semibold", row.tone ?? "text-chalk")}>
                          {row.k}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-2.5 text-[12.5px] text-steel">{row.note}</td>
                    <td className={cn("num px-6 py-2.5 text-right text-[13px] font-medium",
                      row.tone ?? "text-chalk")}>
                      {row.v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="border-t border-hairline px-6 py-3 text-[11.5px] text-slate">
          Read from the same data as the tile you clicked, so this report cannot disagree
          with it. Click a machine to open its panel.
        </p>
      </div>
    </div>
  )
}
