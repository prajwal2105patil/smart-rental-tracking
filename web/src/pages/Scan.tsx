import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Html5Qrcode } from "html5-qrcode"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import StatusPill from "@/components/StatusPill"
import { actor } from "@/lib/session"

const READER_ID = "qr-reader"

/**
 * The phone view. Camera reads a printed tag, two taps to check in or out.
 *
 * Manual entry sits directly beside the camera rather than behind a fallback link -
 * venue wifi and camera permissions fail often enough that the demo must not depend
 * on either.
 *
 * Everything below the manual-entry box is about the camera failing in the specific
 * ways a camera fails ON A PHONE, which are not the ways it fails on a laptop. The
 * common one is not a bug at all: a browser refuses getUserMedia outright over plain
 * http, so opening this page at http://192.168.x.x never even reaches a permission
 * prompt. That case is detected before the camera is touched, because "camera
 * unavailable" is a useless thing to read when the actual fix is one flag on the dev
 * server.
 */

/** Detected before starting, so the operator is told the fix rather than the symptom. */
function insecureContext(): string | null {
  if (window.isSecureContext) return null
  if (!("mediaDevices" in navigator)) {
    return `Browsers only allow camera access over HTTPS. This page is on ${window.location.protocol}//${window.location.host}, so the camera cannot be opened at all. Serve it with "npm run dev:phone" and open the https:// address, or use manual entry below — it does exactly the same thing.`
  }
  return null
}

/** The four ways a phone camera actually refuses, each with its own fix. */
function cameraProblem(err: unknown): string {
  const name = (err as { name?: string })?.name ?? ""
  const text = err instanceof Error ? err.message : String(err ?? "")
  const said = (needle: string) => text.toLowerCase().includes(needle)

  if (name === "NotAllowedError" || name === "SecurityError" || said("permission")) {
    return "Camera permission was refused. Allow it for this site in the browser's address-bar menu and press Start again, or use manual entry below."
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || said("no camera")) {
    return "No camera was found on this device. Use manual entry below — it does exactly the same thing."
  }
  if (name === "NotReadableError" || name === "TrackStartError" || said("in use")) {
    return "The camera is already in use by another app or browser tab. Close it and press Start again."
  }
  if (name === "OverconstrainedError" || said("constraint")) {
    return "This device has no rear-facing camera. Pick a different one from the list above."
  }
  return text || "The camera could not be started. Use manual entry below."
}

