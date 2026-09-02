import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import type { Alert } from "@/lib/types"
import { cn, inr } from "@/lib/utils"

/**
 * Notifications, without pretending to be push.
 *
 * The brief lists notifications under "can simulate", and device push would be a claim we
 * cannot back — there is no service worker and no subscription. What is real: the alert
 * feed is polled, and anything that appears which was not there on the previous poll
 * raises a badge and a toast. That is a notification an operator would actually act on,
 * and it is honest about being in-app.
 */
const TONE: Record<string, string> = {
  CRITICAL: "text-critical border-critical/50 bg-critical/10",
  WARNING: "text-warning border-warning/50 bg-warning/10",
  INFO: "text-info border-info/50 bg-info/10",
}

export default function AlertBell({ alerts }: { alerts?: Alert[] }) {
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<Alert[]>([])
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!alerts) return
    const key = (a: Alert) => `${a.equipment_id}:${a.rule_id}`
    // The first poll establishes the baseline. Without this every existing flag would
    // toast on load, which is noise, not a notification.
    if (seen.current === null) {
      seen.current = new Set(alerts.map(key))
      return
    }
    const added = alerts.filter((a) => !seen.current!.has(key(a)))
    if (added.length) {
      added.forEach((a) => seen.current!.add(key(a)))
      setFresh(added)
      const t = setTimeout(() => setFresh([]), 6000)
      return () => clearTimeout(t)
    }
  }, [alerts])

  const critical = alerts?.filter((a) => a.severity === "CRITICAL").length ?? 0

  return (
    <>
      {/* toast — only for flags that appeared since the last poll */}
      {fresh.length > 0 && (
        <div className="fixed right-5 top-20 z-50 flex max-w-[340px] flex-col gap-2" role="status">
          {fresh.slice(0, 3).map((a) => (
            <Link key={`${a.equipment_id}-${a.rule_id}`} to={`/asset/${a.equipment_id}`}
                  className="rise-in border border-hairline-bright bg-ground px-4 py-3 shadow-lg">
              <div className="flex items-baseline gap-2.5">
                <span className={cn("font-mono text-[10px] font-semibold tracking-[0.12em]",
                  a.severity === "CRITICAL" ? "text-critical" : "text-warning")}>
                  {a.rule_id}
                </span>
                <span className="num text-[13px] font-semibold text-chalk">{a.equipment_id}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug text-steel">{a.title}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={`${alerts?.length ?? 0} alerts, ${critical} critical`}
          aria-expanded={open}
          className={cn("relative flex items-center gap-2 border px-2.5 py-1.5 transition-colors",
            open ? "border-hazard/60 bg-hazard/10" : "border-hairline-bright hover:border-hazard")}
        >
          <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
            <path d="M7 1.5a4 4 0 0 0-4 4v2.6L1.8 10.4h10.4L11 8.1V5.5a4 4 0 0 0-4-4z"
                  stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
                  className={critical ? "text-critical" : "text-steel"} />
            <path d="M5.6 12.2a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.2"
                  strokeLinecap="round" className={critical ? "text-critical" : "text-steel"} />
          </svg>
          {critical > 0 && (
            <span className="num text-[11px] font-semibold text-critical"
                  style={{ animation: "pulse-mark 2.2s ease-in-out infinite" }}>
              {critical}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[420px] w-[380px] overflow-y-auto border border-hairline-bright bg-ground">
            <header className="sticky top-0 flex items-baseline justify-between gap-3 border-b border-hairline bg-ground px-4 py-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
                Alert feed
              </span>
              <span className="label">{alerts?.length ?? 0} open</span>
            </header>
            {(alerts ?? []).slice(0, 24).map((a) => (
              <Link key={`${a.equipment_id}-${a.rule_id}`} to={`/asset/${a.equipment_id}`}
                    onClick={() => setOpen(false)}
                    className="block border-b border-hairline/60 px-4 py-3 transition-colors last:border-0 hover:bg-surface">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={cn("border px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-[0.12em]",
                    TONE[a.severity])}>
                    {a.source}
                  </span>
                  <span className="num text-[12.5px] font-semibold text-chalk">{a.equipment_id}</span>
                  {a.est_value_inr > 0 && (
                    <span className="num ml-auto text-[12px] text-hazard">{inr(a.est_value_inr)}</span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-steel">{a.title}</p>
              </Link>
            ))}
            {!alerts?.length && (
              <p className="label px-4 py-8 text-center">nothing open — the board is clean</p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
