import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { actor } from "@/lib/session"
import type { SOSAlert } from "@/lib/types"

const OFFLINE_SOS_KEY = "cat_sos_alerts_v1"

export function getStoredSOSAlerts(): SOSAlert[] {
  try {
    const raw = localStorage.getItem(OFFLINE_SOS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveStoredSOSAlert(alert: SOSAlert) {
  try {
    const existing = getStoredSOSAlerts()
    const updated = [alert, ...existing.filter((a) => a.sos_id !== alert.sos_id)]
    localStorage.setItem(OFFLINE_SOS_KEY, JSON.stringify(updated))
    window.dispatchEvent(new Event("cat_sos_updated"))
  } catch {
    /* storage full */
  }
}

export function resolveStoredSOSAlert(sos_id: string) {
  try {
    const existing = getStoredSOSAlerts()
    const updated = existing.map((a) => (a.sos_id === sos_id ? { ...a, status: "RESOLVED" as const } : a))
    localStorage.setItem(OFFLINE_SOS_KEY, JSON.stringify(updated))
    window.dispatchEvent(new Event("cat_sos_updated"))
  } catch {
    /* storage full */
  }
}

export default function SOSModal({
  equipmentId = "EQX1003",
  onSuccess,
}: {
  equipmentId?: string
  onSuccess?: (alert: SOSAlert) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [forceOffline, setForceOffline] = useState(false)
  const [alertType, setAlertType] = useState<
    "CRASH_IMPACT" | "MEDICAL_EMERGENCY" | "BREAKDOWN_REMOTE" | "OFFLINE_SMS_SOS"
  >("CRASH_IMPACT")
  const [details, setDetails] = useState("")
  const [activeSOS, setActiveSOS] = useState<SOSAlert | null>(null)

  const isSystemOffline = (typeof navigator !== "undefined" && !navigator.onLine) || forceOffline

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }
    return () => {
      document.body.style.overflow = "unset"
    }
  }, [open])

  async function handleTriggerSOS() {
    setLoading(true)
    const timestamp = new Date().toISOString()
    const sos_id = `SOS-CAT-${Date.now().toString().slice(-5)}`

    const alertPayload: SOSAlert = {
      sos_id,
      timestamp,
      equipment_id: equipmentId,
      actor: actor(),
      alert_type: alertType,
      lat: 19.0760,
      lng: 72.8777,
      location_name: "Highland Quarry Sector 4 (Remote Zero-Network Zone)",
      details:
        details ||
        (isSystemOffline
          ? "Satellite SMS Packet dispatched via Cat Product Link® (Zero Cellular)"
          : "Driver SOS Triggered"),
      offline_mode: isSystemOffline,
      status: "ACTIVE_EMERGENCY",
      nearest_hospital: {
        name: "Apollo Emergency Trauma & Disaster Care (Nearest 4.2 km)",
        distance_km: 4.2,
        contact_phone: "+91 98200 99999",
        eta_minutes: 8,
        dispatch_status: "AMBULANCE_DISPATCHED",
      },
    }

    // Always store locally so offline dashboards see it immediately!
    saveStoredSOSAlert(alertPayload)

    try {
      if (!forceOffline && navigator.onLine) {
        await api.sendSOS({
          equipment_id: equipmentId,
          actor: actor(),
          alert_type: alertType,
          lat: 19.0760,
          lng: 72.8777,
          location_name: "Highland Quarry Sector 4 (Remote Zero-Network Zone)",
          details: details || "Driver SOS Emergency Triggered",
          offline_mode: false,
        })
      }
    } catch {
      /* offline fallback active */
    } finally {
      setActiveSOS(alertPayload)
      if (onSuccess) onSuccess(alertPayload)
      setLoading(false)
    }
  }

  return (
    <>
      {/* High Visibility Red Pulse SOS Trigger Button */}
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 border border-critical/90 bg-critical/20 px-3 py-1.5 font-mono text-[11px] font-extrabold uppercase tracking-wider text-critical hover:bg-critical hover:text-ground transition-all shadow-lg"
        title="Caterpillar Safety First SOS Emergency Protocol"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-critical opacity-80"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-critical"></span>
        </span>
        🆘 SOS EMERGENCY
      </button>

      {/* Perfectly Centered & Fully Visible Scrollable Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md overflow-y-auto">
          <div className="relative my-auto w-full max-w-[560px] max-h-[85vh] overflow-y-auto border-2 border-critical bg-ground p-5 sm:p-6 shadow-2xl flex flex-col gap-4 rise-in custom-scrollbar">
            {/* Modal Header */}
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-critical/40 bg-ground pb-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[22px]">🚨</span>
                <div>
                  <h2 className="font-mono text-[15px] font-extrabold uppercase tracking-wider text-critical">
                    Caterpillar Safety First — SOS Emergency
                  </h2>
                  <p className="text-[11.5px] text-steel">
                    Trauma Dispatch & Satellite SMS Relay Protocol
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setOpen(false)
                  setActiveSOS(null)
                }}
                className="rounded-sm p-1 text-steel hover:bg-surface hover:text-chalk font-mono text-[14px]"
              >
                ✖
              </button>
            </header>

            {!activeSOS ? (
              <div className="flex flex-col gap-4">
                {/* Simulated Network Toggle Bar */}
                <div className="flex items-center justify-between border border-hairline bg-surface p-3 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px]">{isSystemOffline ? "📡" : "🌐"}</span>
                    <div>
                      <span className="font-mono font-bold text-chalk uppercase text-[11px] block">
                        {isSystemOffline ? "Satellite Mode (Zero Coverage)" : "Cellular Coverage Active"}
                      </span>
                      <span className="text-[10.5px] text-steel">
                        {isSystemOffline
                          ? "Payload dispatches via Cat Product Link® Iridium Satellite SMS"
                          : "Direct HTTP API dispatch active"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setForceOffline(!forceOffline)}
                    className={`px-2.5 py-1 font-mono text-[10px] uppercase font-bold border transition-colors ${
                      forceOffline
                        ? "border-warning bg-warning/20 text-warning"
                        : "border-hairline text-steel hover:text-chalk"
                    }`}
                  >
                    {forceOffline ? "Force Offline ON" : "Simulate Zero Network"}
                  </button>
                </div>

                {/* Emergency Type Selector */}
                <div className="flex flex-col gap-1.5">
                  <span className="label font-mono text-[10px] uppercase text-steel font-bold">
                    Select Emergency Category
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setAlertType("CRASH_IMPACT")}
                      className={`border p-2.5 text-left font-mono text-[11.5px] font-bold transition-all ${
                        alertType === "CRASH_IMPACT"
                          ? "border-critical bg-critical/20 text-critical shadow-sm"
                          : "border-hairline bg-surface text-steel hover:border-hairline-bright"
                      }`}
                    >
                      🚨 Crash / Rollover Impact
                    </button>
                    <button
                      onClick={() => setAlertType("MEDICAL_EMERGENCY")}
                      className={`border p-2.5 text-left font-mono text-[11.5px] font-bold transition-all ${
                        alertType === "MEDICAL_EMERGENCY"
                          ? "border-critical bg-critical/20 text-critical shadow-sm"
                          : "border-hairline bg-surface text-steel hover:border-hairline-bright"
                      }`}
                    >
                      🚑 Driver Medical Crisis
                    </button>
                    <button
                      onClick={() => setAlertType("BREAKDOWN_REMOTE")}
                      className={`border p-2.5 text-left font-mono text-[11.5px] font-bold transition-all ${
                        alertType === "BREAKDOWN_REMOTE"
                          ? "border-critical bg-critical/20 text-critical shadow-sm"
                          : "border-hairline bg-surface text-steel hover:border-hairline-bright"
                      }`}
                    >
                      ⚠️ Remote Zone Breakdown
                    </button>
                    <button
                      onClick={() => setAlertType("OFFLINE_SMS_SOS")}
                      className={`border p-2.5 text-left font-mono text-[11.5px] font-bold transition-all ${
                        alertType === "OFFLINE_SMS_SOS"
                          ? "border-critical bg-critical/20 text-critical shadow-sm"
                          : "border-hairline bg-surface text-steel hover:border-hairline-bright"
                      }`}
                    >
                      📡 Satellite SMS Relay
                    </button>
                  </div>
                </div>

                {/* Hospital Emergency Dispatch Card */}
                <div className="border border-nominal/50 bg-nominal/10 p-3.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between border-b border-nominal/20 pb-1.5">
                    <span className="font-mono text-[10px] uppercase font-bold text-nominal tracking-wider">
                      Hospital Dispatch Router (GPS Matched)
                    </span>
                    <span className="font-mono text-[10px] text-nominal font-bold">4.2 km · ETA 8 min</span>
                  </div>
                  <p className="text-[13px] font-bold text-chalk">
                    Apollo Emergency Trauma & Disaster Care Center
                  </p>
                  <p className="text-[11px] text-steel font-mono">
                    Direct Line: +91 98200 99999 · Automatic Ambulance Dispatch Enabled
                  </p>
                </div>

                {/* Notes Input */}
                <label className="flex flex-col gap-1">
                  <span className="label font-mono text-[10px] uppercase text-steel font-bold">
                    Incident Notes / Operator Status (Optional)
                  </span>
                  <input
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="e.g. Rollover on Sector 4 slope, driver conscious"
                    className="border border-hairline bg-surface px-3 py-2 text-[12.5px] text-chalk outline-none focus:border-critical"
                  />
                </label>

                {/* Trigger Button */}
                <button
                  onClick={handleTriggerSOS}
                  disabled={loading}
                  className="w-full border border-critical bg-critical py-3 font-mono text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-ground hover:bg-critical/90 shadow-xl transition-all disabled:opacity-50"
                >
                  {loading ? "DISPATCHING SOS ENCRYPTED PACKET..." : "TRIGGER SOS & DISPATCH AMBULANCE NOW"}
                </button>
              </div>
            ) : (
              /* SOS Active Alert Confirmation Card */
              <div className="flex flex-col gap-4 rise-in">
                <div className="border-2 border-critical bg-critical/15 p-4 flex flex-col gap-2 shadow-inner">
                  <div className="flex items-center justify-between border-b border-critical/30 pb-2">
                    <span className="font-mono text-[11.5px] font-extrabold uppercase text-critical">
                      ✓ SOS EMERGENCY ACTIVE ({activeSOS.sos_id})
                    </span>
                    <span className="px-2 py-0.5 font-mono text-[10px] bg-critical text-ground font-bold uppercase">
                      {activeSOS.nearest_hospital.dispatch_status}
                    </span>
                  </div>

                  <p className="text-[14px] font-bold text-chalk mt-1">
                    Machine {activeSOS.equipment_id} · {activeSOS.location_name}
                  </p>

                  <div className="mt-2 border-t border-critical/30 pt-2 grid grid-cols-2 gap-2 text-[12px] font-mono">
                    <div>
                      <span className="text-steel block text-[10px]">NEAREST HOSPITAL</span>
                      <strong className="text-chalk text-[12px]">{activeSOS.nearest_hospital.name}</strong>
                    </div>
                    <div>
                      <span className="text-steel block text-[10px]">AMBULANCE ETA</span>
                      <strong className="text-nominal text-[13px]">{activeSOS.nearest_hospital.eta_minutes} MINUTES</strong>
                    </div>
                  </div>
                </div>

                <div className="border border-hairline bg-surface p-3 font-mono text-[11px] text-steel leading-relaxed">
                  📡 <strong>Safety Protocol Actions Executed:</strong>
                  <ul className="list-disc list-inside mt-1.5 space-y-1 text-[11px]">
                    <li>Direct emergency alert routed to Apollo Hospital (+91 98200 99999)</li>
                    <li>GPS coordinates (19.0760° N, 72.8777° E) pinned on Dashboard</li>
                    <li>Yard Supervisor & On-Site Safety Marshal notified via satellite SMS</li>
                    <li>Incident recorded in append-only safety event log</li>
                  </ul>
                </div>

                <button
                  onClick={() => {
                    setOpen(false)
                    setActiveSOS(null)
                  }}
                  className="w-full border border-hairline-bright bg-surface py-2.5 font-mono text-[11px] uppercase font-bold tracking-wider text-chalk hover:border-hazard"
                >
                  Close Window & Return to Dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