export default function Scan() {
  const nav = useNavigate()
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const inFlight = useRef(false)
  const starting = useRef(false)
  const [scanning, setScanning] = useState(false)
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [torch, setTorch] = useState<boolean | null>(null)   // null = not supported
  const [code, setCode] = useState("")
  const [manual, setManual] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(insecureContext())

  const { data: detail, refetch } = useQuery({
    queryKey: ["asset", code],
    queryFn: () => api.asset(code),
    enabled: code.length > 0,
    retry: false,
  })

  /**
   * html5-qrcode throws SYNCHRONOUSLY ("Cannot stop, scanner is not running or paused")
   * when stop() is called on a scanner that never started — and a synchronous throw is
   * not caught by .catch(). Unmounting this page after only viewing it therefore crashed
   * the entire React tree, blanking every screen navigated to from here. Always stop
   * through this helper.
   */
  function safeStop() {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      const result = scanner.stop()
      if (result && typeof result.catch === "function") {
        // clear() releases the video element; without it a second start stacks a new
        // <video> on top of the old one and the viewfinder shows a frozen frame.
        result.then(() => { try { scanner.clear() } catch { /* already gone */ } })
              .catch(() => {})
      }
    } catch {
      /* never started — nothing to stop */
    }
  }

  useEffect(() => safeStop, [])

  /** Phones expose several rear lenses; the ultra-wide cannot focus on a tag held close. */
  function preferRear(list: { id: string; label: string }[]) {
    const rear = list.filter((c) => /back|rear|environment/i.test(c.label))
    const usable = rear.find((c) => !/ultra|wide|tele|depth/i.test(c.label)) ?? rear[0]
    // Android commonly orders the main rear camera last when labels are unhelpful.
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

      // Enumerate only after the user has asked for the camera: getCameras() itself
      // triggers the permission prompt on several browsers.
      let target = deviceId ?? chosen
      if (!target) {
        const found = await Html5Qrcode.getCameras()
        const list = found.map((c) => ({ id: c.id, label: c.label || c.id }))
        setCameras(list)
        target = preferRear(list)
      }

      await scanner.start(
        // A deviceId is exact where facingMode is a hint, so a phone with three rear
        // lenses lands on the one that can focus rather than whichever it prefers.
        target ? { deviceId: { exact: target } } : { facingMode: "environment" },
        {
          fps: 10,
          // Sized from the live viewfinder, not fixed: a 230px box is wider than the
          // video on a small phone in portrait, which html5-qrcode rejects outright.
          qrbox: (w: number, h: number) => {
            const edge = Math.max(140, Math.floor(Math.min(w, h) * 0.72))
            return { width: edge, height: edge }
          },
          aspectRatio: 1,
        },
        (decoded) => {
          setCode(decoded.trim())
          safeStop()
          setScanning(false)
        },
        () => {},
      )

      if (target) setChosen(target)
      setScanning(true)

      // Torch is worth having on a printed tag in a badly lit hall, and is offered
      // only where the running track actually reports it.
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
      setTorch(null)   // the device claimed it and then refused; stop offering it
    }
  }

  async function act(kind: "IN" | "OUT") {
    // Same asynchronous-setState race as the action queue: a double tap on a phone is
    // more likely than a double click on a desktop, not less.
    if (!code || inFlight.current) return
    inFlight.current = true
    setBusy(kind)
    setError(null)
    try {
      if (kind === "OUT") {
        await api.checkout(code, actor())
        setMessage(`${code} checked out`)
      } else {
        await api.checkin(code, detail?.asset.condition_grade ?? "B", actor(),
                          "Returned via QR scan")
        setMessage(`${code} checked in — condition recorded`)
      }
      await refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed")
    } finally {
      setBusy(null)
      inFlight.current = false
    }
  }

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-5">
      <header>
        <h1 className="text-[24px] font-bold tracking-tight text-chalk">Scan a machine</h1>
        <p className="mt-1.5 text-[14px] text-steel">
          Point the camera at a printed tag, or type the ID. Two taps to check in or out.
        </p>
      </header>

      <div className="relative overflow-hidden border border-hairline bg-surface">
        <div id={READER_ID} className="min-h-[240px] w-full [&_video]:w-full [&_video]:object-cover" />

        {!scanning && (
          <div className="blueprint absolute inset-0 flex flex-col items-center justify-center gap-4">
            <p className="label">camera idle</p>
            <button
              onClick={() => startCamera()}
              className="border border-hazard bg-hazard px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ground"
            >
              Start camera
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

      {/* A phone with several rear lenses can land on the ultra-wide, which will not
          focus on a tag held at arm's length. Switching is one tap. */}
      {cameras.length > 1 && (
        <label className="flex items-center gap-3">
          <span className="label shrink-0">camera</span>
          <select
            value={chosen ?? ""}
            onChange={(e) => { setChosen(e.target.value); startCamera(e.target.value) }}
            className="w-full border border-hairline bg-ground px-3 py-2 font-mono text-[12px] text-chalk outline-none focus:border-hazard"
          >
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder="EQX1007"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="w-full border border-hairline bg-ground px-3 py-2.5 font-mono text-[16px] text-chalk outline-none focus:border-hazard"
        />
        <button
          onClick={() => setCode(manual.trim())}
          className="shrink-0 border border-hairline-bright px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-chalk hover:border-hazard hover:text-hazard"
        >
          Look up
        </button>
      </div>

      {error && (
        <p className="border border-critical/40 bg-critical/10 px-4 py-3 text-[12.5px] leading-relaxed text-critical">{error}</p>
      )}
      {message && (
        <p className="border border-nominal/40 bg-nominal/10 px-4 py-3 text-[12.5px] text-nominal">{message}</p>
      )}

      {detail && (
        <section className="border border-hairline bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <div>
              <p className="num text-[20px] font-bold text-chalk">{detail.asset.equipment_id}</p>
              <p className="mt-1 text-[13px] text-steel">
                {detail.asset.type} · {detail.asset.model}
              </p>
            </div>
            <StatusPill status={detail.status} />
          </header>

          <div className="grid grid-cols-2 gap-px bg-hairline">
            <button
              onClick={() => act("OUT")}
              disabled={busy !== null}
              className={cn(
                "bg-surface px-4 py-5 text-[15px] font-semibold text-chalk transition-colors",
                "hover:bg-raised hover:text-hazard disabled:opacity-40",
              )}
            >
              {busy === "OUT" ? "working…" : "Check out"}
            </button>
            <button
              onClick={() => act("IN")}
              disabled={busy !== null}
              className={cn(
                "bg-surface px-4 py-5 text-[15px] font-semibold text-chalk transition-colors",
                "hover:bg-raised hover:text-hazard disabled:opacity-40",
              )}
            >
              {busy === "IN" ? "working…" : "Check in"}
            </button>
          </div>

          {detail.signals.length > 0 && (
            <p className="border-t border-hairline px-5 py-3 text-[12.5px] text-critical">
              {detail.signals.length} rule{detail.signals.length > 1 ? "s" : ""} firing on this
              machine.{" "}
              <button
                onClick={() => nav(`/asset/${detail.asset.equipment_id}`)}
                className="underline underline-offset-2 hover:text-hazard"
              >
                Open the full panel
              </button>
            </p>
          )}
        </section>
      )}

      <p className="label leading-relaxed">
        every scan writes one event to the append-only log — simple, but traceable
      </p>
    </div>
  )
}
