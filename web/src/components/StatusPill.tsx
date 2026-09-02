import type { Status } from "@/lib/types"
import { cn } from "@/lib/utils"

const TONE: Record<Status, string> = {
  OVERDUE:    "text-critical border-critical/50 bg-critical/10",
  UNASSIGNED: "text-critical border-critical/50 bg-critical/10",
  IDLE:       "text-warning  border-warning/50  bg-warning/10",
  IN_SERVICE: "text-info     border-info/50     bg-info/10",
  ACTIVE:     "text-nominal  border-nominal/40  bg-nominal/10",
  AT_YARD:    "text-steel    border-hairline-bright bg-raised",
}

export default function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-[3px] font-mono text-[10px] font-medium tracking-[0.14em]",
        TONE[status], className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {status}
    </span>
  )
}
