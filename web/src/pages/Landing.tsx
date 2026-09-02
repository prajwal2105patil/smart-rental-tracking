import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import MetroHero from "@/components/ui/scroll-locked-video-hero"
import MachineExploded from "@/components/MachineExploded"
import MachineWall from "@/components/MachineWall"
import CraneMarquee from "@/components/CraneMarquee"
import { api } from "@/lib/api"
import { cn, inr } from "@/lib/utils"

// Drop a file at web/public/hero.mp4 to arm the scroll-scrub reveal. Without it the
// hero renders the still blueprint composition and the page scrolls normally, so a
// missing asset never blocks the demo.
const HERO_VIDEO = "/hero.mp4"

function useHasVideo(src: string) {
  const [exists, setExists] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    fetch(src, { method: "HEAD" })
      .then((r) => {
        // res.ok is not enough: a dev server with SPA fallback answers 200 and hands
        // back index.html for a missing file. Believing that engages the scroll lock
        // and feeds HTML to a <video> element, which never loads - so the visitor
        // scrolls into a blank screen with no way out. Check the type, not the status.
        const type = r.headers.get("content-type") ?? ""
        if (alive) setExists(r.ok && type.startsWith("video"))
      })
      .catch(() => alive && setExists(false))
    return () => {
      alive = false
    }
  }, [src])
  return exists
}

/** Technical annotation block - the callout language from the reference boards. */
function Spec({ n, k, v, tone }: { n: string; k: string; v: string; tone?: string }) {
  return (
    <div className="relative border-l border-hairline-bright pl-4">
      <span className="label absolute -left-px top-0 -translate-x-full pr-2">{n}</span>
      <p className="label">{k}</p>
      <p className={cn("num mt-1 text-[26px] font-semibold leading-none", tone ?? "text-chalk")}>
        {v}
      </p>
    </div>
  )
}

/** Half travel below 640px, or the parts fly off-canvas before the cab has moved. */
function useCompact() {
  const [compact, setCompact] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 640 : false,
  )
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const on = () => setCompact(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return compact
}

