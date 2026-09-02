import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Html5Qrcode } from "html5-qrcode"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import StatusPill from "@/components/StatusPill"
import { actor } from "@/lib/session"

const READER_ID = "qr-reader"

const SAMPLE_TAGS = [
  { id: "EQX1001", name: "Bulldozer", model: "Cat D6T", img: "/qr_codes/EQX1001.png" },
  { id: "EQX1003", name: "Excavator", model: "Cat 320", img: "/qr_codes/EQX1003.png" },
  { id: "EQX1005", name: "Mobile Crane", model: "Cat 50T", img: "/qr_codes/EQX1005.png" },
  { id: "EQX1007", name: "Motor Grader", model: "Cat 140M", img: "/qr_codes/EQX1007.png" },
]

function insecureContext(): string | null {
  if (window.isSecureContext) return null
  if (!("mediaDevices" in navigator)) {
    return `Browsers only allow camera access over HTTPS. This page is on ${window.location.protocol}//${window.location.host}, so the camera cannot be opened at all. Use manual entry or click any Sample QR Tag below — it performs the exact same operation.`
  }
  return null
}

function cameraProblem(err: unknown): string {
  const name = (err as { name?: string })?.name ?? ""
  const text = err instanceof Error ? err.message : String(err ?? "")
  const said = (needle: string) => text.toLowerCase().includes(needle)

  if (name === "NotAllowedError" || name === "SecurityError" || said("permission")) {
    return "Camera permission was refused. Allow it for this site in the browser's address-bar menu, or use the Sample QR tags below."
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || said("no camera")) {
    return "No camera was found on this device. Use manual lookup or the Sample QR tags below."
  }
  if (name === "NotReadableError" || name === "TrackStartError" || said("in use")) {
    return "The camera is already in use by another app. Close it and try again."
  }
  if (name === "OverconstrainedError" || said("constraint")) {
    return "This device has no rear-facing camera. Pick a different lens from the dropdown."
  }
  return text || "The camera could not be started. Use manual lookup or Sample QR tags below."
}

