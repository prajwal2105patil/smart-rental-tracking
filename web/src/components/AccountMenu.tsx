import { useEffect, useRef, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useSession, signOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/**
 * Top right: who you are, or a way to say so.
 *
 * Signed out it is a single button, because there is nothing else to say. Signed in it
 * shows the name that is going into the event log and the role that decides which
 * controls appear — with the elevated one marked, since that is the only one the server
 * treats differently.
 */
export default function AccountMenu() {
  const session = useSession()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [open])

  if (!session) {
    return (
      <button
        onClick={() => nav("/signin", { state: { from: pathname } })}
        className="border border-hazard px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-hazard transition-colors hover:bg-hazard hover:text-ground"
      >
        Sign in
      </button>
    )
  }

  const initials = session.actor.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 border border-hairline-bright px-2 py-1.5 transition-colors hover:border-hazard"
      >
        <span className={cn(
          "grid h-6 w-6 place-items-center font-mono text-[10px] font-bold",
          session.elevated ? "bg-hazard text-ground" : "bg-raised text-chalk",
        )}>
          {initials}
        </span>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.1em] text-steel sm:inline">
          {session.actor.split(/\s+/)[0]}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[268px] border border-hairline-bright bg-surface"
        >
          <div className="border-b border-hairline px-4 py-3">
            <p className="text-[14px] font-semibold text-chalk">{session.actor}</p>
            <p className="mt-1 flex items-center gap-2">
              <span className="label">{session.role_label}</span>
              {session.elevated && (
                <span className="border border-hazard/60 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em] text-hazard">
                  key verified
                </span>
              )}
            </p>
          </div>

          <p className="border-b border-hairline px-4 py-3 text-[12px] leading-relaxed text-slate">
            {session.can_write
              ? "Actions you take are written to the event log under this name."
              : "You are reading only. Sign in as a supervisor to change anything."}
          </p>

          <button
            onClick={() => { signOut(); setOpen(false); nav("/") }}
            className="w-full px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-steel transition-colors hover:bg-raised hover:text-hazard"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