export default function Landing() {
  const hasVideo = useHasVideo(HERO_VIDEO)
  const compact = useCompact()
  const { data: usage } = useQuery({ queryKey: ["usage"], queryFn: api.usage, refetchInterval: false })
  const { data: ledger } = useQuery({ queryKey: ["ledger"], queryFn: api.ledger, refetchInterval: false })
  const { data: alerts } = useQuery({ queryKey: ["alerts"], queryFn: api.alerts, refetchInterval: false })
  const { data: assets } = useQuery({ queryKey: ["assets"], queryFn: api.assets, refetchInterval: false })
  const { data: risk } = useQuery({ queryKey: ["maintenance"], queryFn: api.maintenance, refetchInterval: false })

  const critical = alerts?.filter((a) => a.severity === "CRITICAL").length ?? 0
  const ghosts = usage?.by_site.find((s) => s.site_id === "UNASSIGNED")

  // One live figure per question on the crane banner. Read from the same endpoints the
  // rest of this page reads, so the banner cannot claim anything the board does not.
  // A missing figure yields undefined and the banner simply carries the question alone.
  const worst = risk?.[0]
  const facts = [
    critical && ledger ? `${critical} critical flags | ${inr(ledger.exposure.waste_inr)} traced` : undefined,
    assets ? `${assets.length} machines ranked by free-from date` : undefined,
    worst ? `${worst.equipment_id} | ${worst.current_temp_c} deg C | ${worst.days_to_failure} days` : undefined,
    ledger ? `${inr(ledger.exposure.total_exposure_inr)} open, in three buckets` : undefined,
  ].map((f) => f ?? "")

  return (
    <div className="bg-ground">
      <MetroHero
        videoSrc={hasVideo ? HERO_VIDEO : undefined}
        // The scrub always has something to reveal, video or not. The machine comes
        // apart along its real assembly axes and each separated component carries the
        // telemetry that component actually emits.
        stage={!hasVideo ? <MachineExploded id="EQX1007" compact={compact} /> : undefined}
        kicker="CATERPILLAR · SMART RENTAL TRACKING"
        title="EVERY MACHINE, ACCOUNTED FOR"
        tagline="Two of your machines are on rent to nobody."
        scrollHint="SCROLL TO DISMANTLE"
        scrubDistance={3400}
        signature={false}
      >
        <Link
          to="/signin"
          className="border border-hazard bg-hazard px-6 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-ground transition-opacity hover:opacity-90"
        >
          Open the console
        </Link>
      </MetroHero>

      {/* ---------------- the problem, in the dealer's own vocabulary ------------- */}
      <section className="blueprint border-t border-hairline">
        <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-32">
          {/* The right of this section was empty at desktop width. The wall fills it with
              the actual fleet rather than stock plant, so it argues the same point the
              paragraph does. */}
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="min-w-0">
              <p className="label">01 — the problem</p>
              <h2 className="mt-5 max-w-[22ch] text-[clamp(28px,5vw,58px)] font-bold leading-[1.02] tracking-tight text-chalk">
                A rented machine that nobody is watching is a machine you are paying for twice.
              </h2>
              <p className="mt-7 max-w-[62ch] text-[17px] leading-relaxed text-steel">
                Dealers rent equipment out and then lose sight of it. Where it is, who is
                running it, when it is due back — still a spreadsheet, still manual, still
                discovered too late. This console reads the telemetry those machines already
                emit and turns it into the four decisions a dealer actually makes.
              </p>
            </div>

            <div className="hidden lg:block">
              <MachineWall assets={assets ?? []} />
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-x-10 gap-y-12 pl-10 sm:grid-cols-4">
            <Spec n="A" k="fleet utilisation" v={usage ? `${usage.fleet.utilisation_pct}%` : "—"} />
            <Spec n="B" k="critical flags" v={String(critical || "—")} tone="text-critical" />
            <Spec
              n="C"
              k="idle, no site"
              v={ghosts ? `${ghosts.idle_hours}h` : "—"}
              tone="text-warning"
            />
            <Spec
              n="D"
              k="zero-output waste"
              v={ledger ? inr(ledger.exposure.waste_inr) : "—"}
              tone="text-hazard"
            />
          </div>
        </div>
      </section>

      {/* ---------------- the four answers ---------------------------------------- */}
      <section className="border-t border-hairline bg-surface">
        <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-32">
          <p className="label">02 — what it answers</p>
          <CraneMarquee facts={facts} />
        </div>
      </section>

      {/* ---------------- the honest bit ------------------------------------------ */}
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
          <p className="label">03 — what is real</p>
          <div className="mt-10 grid gap-12 md:grid-cols-[1.1fr_1fr]">
            <div>
              <h2 className="max-w-[20ch] text-[clamp(24px,3.6vw,40px)] font-bold leading-[1.06] tracking-tight text-chalk">
                Nothing here is trained, and nothing here is random.
              </h2>
              <p className="mt-6 max-w-[54ch] text-[15.5px] leading-relaxed text-steel">
                The seven machines you gave us are byte-identical to what we received — a test
                fails the build if that ever changes. The telemetry history is synthetic and
                derived from your own fields, so it cannot drift from them. Every rupee on
                screen is arithmetic you can redo by hand, and two runs produce identical
                output.
              </p>
            </div>
            <dl className="flex flex-col gap-px self-start bg-hairline">
              {[
                ["given rows, unchanged", "7"],
                ["telemetry snapshots", "15,144"],
                ["rules, three kinds", "8"],
                ["assertions pinning the output", "52"],
                ["numeric thresholds in the rules code", "0"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-6 bg-ground px-5 py-3.5">
                  <dt className="text-[13.5px] text-steel">{k}</dt>
                  <dd className="num text-[17px] font-semibold text-chalk">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------- close ---------------------------------------------------- */}
      <section className="border-t border-hairline bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-8 px-6 py-24 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="max-w-[18ch] text-[clamp(24px,3.4vw,38px)] font-bold leading-[1.06] tracking-tight text-chalk">
              Three red rows are waiting on the board.
            </h2>
            <p className="mt-3 text-[14.5px] text-slate">Every one of them traces to a row you gave us.</p>
          </div>
          <Link
            to="/signin"
            className="shrink-0 border border-hazard bg-hazard px-8 py-4 font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-ground transition-opacity hover:opacity-90"
          >
            Open the console →
          </Link>
        </div>
      </section>
    </div>
  )
}
