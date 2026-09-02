/**
 * The annotated machine.
 *
 * Technical line-art of an excavator that draws itself in as the hero is scrubbed, with
 * part callouts attaching on leader lines one at a time — the annotated-hardware language
 * of the reference boards, in the product's own vocabulary.
 *
 * It is driven entirely by a single CSS custom property, --reveal (0 → 1), which the hero
 * writes on every animation frame. No React state, no re-renders: stroke-dashoffset and
 * opacity are computed in CSS from that one variable, so the whole assembly animates on
 * the compositor while the scrub stays at 60fps.
 *
 * The callouts are the seven given rows, not invented copy. EQX1007 really does report a
 * null site, a null operator, zero engine hours and 41 days overdue.
 */

/** Draws a stroke in between `from` and `to` on the reveal timeline. */
function draw(from: number, to: number): React.CSSProperties {
  return {
    strokeDashoffset: `calc(1 - clamp(0, (var(--reveal) - ${from}) / ${to - from}, 1))`,
  }
}

/** Fades a callout in between `from` and `to`. */
function fade(from: number, to: number): React.CSSProperties {
  return {
    opacity: `clamp(0, (var(--reveal) - ${from}) / ${to - from}, 1)`,
  }
}

const HAZARD = "#ffcd11"
const CHALK = "#f2f4f8"
const STEEL = "#9aa5b6"
const CRIT = "#ff5b45"

type Callout = {
  at: number
  label: string
  value: string
  /** leader line: from the part, to the label anchor */
  x1: number; y1: number; x2: number; y2: number
  align: "start" | "end"
  tone?: string
}

const CALLOUTS: Callout[] = [
  { at: 0.30, label: "SITE", value: "NULL", x1: 268, y1: 246, x2: 108, y2: 150, align: "end", tone: CRIT },
  { at: 0.40, label: "OPERATOR", value: "NULL", x1: 300, y1: 262, x2: 108, y2: 196, align: "end", tone: CRIT },
  { at: 0.52, label: "ENGINE HOURS / DAY", value: "0.0", x1: 232, y1: 286, x2: 108, y2: 330, align: "end", tone: CRIT },
  { at: 0.64, label: "IDLE HOURS / DAY", value: "12", x1: 372, y1: 336, x2: 660, y2: 344, align: "start", tone: HAZARD },
  { at: 0.74, label: "DAYS PAST RETURN", value: "41", x1: 636, y1: 214, x2: 690, y2: 138, align: "start", tone: CRIT },
]

