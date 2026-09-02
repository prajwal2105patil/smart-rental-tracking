import { useRef, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { signIn, homeFor } from "@/lib/session"
import { cn, inr } from "@/lib/utils"
import RotatingEarth, { type GlobeMarker } from "@/components/ui/wireframe-dotted-globe"

/**
 * Sign in.
 *
 * The reference was a split card: form on the left, a live visual on the right with
 * figures floating over it. That structure is worth stealing wholesale, but the right
 * panel of the original showed a stock globe with decorative stats. Ours shows THE
 * FLEET - the same globe the board uses, with markers at the machines' real last known
 * positions, and four figures read from the same endpoints the console reads.
 *
 * So the panel is not an illustration of a product. It IS the product, already running,
 * before anybody has typed anything. If the numbers here disagreed with the board they
 * would be wrong in both places, which is the point.
 *
 * There is no password field and that is deliberate, not unfinished. See lib/session.ts.
 */

const CHIP = "border border-hairline-bright bg-surface/85 px-3 py-2 backdrop-blur-sm"

function Chip({ v, k, tone, className }: {
  v: string; k: string; tone?: string; className?: string
}) {
  return (
    <div className={cn(CHIP, "absolute", className)}>
      <p className={cn("num text-[17px] font-semibold leading-none", tone ?? "text-chalk")}>{v}</p>
      <p className="label mt-1">{k}</p>
    </div>
  )
}

export default function SignIn() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const back = loc.state?.from ?? "/fleet"

  const [name, setName] = useState("")
  const [role, setRole] = useState("YARD")
  const [key, setKey] = useState("")
  const [site, setSite] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const { data: meta } = useQuery({ queryKey: ["roles"], queryFn: api.roles, refetchInterval: false })
  const { data: assets } = useQuery({ queryKey: ["assets"], queryFn: api.assets, refetchInterval: false })
  const { data: usage } = useQuery({ queryKey: ["usage"], queryFn: api.usage, refetchInterval: false })
  const { data: ledger } = useQuery({ queryKey: ["ledger"], queryFn: api.ledger, refetchInterval: false })
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: false })

  // The same markers the board draws, from the same fixes - so this globe and the
  // fleet map can never show different machines in different places.
  const markers: GlobeMarker[] = (assets ?? [])
    .filter((a) => a.latitude != null && a.longitude != null)
    .map((a) => ({
      id: a.equipment_id,
      lat: a.latitude as number,
      lon: a.longitude as number,
      tone: a.status === "OVERDUE" || a.status === "UNASSIGNED" ? "#ff5b45"
        : a.status === "IDLE" ? "#ffab2e"
        : a.status === "ACTIVE" ? "#3ddc97" : "#6ea8ff",
      label: a.equipment_id,
      detail: `${a.type} · ${a.status}`,
      emphasis: a.status === "OVERDUE" || a.status === "UNASSIGNED",
    }))

  const roles = meta?.roles ?? []
  const chosen = roles.find((r) => r.id === role)
  const needsKey = chosen?.needs_key ?? false
  // A customer is scoped to the site they rented to; nothing else in the data links a
  // machine to a customer, so the site is the honest scope.
  const needsSite = role === "VIEWER"
  const sites = meta?.sites ?? []

  const ready = name.trim().length >= 2 && (!needsSite || site !== "")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Ref, not state: two fast Enters both pass a state check before React re-renders.
    if (inFlight.current || !ready) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const s = await api.session(name.trim(), role, needsKey ? key : undefined,
                                  needsSite ? site : undefined)
      signIn(s, needsKey ? key : undefined)
      // Land where this person belongs. Honouring `from` only when they are allowed
      // there, so a customer who deep-linked to /fleet still ends up on their own hire.
      const home = homeFor(s)
      nav(back !== "/signin" && back.startsWith(home) ? back : home, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not sign you in")
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-[1120px] items-center px-2">
      <div className="grid w-full overflow-hidden border border-hairline bg-surface lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">

        {/* ---------------------------------------------------------- the form */}
        <div className="flex flex-col justify-center px-8 py-12 sm:px-12">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center bg-hazard font-mono text-[13px] font-bold text-ground">
              S
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-steel">
              Smart Rental Tracking
            </span>
          </div>

          <h1 className="mt-7 text-[34px] font-bold leading-[1.05] tracking-tight text-chalk">
            Sign in
          </h1>
          <p className="mt-3 max-w-[42ch] text-[14.5px] leading-relaxed text-steel">
            Every check-out, assignment and usage entry is written to an append-only log
            under the name you give here. That is the whole reason to sign in.
          </p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className="label">your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Prajwal Patil"
                autoComplete="name"
                className="border border-hairline bg-ground px-3.5 py-3 text-[15px] text-chalk outline-none placeholder:text-slate focus:border-hazard"
              />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="label mb-2">what you are here to do</legend>
              <div className="flex flex-col gap-px bg-hairline">
                {roles.map((r) => (
                  <label
                    key={r.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 bg-surface px-3.5 py-3 transition-colors hover:bg-raised",
                      role === r.id && "bg-raised",
                    )}
                  >
                    <input
                      type="radio" name="role" value={r.id}
                      checked={role === r.id}
                      onChange={() => { setRole(r.id); setError(null) }}
                      className="sr-only"
                    />
                    <span className={cn(
                      "mt-[5px] h-2.5 w-2.5 shrink-0 border",
                      role === r.id ? "border-hazard bg-hazard" : "border-hairline-bright",
                    )} />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-chalk">
                        {r.label}
                        {r.needs_key && (
                          <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-hazard">
                            key required
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate">
                        {r.blurb}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {needsSite && (
              <label className="flex flex-col gap-2">
                <span className="label">which site are you</span>
                <select
                  value={site}
                  onChange={(e) => { setSite(e.target.value); setError(null) }}
                  className="border border-hairline bg-ground px-3.5 py-3 text-[15px] text-chalk outline-none focus:border-hazard"
                >
                  <option value="">choose your site…</option>
                  {sites.map((sid) => <option key={sid} value={sid}>{sid}</option>)}
                </select>
                <span className="text-[11.5px] leading-relaxed text-slate">
                  You will see only the machines on hire to this site. Nothing from the
                  rest of the dealer's fleet appears on your screen.
                </span>
              </label>
            )}

            {needsKey && (
              <label className="flex flex-col gap-2">
                <span className="label">dealer access key</span>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={meta?.admin_required ? "" : "no key set on this instance"}
                  autoComplete="off"
                  className="border border-hairline bg-ground px-3.5 py-3 font-mono text-[14px] text-chalk outline-none placeholder:text-slate focus:border-hazard"
                />
                <span className="text-[11.5px] leading-relaxed text-slate">
                  {meta?.admin_required
                    ? "The server checks this on every write. It is held for this browser tab only and is never built into the site."
                    : "This instance has no access key configured, so nothing is being checked. Set ADMIN_TOKEN before deploying."}
                </span>
              </label>
            )}

            {error && (
              <p className="border border-critical/40 bg-critical/10 px-4 py-3 text-[12.5px] text-critical">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !ready}
              className="bg-hazard px-5 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "checking…" : "Enter the console"}
            </button>

            <button
              type="button"
              onClick={() => nav(back, { replace: true })}
              className="-mt-2 self-center text-[13px] text-steel underline underline-offset-4 hover:text-hazard"
            >
              Look around without signing in
            </button>
          </form>

          <p className="label mt-9 leading-relaxed">
            no passwords are stored · identity is written to the event log · the access
            key is verified by the server on every write
          </p>
        </div>

        {/* ------------------------------------------------- the fleet, already live */}
        <div className="relative hidden min-h-[540px] border-l border-hairline bg-ground lg:block">
          <div className="blueprint absolute inset-0" />

          <div className="absolute inset-0 grid place-items-center">
            <RotatingEarth markers={markers} focus={[78, 21]} width={430} height={430} />
          </div>

          <Chip className="left-8 top-12" v={String(health?.assets ?? assets?.length ?? "—")}
                k="machines on the board" />
          <Chip className="right-8 top-24"
                v={usage ? `${usage.fleet.utilisation_pct}%` : "—"} k="fleet utilisation" />
          <Chip className="bottom-28 left-10" tone="text-hazard"
                v={ledger ? inr(ledger.exposure.total_exposure_inr) : "—"} k="open exposure" />
          <Chip className="bottom-14 right-10"
                v={health ? health.telemetry_snapshots.toLocaleString("en-IN") : "—"}
                k="telemetry snapshots" />

          <div className="absolute inset-x-0 bottom-0 px-8 py-6 text-center">
            <p className="label">the fleet, right now</p>
            <p className="mt-1.5 text-[12.5px] text-slate">
              ISO 15143-3 telemetry · SAE J1939 fault codes · clock pinned to{" "}
              <span className="num">{health?.now ?? "—"}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