export default function Scan() {
  const nav = useNavigate()
  const queryClient = useQueryClient()
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const inFlight = useRef(false)
  const starting = useRef(false)
  const [scanning, setScanning] = useState(false)
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [torch, setTorch] = useState<boolean | null>(null)
  const [code, setCode] = useState("")
  const [manual, setManual] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(insecureContext())

  // Form options for check in & check out
  const [selectedGrade, setSelectedGrade] = useState("A")
  const [selectedSite, setSelectedSite] = useState("S001")
  const [notes, setNotes] = useState("")
  const [actionMode, setActionMode] = useState<"IN" | "OUT" | null>(null)

  const { data: detail, refetch } = useQuery({
    queryKey: ["asset", code],
    queryFn: () => api.asset(code),
    enabled: code.length > 0,
    retry: false,
  })

  function safeStop() {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      const result = scanner.stop()
      if (result && typeof result.catch === "function") {
        result.then(() => { try { scanner.clear() } catch { /* cleared */ } })
              .catch(() => {})
      }
    } catch {
      /* not running */
    }
  }

  useEffect(() => safeStop, [])

  function preferRear(list: { id: string; label: string }[]) {
    const rear = list.filter((c) => /back|rear|environment/i.test(c.label))
    const usable = rear.find((c) => !/ultra|wide|tele|depth/i.test(c.label)) ?? rear[0]
    return usable?.id ?? list[list.length - 1]?.id ?? null
  }

  async function startCamera(deviceId?: string) {
    const blocked = insecureContext()
    if (blocked) { setError(blocked); return }
    if (starting.current) return
    starting.current = true
    setError(null)

    try {
      safeStop()
      const scanner = new Html5Qrcode(READER_ID)
      scannerRef.current = scanner

      let target = deviceId ?? chosen
      if (!target) {
        const found = await Html5Qrcode.getCameras()
        const list = found.map((c) => ({ id: c.id, label: c.label || c.id }))
        setCameras(list)
        target = preferRear(list)
      }

      await scanner.start(
        target ? { deviceId: { exact: target } } : { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (w: number, h: number) => {
            const edge = Math.max(140, Math.floor(Math.min(w, h) * 0.72))
            return { width: edge, height: edge }
          },
          aspectRatio: 1,
        },
        (decoded) => {
          const scannedId = decoded.trim().toUpperCase()
          setCode(scannedId)
          setMessage(`Scanned QR Code: ${scannedId}`)
          safeStop()
          setScanning(false)
        },
        () => {},
      )

      if (target) setChosen(target)
      setScanning(true)

      try {
        const caps = scanner.getRunningTrackCapabilities() as { torch?: boolean }
        setTorch(caps?.torch ? false : null)
      } catch {
        setTorch(null)
      }
    } catch (err) {
      setError(cameraProblem(err))
      setScanning(false)
    } finally {
      starting.current = false
    }
  }

  async function toggleTorch() {
    const scanner = scannerRef.current
    if (!scanner || torch === null) return
    try {
      await scanner.applyVideoConstraints(
        { advanced: [{ torch: !torch }] } as unknown as MediaTrackConstraints,
      )
      setTorch(!torch)
    } catch {
      setTorch(null)
    }
  }

  async function handleCheckOut() {
    if (!code || inFlight.current) return
    inFlight.current = true
    setBusy("OUT")
    setError(null)
    try {
      await api.checkout(code, actor())
      if (selectedSite) {
        await api.assign(code, selectedSite, "OP201", actor())
      }
      setMessage(`✓ ${code} successfully CHECKED OUT & assigned to Site ${selectedSite}`)
      setActionMode(null)
      await refetch()
      await queryClient.invalidateQueries({ queryKey: ["assets"] })
      await queryClient.invalidateQueries({ queryKey: ["ledger"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-out action failed")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  async function handleCheckIn() {
    if (!code || inFlight.current) return
    inFlight.current = true
    setBusy("IN")
    setError(null)
    try {
      await api.checkin(code, selectedGrade, actor(), notes || "Returned to Yard via QR scan")
      setMessage(`✓ ${code} successfully CHECKED IN to Yard — Condition Grade ${selectedGrade} recorded`)
      setActionMode(null)
      await refetch()
      await queryClient.invalidateQueries({ queryKey: ["assets"] })
      await queryClient.invalidateQueries({ queryKey: ["ledger"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-in action failed")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-6">
      <header>
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-bold tracking-tight text-chalk">Scan Machine Tag</h1>
          <span className="px-2.5 py-1 font-mono text-[10px] uppercase font-bold tracking-wider border border-hazard/40 bg-hazard/10 text-hazard">
            Yard QR Scanner
          </span>
        </div>
        <p className="mt-1.5 text-[14px] text-steel">
          Scan a machine tag using camera, select from Sample Tags, or type the ID for Check-in / Check-out operations.
        </p>
      </header>

      {/* Camera Viewfinder */}
      <div className="relative overflow-hidden border border-hairline bg-surface">
        <div id={READER_ID} className="min-h-[240px] w-full [&_video]:w-full [&_video]:object-cover" />

        {!scanning && (
          <div className="blueprint absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
            <p className="label text-center">camera scanner ready</p>
            <button
              onClick={() => startCamera()}
              className="border border-hazard bg-hazard px-6 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ground transition-opacity hover:opacity-90 shadow-lg"
            >
              Start Camera Scanner
            </button>
          </div>
        )}

        {scanning && (
          <>
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute inset-x-0 h-px bg-hazard/70"
                style={{ animation: "scan-sweep 2.2s ease-in-out infinite" }}
              />
            </div>
            <div className="absolute right-2 top-2 flex gap-2">
              {torch !== null && (
                <button
                  onClick={toggleTorch}
                  aria-pressed={torch}
                  className={cn(
                    "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
                    torch ? "border-hazard bg-hazard text-ground" : "border-hazard/60 bg-ground/70 text-hazard",
                  )}
                >
                  torch
                </button>
              )}
              <button
                onClick={() => { safeStop(); setScanning(false) }}
                className="border border-hairline-bright bg-ground/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-steel"
              >
                stop
              </button>
            </div>
          </>
        )}
      </div>

      {cameras.length > 1 && (
        <label className="flex items-center gap-3">
          <span className="label shrink-0">camera lens</span>
          <select
            value={chosen ?? ""}
            onChange={(e) => { setChosen(e.target.value); startCamera(e.target.value) }}
            className="w-full border border-hairline bg-ground px-3 py-2 font-mono text-[12px] text-chalk outline-none focus:border-hazard"
          >
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}

      {/* Manual Search */}
      <div className="flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder="Enter ID e.g. EQX1003"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="w-full border border-hairline bg-ground px-3.5 py-2.5 font-mono text-[15px] text-chalk outline-none focus:border-hazard placeholder:text-slate"
        />
        <button
          onClick={() => {
            if (manual.trim()) {
              setCode(manual.trim())
              setMessage(`Searching for ${manual.trim()}…`)
            }
          }}
          className="shrink-0 border border-hazard bg-hazard/10 px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-hazard hover:bg-hazard hover:text-ground transition-colors font-semibold"
        >
          Look Up Tag
        </button>
      </div>

      {/* Printable Sample QR Tags Gallery */}
      <section className="border border-hairline bg-surface p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-hairline pb-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-chalk font-semibold">
            Sample Machine QR Tags (Scan or Click to Test)
          </span>
          <span className="font-mono text-[10px] text-steel">Point camera or click tag</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SAMPLE_TAGS.map((tag) => (
            <button
              key={tag.id}
              onClick={() => {
                setCode(tag.id)
                setMessage(`Loaded Sample QR Tag: ${tag.id} (${tag.name})`)
              }}
              className={cn(
                "flex flex-col items-center border p-3 transition-all text-center",
                code === tag.id
                  ? "border-hazard bg-hazard/15 shadow-md scale-[1.02]"
                  : "border-hairline bg-ground hover:border-hairline-bright hover:bg-surface"
              )}
            >
              <img src={tag.img} alt={`QR Code ${tag.id}`} className="h-24 w-24 object-contain bg-white p-1 rounded-sm" />
              <span className="mt-2 font-mono text-[13px] font-bold text-chalk">{tag.id}</span>
              <span className="text-[11px] text-steel">{tag.name}</span>
              <span className="text-[10px] text-slate font-mono">{tag.model}</span>
            </button>
          ))}
        </div>
      </section>

      {error && (
        <p className="border border-critical/40 bg-critical/10 px-4 py-3 text-[12.5px] leading-relaxed text-critical">{error}</p>
      )}
      {message && (
        <p className="border border-nominal/40 bg-nominal/10 px-4 py-3 text-[12.5px] font-semibold text-nominal">{message}</p>
      )}

      {/* Scanned Asset Detail & Actions */}
      {detail && (
        <section className="border border-hairline bg-surface shadow-lg">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4 bg-ground">
            <div>
              <div className="flex items-center gap-2">
                <span className="num text-[22px] font-bold text-chalk">{detail.asset.equipment_id}</span>
                <span className="px-2 py-0.5 font-mono text-[10px] font-bold uppercase bg-surface border border-hairline text-steel">
                  Grade {detail.asset.condition_grade ?? "A"}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-steel font-medium">
                {detail.asset.type} · {detail.asset.model} {detail.asset.site_id ? `· Site ${detail.asset.site_id}` : "· In Yard"}
              </p>
            </div>
            <StatusPill status={detail.status} />
          </header>

          {/* Action Choice Buttons */}
          <div className="grid grid-cols-2 gap-px bg-hairline">
            <button
              onClick={() => setActionMode("OUT")}
              disabled={busy !== null}
              className={cn(
                "bg-surface px-4 py-4 text-[14px] font-bold uppercase font-mono tracking-wider transition-colors",
                actionMode === "OUT"
                  ? "bg-hazard text-ground"
                  : "text-hazard hover:bg-hazard/10 disabled:opacity-40"
              )}
            >
              Check Out (Dispatch)
            </button>
            <button
              onClick={() => setActionMode("IN")}
              disabled={busy !== null}
              className={cn(
                "bg-surface px-4 py-4 text-[14px] font-bold uppercase font-mono tracking-wider transition-colors",
                actionMode === "IN"
                  ? "bg-nominal text-ground"
                  : "text-nominal hover:bg-nominal/10 disabled:opacity-40"
              )}
            >
              Check In (Yard Return)
            </button>
          </div>

          {/* Check-Out Form Panel */}
          {actionMode === "OUT" && (
            <div className="p-5 border-t border-hairline bg-ground flex flex-col gap-4 rise-in">
              <span className="font-mono text-[11px] uppercase font-bold text-hazard tracking-wider">
                ► Execute Check Out for {detail.asset.equipment_id}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="label">Target Site</span>
                  <select
                    value={selectedSite}
                    onChange={(e) => setSelectedSite(e.target.value)}
                    className="border border-hairline bg-surface px-3 py-2 text-[14px] text-chalk font-mono outline-none focus:border-hazard"
                  >
                    <option value="S001">Site S001 (Highland Quarry)</option>
                    <option value="S002">Site S002 (River Basin Phase 4)</option>
                    <option value="S003">Site S003 (Western Bypass)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label">Operator Actioning</span>
                  <input
                    readOnly
                    value={actor()}
                    className="border border-hairline bg-surface px-3 py-2 text-[14px] text-steel font-mono outline-none"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setActionMode(null)}
                  className="px-4 py-2 border border-hairline text-steel hover:text-chalk font-mono text-[11px] uppercase"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCheckOut}
                  disabled={busy !== null}
                  className="px-5 py-2 border border-hazard bg-hazard text-ground font-mono text-[12px] font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "OUT" ? "Processing..." : "Confirm Check Out & Dispatch"}
                </button>
              </div>
            </div>
          )}

          {/* Check-In Form Panel */}
          {actionMode === "IN" && (
            <div className="p-5 border-t border-hairline bg-ground flex flex-col gap-4 rise-in">
              <span className="font-mono text-[11px] uppercase font-bold text-nominal tracking-wider">
                ► Execute Check In for {detail.asset.equipment_id}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="label">Recorded Condition Grade</span>
                  <select
                    value={selectedGrade}
                    onChange={(e) => setSelectedGrade(e.target.value)}
                    className="border border-hairline bg-surface px-3 py-2 text-[14px] text-chalk font-mono outline-none focus:border-nominal"
                  >
                    <option value="A">Grade A — Mint / Fully Operational</option>
                    <option value="B">Grade B — Normal Wear & Tear</option>
                    <option value="C">Grade C — Minor Service Recommended</option>
                    <option value="D">Grade D — Maintenance Hold Required</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label">Yard Return Notes</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Bay 4 - Scanned on arrival"
                    className="border border-hairline bg-surface px-3 py-2 text-[14px] text-chalk outline-none focus:border-nominal"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setActionMode(null)}
                  className="px-4 py-2 border border-hairline text-steel hover:text-chalk font-mono text-[11px] uppercase"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCheckIn}
                  disabled={busy !== null}
                  className="px-5 py-2 border border-nominal bg-nominal text-ground font-mono text-[12px] font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "IN" ? "Processing..." : "Confirm Check In to Yard"}
                </button>
              </div>
            </div>
          )}

          {detail.signals.length > 0 && (
            <p className="border-t border-hairline px-5 py-3 text-[12.5px] text-critical">
              {detail.signals.length} rule{detail.signals.length > 1 ? "s" : ""} firing on this machine.{" "}
              <button
                onClick={() => nav(`/asset/${detail.asset.equipment_id}`)}
                className="underline underline-offset-2 hover:text-hazard"
              >
                Open full telemetry panel
              </button>
            </p>
          )}
        </section>
      )}

      <p className="label leading-relaxed text-center">
        Every QR scan writes an append-only event (`CHECK_IN` or `CHECK_OUT`) to the system ledger — fully traceable.
      </p>
    </div>
  )
}
