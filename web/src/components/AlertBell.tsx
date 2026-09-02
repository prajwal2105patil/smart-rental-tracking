import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import type { Alert, HireRequestRow } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useSession } from "@/lib/session"

export interface NotificationItem {
  id: string
  title: string
  message: string
  actor?: string
  severity: "CRITICAL" | "WARNING" | "INFO" | "ACCEPTED"
  timestamp: string
  path: string
  equipment_id?: string
}

export default function AlertBell({
  alerts,
  requests,
}: {
  alerts?: Alert[]
  requests?: HireRequestRow[]
}) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("cat_read_notifications_v3")
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })
  const [freshToast, setFreshToast] = useState<NotificationItem[]>([])
  const seenRef = useRef<Set<string> | null>(null)

  function saveReadIds(newSet: Set<string>) {
    setReadIds(newSet)
    try {
      localStorage.setItem("cat_read_notifications_v3", JSON.stringify(Array.from(newSet)))
    } catch {
      // ignore
    }
  }

  // Build real-time notification list
  const items: NotificationItem[] = []

  // 1. Hire Requests Notifications
  if (requests) {
    requests.forEach((r) => {
      const actorName = r.actor || "Customer"

      if (r.status === "OPEN") {
        if (session?.role === "YARD" || session?.role === "OPS_LEAD") {
          items.push({
            id: `req-open-${r.request_id}`,
            title: `New Hire Request from ${actorName}`,
            message: `${actorName} requested machine ${r.equipment_id} for Site ${r.site_id ?? "S001"}${
              r.note ? ` ("${r.note}")` : ""
            }`,
            actor: actorName,
            severity: "WARNING",
            timestamp: r.raised_at,
            path: "/yard",
            equipment_id: r.equipment_id,
          })
        } else {
          items.push({
            id: `req-open-${r.request_id}`,
            title: `Hire Request Pending Yard Review`,
            message: `Your request for machine ${r.equipment_id} (Site ${r.site_id ?? "S001"}) is being reviewed by the Yard Supervisor`,
            actor: actorName,
            severity: "INFO",
            timestamp: r.raised_at,
            path: "/my-fleet",
            equipment_id: r.equipment_id,
          })
        }
      } else if (r.status === "ACCEPTED") {
        items.push({
          id: `req-acc-${r.request_id}`,
          title: `✓ Request Approved & Assigned`,
          message: `Yard Supervisor APPROVED request for ${r.equipment_id} — Assigned to Site ${r.site_id ?? "S001"}`,
          actor: r.actor,
          severity: "ACCEPTED",
          timestamp: r.raised_at,
          path: session?.role === "YARD" ? "/yard" : "/my-fleet",
          equipment_id: r.equipment_id,
        })
      } else if (r.status === "DECLINED") {
        items.push({
          id: `req-dec-${r.request_id}`,
          title: `✖ Request Rejected`,
          message: `Yard Supervisor REJECTED request for ${r.equipment_id} — Reason: ${
            r.rejection_reason || "Equipment unavailable"
          }`,
          actor: r.actor,
          severity: "CRITICAL",
          timestamp: r.raised_at,
          path: session?.role === "YARD" ? "/yard" : "/my-fleet",
          equipment_id: r.equipment_id,
        })
      }
    })
  }

  // 2. Telemetry Rule Flags
  if (alerts && (session?.role === "YARD" || session?.role === "OPS_LEAD" || session?.role === "OPERATOR")) {
    alerts.forEach((a) => {
      items.push({
        id: `alert-${a.equipment_id}-${a.rule_id}`,
        title: `Telemetry Alert: ${a.rule_id}`,
        message: `${a.equipment_id} — ${a.title}`,
        severity: a.severity === "CRITICAL" ? "CRITICAL" : "WARNING",
        timestamp: new Date().toISOString(),
        path: `/asset/${a.equipment_id}`,
        equipment_id: a.equipment_id,
      })
    })
  }

  // Filter out read/dismissed items
  const unread = items.filter((item) => !readIds.has(item.id))

  // Real-time floating toast popup: automatically disappears after 5 seconds
  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(unread.map((i) => i.id))
      return
    }
    const newlyArrived = unread.filter((i) => !seenRef.current!.has(i.id))
    if (newlyArrived.length > 0) {
      newlyArrived.forEach((i) => seenRef.current!.add(i.id))
      setFreshToast(newlyArrived)
      const timer = setTimeout(() => {
        setFreshToast([])
      }, 5000) // Exactly 5 seconds auto-dismiss
      return () => clearTimeout(timer)
    }
  }, [unread])

  function markAsRead(id: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation()
    const next = new Set(readIds)
    next.add(id)
    saveReadIds(next)
  }

  function clearAll() {
    const next = new Set(readIds)
    items.forEach((i) => next.add(i.id))
    saveReadIds(next)
  }

  const criticalCount = unread.filter((i) => i.severity === "CRITICAL").length

  return (
    <>
      {/* Floating Screen Toast Popup — Auto-disappears in 5 seconds */}
      {freshToast.length > 0 && (
        <div className="fixed right-5 top-16 z-50 flex max-w-[360px] flex-col gap-2" role="status">
          {freshToast.slice(0, 3).map((item) => (
            <div
              key={item.id}
              className="rise-in border border-hazard bg-ground p-4 shadow-xl flex flex-col gap-1 cursor-pointer hover:border-chalk"
              onClick={() => {
                markAsRead(item.id)
                setFreshToast((prev) => prev.filter((t) => t.id !== item.id))
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase font-bold tracking-wider",
                    item.severity === "CRITICAL"
                      ? "text-critical"
                      : item.severity === "ACCEPTED"
                      ? "text-nominal"
                      : "text-warning"
                  )}
                >
                  {item.title}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    markAsRead(item.id)
                    setFreshToast((prev) => prev.filter((t) => t.id !== item.id))
                  }}
                  className="text-steel hover:text-chalk text-[11px] font-mono p-1"
                >
                  ✖
                </button>
              </div>
              <p className="text-[12.5px] text-chalk font-medium">{item.message}</p>
              <span className="text-[10px] font-mono text-hazard mt-0.5 opacity-80">
                Auto-dismissing in 5s · Click to mark read
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Navbar Notification Bell Icon */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={`${unread.length} notifications`}
          aria-expanded={open}
          className={cn(
            "relative flex items-center gap-2 border px-2.5 py-1.5 transition-colors",
            open ? "border-hazard/60 bg-hazard/10" : "border-hairline-bright hover:border-hazard"
          )}
        >
          <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
            <path
              d="M7 1.5a4 4 0 0 0-4 4v2.6L1.8 10.4h10.4L11 8.1V5.5a4 4 0 0 0-4-4z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
              className={
                criticalCount > 0 ? "text-critical" : unread.length > 0 ? "text-hazard" : "text-steel"
              }
            />
            <path
              d="M5.6 12.2a1.5 1.5 0 0 0 2.8 0"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              className={
                criticalCount > 0 ? "text-critical" : unread.length > 0 ? "text-hazard" : "text-steel"
              }
            />
          </svg>

          <span
            className={cn(
              "font-mono text-[11px] uppercase tracking-wider font-semibold",
              unread.length > 0 ? "text-hazard" : "text-steel"
            )}
          >
            {unread.length}
          </span>

          {unread.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hazard opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-hazard"></span>
            </span>
          )}
        </button>

        {/* Dropdown Panel */}
        {open && (
          <div className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[440px] w-[390px] overflow-y-auto border border-hairline-bright bg-ground shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-ground px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-chalk font-semibold">
                  Notifications
                </span>
                <span className="px-1.5 py-0.5 rounded border border-hazard/40 bg-hazard/10 font-mono text-[10px] text-hazard font-bold">
                  {unread.length} New
                </span>
              </div>
              {unread.length > 0 && (
                <button
                  onClick={clearAll}
                  className="font-mono text-[10.5px] uppercase tracking-wider text-steel underline hover:text-chalk"
                >
                  Clear All
                </button>
              )}
            </header>

            {unread.length === 0 ? (
              <div className="px-4 py-10 text-center flex flex-col items-center gap-2">
                <span className="text-[20px] text-nominal">✓</span>
                <p className="font-mono text-[11px] uppercase tracking-wider text-steel">
                  All caught up — no new notifications
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {unread.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex flex-col border-b border-hairline/60 p-3.5 transition-colors hover:bg-surface cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={item.path}
                        onClick={() => {
                          markAsRead(item.id)
                          setOpen(false)
                        }}
                        className="flex-1 min-w-0"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "border px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold tracking-wider",
                              item.severity === "CRITICAL"
                                ? "border-critical/60 bg-critical/10 text-critical"
                                : item.severity === "ACCEPTED"
                                ? "border-nominal/60 bg-nominal/10 text-nominal"
                                : "border-warning/60 bg-warning/10 text-warning"
                            )}
                          >
                            {item.severity}
                          </span>
                          <span className="font-mono text-[12px] font-bold text-chalk truncate">
                            {item.title}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-steel">
                          {item.message}
                        </p>
                        <span className="mt-1 block font-mono text-[10px] text-slate">
                          {item.timestamp.replace("T", " ").slice(0, 19)}
                        </span>
                      </Link>
                      <button
                        onClick={(e) => markAsRead(item.id, e)}
                        title="Mark as read / Dismiss"
                        className="text-slate hover:text-critical font-mono text-[13px] px-1 py-0.5"
                      >
                        ✖
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
