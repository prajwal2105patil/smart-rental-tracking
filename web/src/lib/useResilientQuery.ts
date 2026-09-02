import { useEffect, useState } from "react"
import { useQuery, type QueryKey } from "@tanstack/react-query"

/**
 * A polling query that can hold a stable failure.
 *
 * The problem this exists to solve, measured rather than assumed: with a plain
 * `refetchInterval`, a query that has no data yet flips its status back to `pending`
 * every time the interval fires. So when the API is unreachable the screen oscillates —
 * "reading EQX1007…" → "could not load" → "reading EQX1007…" — on a three-second cycle,
 * and neither `isError` nor `error` is stable enough to branch on. The operator cannot
 * tell whether the app is working or broken, which is the worst failure mode there is.
 *
 * So the failure is latched here, outside React Query's state machine:
 *   - once a fetch fails, `failed` stays true and polling stops entirely
 *   - it clears only on a real success, or when the user presses Retry
 *
 * `retry()` resumes polling and refetches, so the recovery path is one click.
 */
export function useResilientQuery<T>(
  key: QueryKey,
  fn: () => Promise<T>,
  opts: { pollMs?: number | false } = {},
) {
  const { pollMs = 5000 } = opts
  const [failed, setFailed] = useState<Error | null>(null)

  const query = useQuery({
    queryKey: key,
    queryFn: fn,
    // Stop hammering an endpoint that is already known to be down. It also stops the
    // status oscillation that made the error state unreadable.
    refetchInterval: failed || pollMs === false ? false : pollMs,
  })

  useEffect(() => {
    if (query.error) setFailed(query.error as Error)
    else if (query.data !== undefined) setFailed(null)
  }, [query.error, query.data])

  return {
    data: query.data,
    /** Stable across refetches — safe to branch on. */
    error: failed,
    /** True only while genuinely waiting with nothing to show and nothing failed. */
    isLoading: !failed && query.data === undefined,
    retry: () => {
      setFailed(null)
      return query.refetch()
    },
  }
}
