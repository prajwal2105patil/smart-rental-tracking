import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { AskAnswer } from "@/lib/types"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Ask the briefing a question.
 *
 * It sits inside the morning briefing on purpose: the briefing answers the six questions
 * we decided a dealer asks, and this answers the seventh — whatever they actually wanted
 * to know. Same data, same figures, one box.
 *
 * Three things are deliberate and worth defending out loud:
 *
 *  - THE API KEY IS NOT HERE. The browser calls our own /ask; the key lives in a server
 *    environment variable. A VITE_* variable would be compiled into this bundle in
 *    plaintext and published with the site.
 *  - COMMON QUESTIONS NEVER LEAVE THE BUILDING. The server answers them deterministically
 *    from the live figures, so the demo does not depend on an outbound call on venue wifi.
 *    The badge says which path answered.
 *  - EVERY ANSWER SHOWS ITS WORKING. `grounded_on` lists the exact figures behind the
 *    sentence, and any number the model asserts that is not in the data it was given is
 *    flagged rather than shown as fact.
 */

type Turn = { q: string; a?: AskAnswer; error?: string }

export default function BriefingAssistant() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const { data: meta } = useQuery({
    queryKey: ["assistant-suggestions"],
    queryFn: api.suggestions,
    refetchInterval: false,
  })

  async function ask(question: string) {
    const text = question.trim()
    // Ref, not state: two fast Enters would both pass a state check before React
    // re-rendered, and the same question would be asked twice.
    if (!text || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setQ("")
    setTurns((t) => [...t, { q: text }])
    try {
      const a = await api.ask(text)
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, a } : turn)))
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not reach the assistant"
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: message } : turn)))
    } finally {
      setBusy(false)
      inFlight.current = false
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6, behavior: "smooth" }))
    }
  }

  const suggestions = meta?.suggestions ?? []

  return (
    // Sits beside the briefing lines, so it is a column that fills its height rather
    // than a band across the bottom. The parent owns the divider.
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-5">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] text-steel">
          Ask the briefing
        </h4>
        <span className="label">
          {meta?.model_available ? "grounded in the figures" : "offline mode"}
        </span>
      </header>

      {turns.length > 0 && (
        <div ref={listRef} className="mt-3 max-h-[300px] flex-1 overflow-y-auto px-5">
          <div className="flex flex-col gap-4">
            {turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-2">
                <p className="flex gap-2.5 text-[13.5px] text-chalk">
                  <span className="label mt-[3px] shrink-0">you</span>
                  <span>{t.q}</span>
                </p>

                {!t.a && !t.error && (
                  <p className="label pl-9">checking the board…</p>
                )}

                {t.error && (
                  <p className="border-l-2 border-l-critical bg-critical/[0.06] px-3 py-2 text-[12.5px] text-critical">
                    {t.error}
                  </p>
                )}

                {t.a && (
                  <div className={cn("border-l-2 px-3 py-2.5",
                    t.a.checked ? "border-l-hazard bg-hazard/[0.05]"
                                : "border-l-warning bg-warning/[0.07]")}>
                    <p className="text-[13.5px] leading-relaxed text-chalk">{t.a.answer}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className={cn(
                        "border px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-[0.12em] uppercase",
                        t.a.source === "rules"
                          ? "border-nominal/50 text-nominal"
                          : t.a.source === "model"
                            ? "border-info/50 text-info"
                            : "border-slate/50 text-slate",
                      )}>
                        {t.a.source === "rules" ? "from the rules"
                          : t.a.source === "model" ? "phrased by model" : "no data"}
                      </span>

                      {t.a.grounded_on.map((g) => (
                        <span key={g} className="num text-[11px] text-slate">{g}</span>
                      ))}
                    </div>

                    {!t.a.checked && (
                      <p className="mt-2 border-t border-warning/30 pt-2 text-[11.5px] leading-relaxed text-warning">
                        This answer contains a figure the console cannot verify
                        {t.a.unverified?.length ? ` (${t.a.unverified.join(", ")})` : ""}.
                        Check it against the board before acting on it.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {turns.length === 0 && suggestions.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 px-5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="border border-hairline-bright px-2.5 py-1.5 text-left text-[12px] text-steel transition-colors hover:border-hazard hover:text-chalk"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); ask(q) }}
        className="mt-auto flex gap-2 border-t border-hairline px-5 py-3"
      >
        <label htmlFor="ask-fleet" className="sr-only">Ask a question about the fleet</label>
        <input
          id="ask-fleet"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="How many machines are rented out?"
          className="w-full border border-hairline bg-ground px-3 py-2 text-[13.5px] text-chalk outline-none placeholder:text-slate focus:border-hazard"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="shrink-0 bg-hazard px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  )
}
