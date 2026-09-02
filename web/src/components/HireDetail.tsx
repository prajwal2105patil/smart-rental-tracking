import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { cn, inr } from "@/lib/utils"

/**
 * The proof, and the story, behind one hire.
 *
 * A customer is billed on hours. The reasonable next question is "how do I know?", and
 * the honest answer is to show the meter. These bars are the machine's own cumulative
 * operating counter, differenced day by day — not a summary we computed and asked them
 * to trust. Beneath it, the same machine's history as a plain timeline: when it went
 * out, when it was worked, when it came back, and who did each.
 *
 * Fetched only when the panel is opened, so a customer with four machines does not pay
 * for four detail requests to look at a list.
 */

const KIND: Record<string, { say: string; tone: string }> = {
  CHECK_OUT:     { say: "Left the yard for your site", tone: "text-info" },
  ASSIGN:        { say: "Assigned to your site and operator", tone: "text-info" },
  USAGE_LOG:     { say: "Hours recorded", tone: "text-steel" },
  CONDITION_LOG: { say: "Condition checked", tone: "text-steel" },
  CHECK_IN:      { say: "Returned to the yard", tone: "text-nominal" },
  RETURN_TO_YARD:{ say: "Returned to the yard", tone: "text-nominal" },
}

export default function HireDetail({ id, rate }: { id: string; rate: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["asset", id],
    queryFn: () => api.asset(id),
    refetchInterval: false,
  })

  if (isLoading) {
    return <p className="label border-t border-hairline px-5 py-6 text-center">reading the meter…</p>
  }
  if (!data) return null

  // The counter is cumulative, so a day's work is the rise across that day.
  const series = data.telemetry_series ?? []
  const worked = series.slice(1).map((p, i) => ({
    date: p.date,
    hours: Math.max(0, +(p.cumulative_operating_hours - series[i].cumulative_operating_hours).toFixed(2)),
  }))
  const peak = Math.max(...worked.map((w) => w.hours), 1)
  const total = worked.reduce((n, w) => n + w.hours, 0)

  return (
    <div className="border-t border-hairline bg-ground px-5 py-5">
      {worked.length > 1 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="label">hours worked, day by day</p>
            <p className="text-[12px] text-slate">
              <span className="num text-chalk">{total.toFixed(1)}h</span> over{" "}
              {worked.length} days — read from the machine's own counter
            </p>
          </div>

          <div className="mt-3 flex h-[70px] items-end gap-[3px]">
            {worked.map((w) => (
              <div key={w.date} className="group relative flex-1">
                <div
                  className={cn("w-full transition-colors",
                    w.hours === 0 ? "bg-hairline-bright" : "bg-hazard/70 group-hover:bg-hazard")}
                  style={{ height: `${Math.max(2, (w.hours / peak) * 70)}px` }}
                />
                <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 hidden -translate-x-1/2 whitespace-nowrap border border-hairline-bright bg-raised px-2 py-1 text-[11px] text-chalk group-hover:block">
                  {w.date}: <span className="num">{w.hours}h</span>
                  {w.hours > 0 && <> · {inr(Math.round(rate))}/day</>}
                </span>
              </div>
            ))}
          </div>
          <p className="label mt-2">
            {worked[0]?.date} → {worked[worked.length - 1]?.date} · a flat bar is a day it
            did not work
          </p>
        </>
      )}

      <p className="label mt-6">everything that has happened to this machine</p>
      <ol className="mt-3 flex flex-col">
        {(data.events ?? []).map((e) => {
          const k = KIND[e.event_type] ?? { say: e.event_type, tone: "text-steel" }
          return (
            <li key={e.event_id} className="flex gap-3 border-l border-hairline pb-3 pl-4 last:pb-0">
              <span className="relative">
                <span className="absolute -left-[21px] top-[5px] h-[7px] w-[7px] rounded-full bg-hazard" />
              </span>
              <div className="min-w-0">
                <p className={cn("text-[13px] font-medium", k.tone)}>{k.say}</p>
                <p className="mt-0.5 text-[11.5px] text-slate">
                  <span className="num">{e.timestamp.replace("T", " ").slice(0, 16)}</span>
                  {e.actor && <> · by {e.actor}</>}
                  {e.site_id && <> · {e.site_id}</>}
                  {e.condition_grade && <> · condition {e.condition_grade}</>}
                </p>
                {e.notes && <p className="mt-0.5 text-[12px] text-steel">{e.notes}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
