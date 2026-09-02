import type { AssetRow } from "@/lib/types"
import MachineSilhouette from "@/components/MachineSilhouette"
import { cn } from "@/lib/utils"

/**
 * A wall of machines, filling the space beside the problem statement.
 *
 * The reference for this was a staggered photo collage. Photographs would have been
 * stock: generic yellow plant that belongs to nobody. These cards are the fleet on the
 * board right now - real ids, real statuses, real utilisation - so the panel argues the
 * same point the paragraph beside it does instead of decorating it.
 *
 * Two columns travelling in opposite directions. The motion is a true loop, not a
 * bounce: each column holds two copies of its cards and translates by exactly half its
 * own height, so the moment it reaches the second copy it is already back where it
 * started and the seam is invisible. Nothing but `transform` animates, so it stays on
 * the compositor; the global prefers-reduced-motion rule in index.css stops it dead.
 */

const TONE: Record<string, { line: string; glow: string; label: string }> = {
  OVERDUE:    { line: "#ff5b45", glow: "rgba(255,91,69,0.16)",   label: "text-critical" },
  UNASSIGNED: { line: "#ff5b45", glow: "rgba(255,91,69,0.16)",   label: "text-critical" },
  IDLE:       { line: "#ffab2e", glow: "rgba(255,171,46,0.14)",  label: "text-warning" },
  ACTIVE:     { line: "#3ddc97", glow: "rgba(61,220,151,0.12)",  label: "text-nominal" },
  AT_YARD:    { line: "#6ea8ff", glow: "rgba(110,168,255,0.10)", label: "text-info" },
}

// Margin rather than flex `gap`: the loop translates by exactly 50% of the doubled
// list, which only lands on the seam if every card carries its own trailing space.
// A `gap` would add one extra between the two copies and the loop would visibly jump.
const GAP = 12

function Card({ asset, i }: { asset: AssetRow; i: number }) {
  const tone = TONE[asset.status] ?? TONE.AT_YARD

  return (
    <figure
      className="relative shrink-0 overflow-hidden border border-hairline bg-surface"
      style={{ marginBottom: GAP }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse at 50% 40%, ${tone.glow}, transparent 68%)` }}
      />

      {/* Heights vary a little so the column staggers rather than reading as a stack of
          identical tiles, and the padding pushes each card toward portrait. */}
      <div
        className="relative flex items-center px-4"
        style={{ paddingBlock: `${26 + (i % 3) * 14}px` }}
      >
        <MachineSilhouette type={asset.type} tone={tone.line} className="h-auto w-full" />
      </div>

      <figcaption className="relative flex items-baseline justify-between gap-2 px-4 pb-3">
        <span className="num text-[12px] font-semibold text-chalk">{asset.equipment_id}</span>
        <span className={cn("font-mono text-[9px] tracking-[0.14em]", tone.label)}>
          {asset.status === "UNASSIGNED" || asset.status === "OVERDUE"
            ? asset.status
            : `${asset.utilization_pct.toFixed(0)}%`}
        </span>
      </figcaption>
    </figure>
  )
}

function Column({
  cards, direction, seconds,
}: { cards: AssetRow[]; direction: "up" | "down"; seconds: number }) {
  return (
    <div className="min-w-0">
      <div
        className="flex flex-col"
        style={{
          animation: `wall-${direction} ${seconds}s linear infinite`,
          willChange: "transform",
        }}
      >
        {/* Two copies. The animation ends on the first card of the second copy, which is
            pixel-identical to where it began. */}
        {[0, 1].map((copy) =>
          cards.map((a, i) => (
            <Card key={`${copy}-${a.equipment_id}`} asset={a} i={i} />
          )),
        )}
      </div>
    </div>
  )
}

export default function MachineWall({ assets }: { assets: AssetRow[] }) {
  if (assets.length < 4) return null

  // The story first: the machines nobody is watching, then the one about to break, then
  // the fleet that is actually earning. The wall says what the headline beside it says.
  const rank = (a: AssetRow) =>
    a.status === "UNASSIGNED" ? 0 : a.status === "OVERDUE" ? 1 : a.status === "IDLE" ? 2 : 3
  const chosen = [...assets]
    .sort((a, b) => rank(a) - rank(b) || b.flags_count - a.flags_count)
    .slice(0, 8)

  const left = chosen.filter((_, i) => i % 2 === 0)
  const right = chosen.filter((_, i) => i % 2 === 1)

  return (
    <div aria-hidden className="relative h-[560px] select-none overflow-hidden">
      <style>{`
        @keyframes wall-up {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(0, -50%, 0); }
        }
        @keyframes wall-down {
          from { transform: translate3d(0, -50%, 0); }
          to   { transform: translate3d(0, 0, 0); }
        }
      `}</style>

      {/* Durations are deliberately not a round ratio, so the two columns never fall
          into step and the wall never repeats a composition. */}
      <div className="grid grid-cols-2 gap-3">
        <Column cards={left} direction="up" seconds={38} />
        <Column cards={right} direction="down" seconds={47} />
      </div>

      {/* The fades are what sell the loop: cards arrive out of nothing and leave into
          nothing, so neither end of the travel is a visible edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{ background: "linear-gradient(to bottom, #05070d 8%, transparent)" }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28"
        style={{ background: "linear-gradient(to top, #05070d 8%, transparent)" }}
      />
    </div>
  )
}
