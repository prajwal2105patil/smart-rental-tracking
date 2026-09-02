import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { SOSAlert } from "@/lib/types"
import { getStoredSOSAlerts, resolveStoredSOSAlert } from "./SOSModal"

export default function SOSBanner() {
  const [offlineAlerts, setOfflineAlerts] = useState<SOSAlert[]>([])

  const { data: onlineAlerts, refetch } = useQuery({
    queryKey: ["sos-alerts"],
    queryFn: () => api.listSOS().catch(() => []),
    refetchInterval: 2000,
  })

  function syncAlerts() {
    const local = getStoredSOSAlerts().filter((a) => a.status === "ACTIVE_EMERGENCY")
    setOfflineAlerts(local)
  }

  useEffect(() => {
    syncAlerts()
    window.addEventListener("cat_sos_updated", syncAlerts)
    window.addEventListener("storage", syncAlerts)
    return () => {
      window.removeEventListener("cat_sos_updated", syncAlerts)
      window.removeEventListener("storage", syncAlerts)
    }
  }, [])

  // Combine online & offline alerts (deduplicating by sos_id)
  const combinedMap = new Map<string, SOSAlert>()
  for (const a of onlineAlerts ?? []) {
    if (a.status === "ACTIVE_EMERGENCY") combinedMap.set(a.sos_id, a)
  }
  for (const a of offlineAlerts) {
    if (a.status === "ACTIVE_EMERGENCY" && !combinedMap.has(a.sos_id)) {
      combinedMap.set(a.sos_id, a)
    }
  }

  const activeAlerts = Array.from(combinedMap.values())

  if (activeAlerts.length === 0) return null

  async function handleResolve(sos_id: string) {
    resolveStoredSOSAlert(sos_id)
    try {
      await api.resolveSOS(sos_id)
    } catch {
      /* offline resolved */
    }
    syncAlerts()
    refetch()
  }

  return (
    <div className="my-4 border-2 border-critical bg-critical/15 p-4 sm:p-5 shadow-2xl flex flex-col gap-3 rise-in">
      <div className="flex items-center justify-between border-b border-critical/40 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-critical opacity-80"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-critical"></span>
          </span>
          <h2 className="font-mono text-[14px] font-extrabold uppercase tracking-wider text-critical">
            🚨 CRITICAL SAFETY SOS INCIDENT REPORTED ({activeAlerts.length} ACTIVE)
          </h2>
        </div>
        <span className="font-mono text-[10px] bg-critical text-ground font-bold px-2 py-0.5 uppercase">
          Caterpillar Safety First Protocol
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {activeAlerts.map((sos) => (
          <div
            key={sos.sos_id}
            className="flex flex-wrap items-center justify-between gap-4 border border-critical/50 bg-ground/90 p-4 shadow-lg"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[16px] font-extrabold text-chalk">{sos.equipment_id}</span>
                <span className="px-2 py-0.5 font-mono text-[10px] font-bold uppercase bg-critical/25 text-critical border border-critical/40">
                  {sos.alert_type}
                </span>
                {sos.offline_mode && (
                  <span className="px-2 py-0.5 font-mono text-[10px] font-bold uppercase bg-warning/25 text-warning border border-warning/40">
                    📡 Satellite SMS Relay (Offline)
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-chalk font-semibold">
                {sos.location_name} — GPS: ({sos.lat}, {sos.lng})
              </p>
              <p className="text-[11.5px] text-steel mt-0.5">
                Details: {sos.details} · Operator: <strong>{sos.actor}</strong>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="border border-nominal/50 bg-nominal/10 px-3.5 py-2 text-right">
                <span className="block font-mono text-[9px] text-nominal font-bold uppercase">HOSPITAL ROUTER</span>
                <span className="font-mono text-[12px] font-bold text-chalk">{sos.nearest_hospital.name}</span>
                <span className="block font-mono text-[10px] text-nominal font-bold">
                  Ambulance ETA: {sos.nearest_hospital.eta_minutes} MIN
                </span>
              </div>
              <button
                onClick={() => handleResolve(sos.sos_id)}
                className="border border-nominal bg-nominal px-4 py-2 font-mono text-[11px] font-bold uppercase text-ground hover:opacity-90 transition-opacity"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
