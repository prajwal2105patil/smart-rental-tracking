import { useEffect, useRef, useState } from "react"

/**
 * The four questions, carried around on a crane.
 *
 * A tower crane slews: the tower stays put and only the jib swings, which is exactly the
 * motion asked for here. Seen from slightly above, that sweep is a circle in plan and an
 * ELLIPSE on screen, so the banner travels wide and near at the front and small and far
 * at the back. That single piece of honesty is what makes it read as a crane rather than
 * a clock hand: everything else — the scale, the fade, the plumb line down to the ground
 * spot, whether the jib passes in front of the tower or behind it — falls out of the
 * same angle.
 *
 * The banner changes at the BACK of the sweep, at theta = 3pi/2, where the lettering has
 * already faded to nothing. The swap is never seen; a new question simply comes round.
 *
 * One rAF loop writes SVG attributes through refs. React owns the words and nothing else,
 * so a re-render cannot fight the animation for the geometry.
 */

export const ANSWERS = [
  {
    n: "01",
    tag: "ANOMALY DETECTION",
    h: "Where is my money leaking?",
    p: "Eight rules of three different kinds — a threshold, a cross-field contradiction, and a predictive trend. Every flag carries the field names, their values, and the threshold crossed.",
  },
  {
    n: "02",
    tag: "AVAILABILITY",
    h: "Can I commit this machine?",
    p: "A customer wants an excavator Monday. Some come back Friday. The engine ranks the whole fleet by when each machine is genuinely free and names one, with a confidence.",
  },
  {
    n: "03",
    tag: "SPN 110 / FMI 0",
    h: "What is about to break?",
    p: "A rolling coolant mean and a least-squares trend, resolving to a real SAE J1939 fault code, the part to replace, and the days of operation left before it fails.",
  },
  {
    n: "04",
    tag: "VALUE LEDGER",
    h: "What did acting on it save?",
    p: "Every action writes an event and a ledger row together. Waste, billable and avoided are kept apart, because adding them produces a number that does not survive a question.",
  },
]

// Plan geometry. A is the jib's reach, B the same circle foreshortened by the viewing
// angle — that ratio is the whole perspective, and nothing else needs to know about it.
const PX = 600, PY = 160      // slew pivot: top of the tower
const A = 300, B = 78         // sweep ellipse
const CJ = 132, CJB = 34      // counter-jib, same ellipse scaled down
const APEX = 92               // A-frame apex, where the tie bars anchor
const MAST_TOP = 172, MAST_FOOT = 582
const RAIL_L = 582, RAIL_R = 618
const GROUND = MAST_FOOT + 26
const CABLE = 54
const BW = 280, BH = 152      // banner half-width, full height
const REVOLUTION_MS = 11_000

const HAZARD = "#ffcd11"
const CHALK = "#f2f4f8"
const STEEL = "#9aa5b6"

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * The crane's whole pose at one slew angle.
 *
 * One function, used twice: the loop calls it per frame, and the JSX renders pose(0) as
 * its static attributes. So the crane is already a correct, legible crane before a single
 * frame has run — on a slow first paint, in a throttled background tab, anywhere
 * requestAnimationFrame is not being served. React never rewrites those attributes
 * afterwards because their JSX values are constants and never change.
 */
