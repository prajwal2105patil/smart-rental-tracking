import { useState } from "react"

/**
 * A word explained where it is used.
 *
 * The customer page is read by people who hire machines, not by people who read
 * telemetry. "Idle hours" and "condition grade" are jargon to them, and a glossary on
 * another page is a glossary nobody opens. This puts one sentence exactly where the
 * question occurs.
 */

const WORDS: Record<string, string> = {
  idle: "Idle means the engine is running but the machine is not doing work — waiting, warming up, or parked with the key on. You are billed for those hours the same as working hours, which is why they are worth watching.",
  working: "The share of the hours a machine was switched on that it spent actually working. 100% would mean it never sat running and idle, which no site achieves — but the higher it is, the less you are paying for nothing.",
  grade: "The condition it was in when last checked by the yard. A is as-new, B is good working order with normal wear, C means it is due attention. It is recorded at every return, so it travels with the machine.",
}

export default function Explain({ what }: { what: keyof typeof WORDS | string }) {
  const [open, setOpen] = useState(false)
  const text = WORDS[what]
  if (!text) return null

  return (
    <span className="relative ml-1 inline-block align-baseline">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-label={`What does ${String(what)} mean?`}
        className="h-[14px] w-[14px] rounded-full border border-hairline-bright font-mono text-[9px] leading-none text-slate transition-colors hover:border-hazard hover:text-hazard"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-[280px] -translate-x-1/2 border border-hairline-bright bg-raised px-3 py-2.5 text-[12px] font-normal normal-case leading-relaxed tracking-normal text-steel shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}
