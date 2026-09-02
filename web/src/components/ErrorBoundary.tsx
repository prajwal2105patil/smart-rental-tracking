import { Component, type ErrorInfo, type ReactNode } from "react"

/**
 * One uncaught render error used to take the entire console to a blank screen with no
 * message and no way back — it happened once already, when a synchronous throw in the
 * scan page's unmount tore down the tree. On a projector that is unrecoverable without
 * the presenter noticing and reloading.
 *
 * This is the floor: whatever breaks, the operator still sees what happened and can get
 * back to work in one click.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No crash-reporting service is wired up, so the console is the record. Keep the
    // component stack: it is the only thing that says which screen died.
    console.error("[console] render error", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="mx-auto max-w-[640px] border border-critical/40 bg-critical/[0.07] px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-critical">
          {this.props.label ?? "Console"} stopped responding
        </p>
        <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-chalk">
          Something on this screen failed to render.
        </h2>
        <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-steel">
          The rest of the system is unaffected — the API, the rules and the event log are
          untouched. Reload to continue, or go back to the fleet board.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={() => window.location.reload()}
            className="border border-hazard bg-hazard px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ground"
          >
            Reload
          </button>
          <a
            href="/fleet"
            className="border border-hairline-bright px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-chalk hover:border-hazard hover:text-hazard"
          >
            Fleet board
          </a>
        </div>

        <details className="mt-5">
          <summary className="label cursor-pointer">technical detail</summary>
          <pre className="mt-2 overflow-x-auto border border-hairline bg-ground px-3 py-2 font-mono text-[11px] text-steel">
            {error.message}
          </pre>
        </details>
      </div>
    )
  }
}