function pose(theta: number) {
  const c = Math.cos(theta), s = Math.sin(theta)
  const tx = PX + A * c, ty = PY + B * s
  const wx = PX - CJ * c, wy = PY - CJB * s
  const depth = (s + 1) / 2                       // 0 at the back, 1 at the front
  const scale = 0.62 + 0.38 * depth
  const drop = ty + CABLE * scale

  // The jib tapers from pivot to tip. Offsetting in y rather than truly perpendicular is
  // exact while the jib is horizontal and imperceptible when it is not — because that is
  // precisely when it is most foreshortened.
  const jib = `M${PX},${PY - 7} L${tx},${ty - 3} L${tx},${ty + 3} L${PX},${PY + 7} Z`

  let brace = ""
  for (let k = 0; k < 9; k++) {
    const u0 = k / 9, u1 = (k + 1) / 9
    const x0 = PX + (tx - PX) * u0, y0 = PY + (ty - PY) * u0
    const x1 = PX + (tx - PX) * u1, y1 = PY + (ty - PY) * u1
    const o0 = 7 - 4 * u0, o1 = 7 - 4 * u1
    brace += k % 2
      ? `M${x0},${y0 - o0} L${x1},${y1 + o1} `
      : `M${x0},${y0 + o0} L${x1},${y1 - o1} `
  }

  return {
    jib, brace,
    tie: `M${PX},${APEX} L${PX + (tx - PX) * 0.62},${PY + (ty - PY) * 0.62} M${PX},${APEX} L${wx},${wy}`,
    cjib: `M${PX},${PY} L${wx},${wy}`,
    weightX: wx - 21, weightY: wy - 13,
    trolleyX: tx - 11, trolleyY: ty - 8,
    cable: `M${tx},${ty} L${tx},${drop}`,
    banner: `translate(${tx},${drop}) scale(${scale})`,
    // A surveyor's plumb: the load dropped to the ground plane. It costs two faint marks
    // and is what stops the banner reading as a flat sticker laid on the page.
    plumb: `M${tx},${drop + (BH + 16) * scale} L${tx},${GROUND}`,
    spotR: 30 * scale,
    lit: 0.42 + 0.58 * depth,
    // Lettering is gone well before the swap, and back before it matters.
    legible: clamp01((s + 0.62) / 0.42),
    behind: s < 0,
  }
}

// The pose the crane holds when nothing is animating: jib fully extended to the side,
// where it reads as a crane rather than as a foreshortened stub.
const REST = pose(0)

/** The tower. Drawn twice — once under the rig, once over it — so the jib can pass
 *  behind it. Only one copy is ever visible; the frame loop decides which. */
function Mast() {
  const braces: string[] = []
  for (let y = MAST_TOP; y < MAST_FOOT; y += 41) {
    const end = Math.min(y + 41, MAST_FOOT)
    braces.push(((y - MAST_TOP) / 41) % 2 === 0
      ? `M${RAIL_L},${y} L${RAIL_R},${end}`
      : `M${RAIL_R},${y} L${RAIL_L},${end}`)
  }
  return (
    <g>
      {/* Solid, so the copy drawn last genuinely hides the jib rather than letting it
          show through the lattice. */}
      <path d={`M${RAIL_L},${MAST_TOP - 8} H${RAIL_R} V${MAST_FOOT} H${RAIL_L} Z`}
            fill="var(--color-ground)" />
      <path d={braces.join(" ")} stroke={STEEL} strokeWidth={1} fill="none" />
      <path d={`M${RAIL_L},${MAST_TOP - 8} V${MAST_FOOT} M${RAIL_R},${MAST_TOP - 8} V${MAST_FOOT}`}
            stroke={CHALK} strokeWidth={1.7} fill="none" />
      <path
        d={`M${RAIL_L - 32},${MAST_FOOT} L${RAIL_R + 32},${MAST_FOOT} L${RAIL_R + 54},${GROUND} L${RAIL_L - 54},${GROUND} Z`}
        fill="var(--color-ground)" stroke={CHALK} strokeWidth={1.7} strokeLinejoin="round" />
      <path d={`M420,${GROUND} H780`} stroke={STEEL} strokeWidth={1} />
    </g>
  )
}

