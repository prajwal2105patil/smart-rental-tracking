import { cn } from "@/lib/utils"

/**
 * Utilisation as a machined gauge rather than a rounded progress bar: a hard-edged
 * fill against a ticked track, coloured by the same thresholds the rules use.
 */
export default function UtilisationBar({
  value, warn = 35, crit = 20, className,
}: { value: number; warn?: number; crit?: number; className?: string }) {
  const tone =
    value < crit ? "bg-critical" : value < warn ? "bg-warning" : "bg-nominal"
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative h-[6px] w-full min-w-[72px] overflow-hidden bg-hairline">
        <div className={cn("absolute inset-y-0 left-0 transition-[width] duration-500", tone)}
             style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        {/* threshold ticks, so the number is read against the rule that judges it */}
        <span className="absolute inset-y-0 w-px bg-ground/70" style={{ left: `${crit}%` }} />
        <span className="absolute inset-y-0 w-px bg-ground/70" style={{ left: `${warn}%` }} />
      </div>
      <span className="num w-[46px] shrink-0 text-right text-[12px] text-steel">
        {value.toFixed(1)}%
      </span>
    </div>
  )
}
