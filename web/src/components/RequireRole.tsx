import { Navigate, useLocation } from "react-router-dom"
import { useSession, mayOpen, homeFor } from "@/lib/session"

/**
 * The gate in front of every console screen.
 *
 * Two different refusals, deliberately, because they are different situations:
 *
 *  - Nobody is signed in     -> go and sign in, then come straight back here.
 *  - Signed in, wrong role   -> go to the screen that IS yours. Never a dead end, and
 *                               never a page that tells a customer what they are not
 *                               allowed to see; they simply land on their own hire.
 *
 * This decides what is RENDERED. It is not what protects anything - the server checks
 * the dealer key on every write regardless of which screen asked. A customer who edited
 * this in a console would reach a board with no write buttons that still 401s them.
 */
export default function RequireRole({ children }: { children: React.ReactNode }) {
  const session = useSession()
  const { pathname } = useLocation()

  if (!session) {
    // Carry where they were going, so signing in resumes the journey rather than
    // dumping everyone on the same landing screen.
    return <Navigate to="/signin" state={{ from: pathname }} replace />
  }

  if (!mayOpen(session, pathname)) {
    return <Navigate to={homeFor(session)} replace />
  }

  return <>{children}</>
}
