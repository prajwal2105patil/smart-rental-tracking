import type { Anomaly } from "@/lib/types"
import { cn, inr } from "@/lib/utils"

const TONE = {
  CRITICAL: { text: "text-critical", edge: "border-l-critical", bg: "bg-critical/[0.06]" },
  WARNING:  { text: "text-warning",  edge: "border-l-warning",  bg: "bg-warning/[0.05]" },
  INFO:     { text: "text-info",     edge: "border-l-info",     bg: "bg-info/[0.05]" },
} as const

/**
 * THE explainability component. Every flag shows the rule that fired, the fields that
 * fired it, their values, and the threshold that was crossed. Nothing reaches the
 * operator as a verdict without the evidence underneath it.
 */
export default function SignalList({ signals, className }: { signals: Anomaly[]; className?: string }) {
  if (!signals.length) {
    return (
      <div className={cn("border border-hairline bg-surface px-5 py-8 text-center", className)}>
        <p className="text-[13px] text-nominal">No rules firing on this machine.</p>
        <p className="label mt-1.5">all checks passed</p>
      </div>
    )
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-px bg-hairline", className)}>
      {signals.map((a, i) => {
        const tone = TONE[a.severity]
        return (
          <article key={`${a.rule_id}-${i}`} className={cn("min-w-0 border-l-2 bg-surface", tone.edge, tone.bg)}>
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
              <span className={cn("font-mono text-[11px] font-semibold tracking-[0.12em]", tone.text)}>
                {a.rule_id}
              </span>
              <span className={cn("font-mono text-[9.5px] tracking-[0.16em]", tone.text)}>
                {a.severity}
              </span>
              <h4 className="min-w-0 flex-1 text-[13.5px] font-medium text-chalk">{a.title}</h4>
              {a.est_value_inr > 0 && (
                <span className="num text-[13px] font-semibold text-hazard">{inr(a.est_value_inr)}</span>
              )}
            </header>

            {/* The evidence. This table is the scored requirement. */}
            <div className="mt-2.5 overflow-x-auto px-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-hairline">
                    <th scope="col" className="label pb-1 text-left font-normal">field</th>
                    <th scope="col" className="label pb-1 text-left font-normal">value</th>
                    <th scope="col" className="label pb-1 text-left font-normal">threshold crossed</th>
                  </tr>
                </thead>
                <tbody>
                  {a.signals.map((s, j) => (
                    <tr key={j} className="border-b border-hairline/60 last:border-0">
                      <td className="num py-1.5 pr-4 text-[12px] text-steel whitespace-nowrap">{s.field}</td>
                      <td className="num py-1.5 pr-4 text-[12px] font-medium text-chalk whitespace-nowrap">{s.value}</td>
                      <td className={cn("num py-1.5 text-[12px] whitespace-nowrap", s.threshold ? tone.text : "text-slate")}>
                        {s.threshold ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="mt-2.5 flex items-start gap-2 border-t border-hairline px-4 py-2.5">
              <span className="label mt-[3px] shrink-0">do</span>
              <p className="text-[12.5px] text-steel">{a.recommended_action}</p>
            </footer>
          </article>
        )
      })}
    </div>
  )
}