export default function MachineReveal({ id = "EQX1007" }: { id?: string }) {
  return (
    <svg
      viewBox="0 0 800 420"
      className="h-auto w-full max-w-[860px]"
      fill="none"
      aria-label={`Technical diagram of ${id} with its flagged fields called out`}
      style={{ overflow: "visible" }}
    >
      {/* ---- measured ground line ------------------------------------------- */}
      <path
        d="M40 372 H760" pathLength={1} stroke="#2a3444" strokeWidth={1}
        strokeDasharray={1} style={draw(0.02, 0.18)}
      />
      {[...Array(13)].map((_, i) => (
        <path
          key={i}
          d={`M${52 + i * 58} 372 V${i % 4 === 0 ? 384 : 379}`}
          pathLength={1} stroke="#2a3444" strokeWidth={1} strokeDasharray={1}
          style={draw(0.02, 0.2)}
        />
      ))}

      {/* ---- undercarriage --------------------------------------------------- */}
      <g stroke={CHALK} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M186 372 h196 a34 34 0 0 0 34-34 v-4 a34 34 0 0 0-34-34 H186 a34 34 0 0 0-34 34 v4 a34 34 0 0 0 34 34 z"
          pathLength={1} strokeDasharray={1} style={draw(0.06, 0.3)}
        />
        {[196, 232, 268, 304, 340, 372].map((cx, i) => (
          <circle
            key={cx} cx={cx} cy={336} r={i === 0 || i === 5 ? 13 : 8}
            pathLength={1} strokeDasharray={1} strokeWidth={1.2}
            style={draw(0.1 + i * 0.012, 0.34 + i * 0.012)}
          />
        ))}
      </g>

      {/* ---- house / cab ------------------------------------------------------ */}
      <g stroke={CHALK} strokeWidth={1.6} strokeLinejoin="round">
        <path
          d="M196 300 V246 a10 10 0 0 1 10-10 h44 l16-30 h48 a10 10 0 0 1 10 10 v84 z"
          pathLength={1} strokeDasharray={1} style={draw(0.12, 0.36)}
        />
        <path
          d="M258 236 l14-26 h38 v26 z"
          pathLength={1} strokeDasharray={1} strokeWidth={1.1} stroke={STEEL}
          style={draw(0.2, 0.4)}
        />
        {/* engine bay hatching - the part the coolant story lives in */}
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i} d={`M${206 + i * 11} 296 l14-26`} pathLength={1} strokeDasharray={1}
            strokeWidth={0.9} stroke={STEEL} style={draw(0.24 + i * 0.02, 0.44 + i * 0.02)}
          />
        ))}
      </g>

      {/* ---- boom, arm, bucket ------------------------------------------------ */}
      <g stroke={CHALK} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M334 268 L470 150 a16 16 0 0 1 24 2 L560 236"
          pathLength={1} strokeDasharray={1} style={draw(0.3, 0.56)}
        />
        <path
          d="M560 236 L618 196" pathLength={1} strokeDasharray={1} style={draw(0.5, 0.64)}
        />
        <path
          d="M618 196 l34 22 -10 34 -40 -8 z"
          pathLength={1} strokeDasharray={1} style={draw(0.58, 0.72)}
        />
        {/* hydraulic rams */}
        <path
          d="M352 286 L438 208 M486 168 L556 226"
          pathLength={1} strokeDasharray={1} strokeWidth={1.1} stroke={STEEL}
          style={draw(0.36, 0.6)}
        />
        {[334, 560, 618].map((cx, i) => (
          <circle
            key={cx} cx={cx} cy={[268, 236, 196][i]} r={5} strokeWidth={1.2} stroke={HAZARD}
            pathLength={1} strokeDasharray={1} style={draw(0.42 + i * 0.04, 0.62 + i * 0.04)}
          />
        ))}
      </g>

      {/* ---- callouts --------------------------------------------------------- */}
      {CALLOUTS.map((c) => {
        const tone = c.tone ?? STEEL
        const anchor = c.align === "end" ? "end" : "start"
        const tx = c.align === "end" ? c.x2 : c.x2
        return (
          <g key={c.label} style={fade(c.at, c.at + 0.09)}>
            <path
              d={`M${c.x1} ${c.y1} L${(c.x1 + c.x2) / 2} ${c.y2} L${c.x2} ${c.y2}`}
              stroke={tone} strokeWidth={0.9} opacity={0.55}
            />
            <circle cx={c.x1} cy={c.y1} r={2.5} fill={tone} />
            <text
              x={tx} y={c.y2 - 12} textAnchor={anchor}
              fill={STEEL} fontFamily="'IBM Plex Mono', monospace"
              fontSize={10} letterSpacing="0.16em"
            >
              {c.label}
            </text>
            <text
              x={tx} y={c.y2 + 12} textAnchor={anchor}
              fill={tone} fontFamily="'IBM Plex Mono', monospace"
              fontSize={22} fontWeight={600} letterSpacing="-0.01em"
            >
              {c.value}
            </text>
          </g>
        )
      })}

      {/* ---- identity plate ---------------------------------------------------- */}
      <g style={fade(0.16, 0.26)}>
        <path d="M40 44 h18 M40 44 v18" stroke={HAZARD} strokeWidth={1.4} />
        <text
          x={40} y={86} fill={CHALK} fontFamily="'IBM Plex Mono', monospace"
          fontSize={30} fontWeight={600} letterSpacing="-0.01em"
        >
          {id}
        </text>
        <text
          x={40} y={106} fill={STEEL} fontFamily="'IBM Plex Mono', monospace"
          fontSize={10} letterSpacing="0.2em"
        >
          EXCAVATOR · 320 GC · ON RENT
        </text>
      </g>
      <g style={fade(0.8, 0.92)}>
        <path d="M760 44 h-18 M760 44 v18" stroke={HAZARD} strokeWidth={1.4} />
        <text
          x={760} y={86} textAnchor="end" fill={CRIT}
          fontFamily="'IBM Plex Mono', monospace" fontSize={30} fontWeight={600}
        >
          4 RULES FIRING
        </text>
        <text
          x={760} y={106} textAnchor="end" fill={STEEL}
          fontFamily="'IBM Plex Mono', monospace" fontSize={10} letterSpacing="0.2em"
        >
          R1 · R3 · R6 · R7
        </text>
      </g>
    </svg>
  )
}