export default function CraneMarquee({ facts = [] }: { facts?: string[] }) {
  const [i, setI] = useState(0)
  const [still, setStill] = useState(false)

  // Every animated node. React never writes these attributes, the loop does.
  const jib = useRef<SVGPathElement>(null)
  const brace = useRef<SVGPathElement>(null)
  const tie = useRef<SVGPathElement>(null)
  const cjib = useRef<SVGPathElement>(null)
  const weight = useRef<SVGRectElement>(null)
  const trolley = useRef<SVGRectElement>(null)
  const cable = useRef<SVGPathElement>(null)
  const plumb = useRef<SVGPathElement>(null)
  const spot = useRef<SVGEllipseElement>(null)
  const banner = useRef<SVGGElement>(null)
  const plate = useRef<SVGGElement>(null)
  const words = useRef<SVGGElement>(null)
  const mastBack = useRef<SVGGElement>(null)
  const mastFront = useRef<SVGGElement>(null)

  // The loop reads these; changing one never restarts the effect, so clicking a pip
  // cannot tear down and rebuild the animation.
  const base = useRef(0)
  const spun = useRef(0)   // revolutions completed, accumulated
  const last = useRef(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStill(true); return }

    let raf = 0
    let shown = -1

    const frame = (now: number) => {
      // Accumulated, not now-minus-start: a backgrounded tab stops serving frames, and on
      // return a raw elapsed time would fling the crane through several revolutions and
      // several questions in one frame. Capping the step resumes it where it stopped.
      const step = last.current ? Math.min(now - last.current, 50) : 0
      last.current = now
      spun.current += step / REVOLUTION_MS
      const t = spun.current

      // Start at the back of the sweep, so a revolution both begins and ends where the
      // banner is invisible and the change of question costs nothing to look at.
      const q = pose(Math.PI * 1.5 + t * Math.PI * 2)

      const next = (base.current + Math.floor(t)) % ANSWERS.length
      if (next !== shown) { shown = next; setI(next) }

      jib.current?.setAttribute("d", q.jib)
      brace.current?.setAttribute("d", q.brace)
      tie.current?.setAttribute("d", q.tie)
      cjib.current?.setAttribute("d", q.cjib)
      weight.current?.setAttribute("x", String(q.weightX))
      weight.current?.setAttribute("y", String(q.weightY))
      trolley.current?.setAttribute("x", String(q.trolleyX))
      trolley.current?.setAttribute("y", String(q.trolleyY))
      cable.current?.setAttribute("d", q.cable)
      plumb.current?.setAttribute("d", q.plumb)
      spot.current?.setAttribute("cx", String(q.trolleyX + 11))
      spot.current?.setAttribute("rx", String(q.spotR))
      spot.current?.setAttribute("ry", String(q.spotR / 5))
      banner.current?.setAttribute("transform", q.banner)
      plate.current?.setAttribute("opacity", String(q.lit))
      words.current?.setAttribute("opacity", String(q.legible))

      // Behind the tower for the far half of the sweep: show whichever copy of the mast
      // sits on the correct side of the rig.
      mastFront.current?.setAttribute("opacity", q.behind ? "1" : "0")
      mastBack.current?.setAttribute("opacity", q.behind ? "0" : "1")

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Reduced motion gets the original grid. Nothing is lost, it simply does not move.
  if (still) {
    return (
      <div className="mt-12 grid gap-px bg-hairline sm:grid-cols-2">
        {ANSWERS.map((c, k) => (
          <article key={c.n} className="bg-surface px-8 py-10">
            <div className="flex items-baseline gap-4">
              <span className="num text-[13px] text-hazard">{c.n}</span>
              <span className="label">{c.tag}</span>
            </div>
            <h3 className="mt-4 text-[22px] font-semibold leading-tight tracking-tight text-chalk">
              {c.h}
            </h3>
            <p className="mt-3 max-w-[46ch] text-[14.5px] leading-relaxed text-steel">{c.p}</p>
            {facts[k] && <p className="num mt-4 text-[12.5px] text-hazard">{facts[k]}</p>}
          </article>
        ))}
      </div>
    )
  }

  const a = ANSWERS[i]
  const fact = facts[i]

  return (
    <div className="mt-4">
      <svg
        viewBox="0 60 1200 570"
        className="mx-auto block h-auto w-full max-w-[1100px]"
        role="img"
        aria-label={`Crane carrying the question: ${a.h}`}
      >
        <g ref={mastBack}><Mast /></g>

        <g>
          {/* The slew circle in plan, foreshortened — the path the jib tip runs on. */}
          <ellipse cx={PX} cy={PY} rx={A} ry={B} fill="none"
                   stroke="var(--color-hairline-bright)" strokeWidth={1} strokeDasharray="2 8" />

          {/* A-frame, static: the crane's own outline never moves, only the arm does. */}
          <path d={`M${PX},${APEX} L${RAIL_L + 8},${PY} M${PX},${APEX} L${RAIL_R - 8},${PY}`}
                stroke={STEEL} strokeWidth={1.2} fill="none" />
          <ellipse cx={PX} cy={PY} rx={21} ry={6} fill="none" stroke={STEEL} strokeWidth={1.2} />

          <path ref={tie} d={REST.tie} stroke={STEEL} strokeWidth={1} fill="none" />
          <path ref={cjib} d={REST.cjib} stroke={CHALK} strokeWidth={1.7} fill="none" />
          <rect ref={weight} x={REST.weightX} y={REST.weightY} width={42} height={26}
                fill="var(--color-raised)" stroke={STEEL} strokeWidth={1.2} />

          <path ref={jib} d={REST.jib} fill="var(--color-ground)" stroke={CHALK}
                strokeWidth={1.7} strokeLinejoin="round" />
          <path ref={brace} d={REST.brace} stroke={STEEL} strokeWidth={0.9} fill="none" />

          {/* The load, plumbed down to the ground plane. */}
          <path ref={plumb} d={REST.plumb} stroke={HAZARD} strokeWidth={1}
                strokeDasharray="1 7" opacity={0.22} fill="none" />
          <ellipse ref={spot} cx={PX + A} cy={GROUND} rx={REST.spotR} ry={REST.spotR / 5}
                   fill="none" stroke={HAZARD} strokeWidth={1} opacity={0.3} />

          <rect ref={trolley} x={REST.trolleyX} y={REST.trolleyY} width={22} height={16}
                fill="var(--color-raised)" stroke={HAZARD} strokeWidth={1.4} />
          <path ref={cable} d={REST.cable} stroke={HAZARD} strokeWidth={1.3} fill="none" />

          <g ref={banner} transform={REST.banner}>
            <g ref={plate} opacity={REST.lit}>
              {/* Hangers, so the banner reads as slung from the hook rather than stuck to
                  the end of the cable. */}
              <path d={`M0,0 L${-BW + 44},18 M0,0 L${BW - 44},18`}
                    stroke={HAZARD} strokeWidth={1.1} fill="none" />
              <rect x={-BW} y={16} width={BW * 2} height={BH}
                    fill="var(--color-surface)" stroke={HAZARD} strokeWidth={1.7} />
              {/* Registration ticks, the drawing convention the rest of the page is in. */}
              <path
                d={`M${-BW},38 V16 H${-BW + 22} M${BW},38 V16 H${BW - 22} M${-BW},${16 + BH - 22} V${16 + BH} H${-BW + 22} M${BW},${16 + BH - 22} V${16 + BH} H${BW - 22}`}
                stroke={HAZARD} strokeWidth={3} fill="none" />

              <g ref={words} opacity={REST.legible}>
                <rect x={-BW + 24} y={38} width={38} height={24} fill={HAZARD} />
                <text x={-BW + 43} y={56} textAnchor="middle" fill="var(--color-ground)"
                      style={{ font: '600 15px "IBM Plex Mono", monospace' }}>{a.n}</text>
                <text x={-BW + 76} y={56} fill={STEEL}
                      style={{ font: '400 14px "IBM Plex Mono", monospace', letterSpacing: "2.4px" }}>
                  {a.tag}
                </text>

                <text x={-BW + 24} y={110} fill={CHALK}
                      style={{ font: '600 36px "IBM Plex Sans", system-ui, sans-serif' }}>
                  {a.h}
                </text>

                <path d={`M${-BW + 24},128 H${BW - 24}`} stroke={HAZARD}
                      strokeWidth={1} opacity={0.35} fill="none" />
                <text x={-BW + 24} y={153} fill={HAZARD}
                      style={{ font: '400 16px "IBM Plex Mono", monospace' }}>
                  {fact ?? ""}
                </text>
              </g>
            </g>
          </g>
        </g>

        <g ref={mastFront} opacity={0}><Mast /></g>
      </svg>

      <p key={i} className="rise-in mx-auto max-w-[66ch] text-center text-[15px] leading-relaxed text-steel">
        {a.p}
      </p>

      <div className="mt-8 flex items-center justify-center gap-2">
        {ANSWERS.map((c, k) => (
          <button
            key={c.n}
            onClick={() => {
              // Restart the sweep from the back on the chosen question, so it rises into
              // view the same way it would have on its own.
              base.current = k
              spun.current = 0
              setI(k)
            }}
            aria-label={c.h}
            aria-current={k === i}
            className={`h-[3px] w-14 transition-colors ${
              k === i ? "bg-hazard" : "bg-hairline-bright hover:bg-steel"
            }`}
          />
        ))}
      </div>

      {/* Everything the animation says, for anyone who cannot watch it go round. */}
      <ul className="sr-only">
        {ANSWERS.map((c, k) => <li key={c.n}>{c.tag}. {c.h} {c.p} {facts[k] ?? ""}</li>)}
      </ul>
    </div>
  )
}
