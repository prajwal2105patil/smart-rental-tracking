/**
 * The dismantling reveal.
 *
 * As the hero is scrubbed the machine comes apart along its real assembly axes, and each
 * separated component carries the telemetry that component actually emits. Taking the
 * machine apart IS the product thesis: we can see inside your equipment.
 *
 * HOW IT MOVES — and why it stays at 60fps.
 * The hero writes one CSS custom property, --reveal (0 to 1), on the section once per
 * animation frame. Every part below derives its own transform from that single value in
 * calc(), so the browser animates `transform` only: no layout, no paint, no React render
 * per frame, and no per-element JavaScript at all. The work happens on the compositor.
 *
 * Each part has its own window on the timeline, so the machine peels apart in stages
 * rather than exploding at once:
 *
 *     p = clamp(0, (reveal - from) / (to - from), 1)
 *
 * RESPONSIVE.
 * --burst scales every displacement vector from one place. On a narrow screen the parts
 * would fly off-canvas at full travel, so the caller drops it to about half and the
 * secondary callouts are hidden. The viewBox does the rest.
 *
 * REDUCED MOTION is handled upstream: the hero jumps --reveal straight to 1, so this
 * renders as a static exploded diagram with every label in place.
 */

const HAZARD = "#ffcd11"
const CHALK = "#f2f4f8"
const STEEL = "#9aa5b6"
const CRIT = "#ff5b45"
const GLASS = "rgba(160,196,224,0.10)"

/** A part's motion: its window on the timeline, its travel vector, its rotation. */
function part(from: number, to: number, dx: number, dy: number, rot = 0): React.CSSProperties {
  const p = `clamp(0, (var(--reveal, 0) - ${from}) / ${to - from}, 1)`
  return {
    transform:
      `translate(calc(${p} * ${dx} * var(--burst, 1) * 1px),` +
      ` calc(${p} * ${dy} * var(--burst, 1) * 1px))` +
      ` rotate(calc(${p} * ${rot} * 1deg))`,
    transformBox: "fill-box",
    transformOrigin: "center",
    willChange: "transform",
  }
}

/** Glass fill fades in as a part separates, so the assembly turns x-ray as it opens. */
function xray(from: number, to: number): React.CSSProperties {
  return { opacity: `clamp(0, (var(--reveal, 0) - ${from}) / ${to - from}, 1)` }
}

/** Labels and leader lines arrive last, once their part has finished travelling. */
function fade(from: number, to: number): React.CSSProperties {
  return { opacity: `clamp(0, (var(--reveal, 0) - ${from}) / ${to - from}, 1)` }
}

type Tag = {
  at: number
  label: string
  value: string
  x: number; y: number
  anchor: "start" | "end"
  tone?: string
  /** hidden on small screens to stop the callouts colliding */
  secondary?: boolean
}

const TAGS: Tag[] = [
  { at: 0.80, label: "ENGINE COOLANT", value: "111.5 °C", x: 250, y: 120, anchor: "end", tone: CRIT },
  { at: 0.84, label: "FAULT", value: "SPN 110 / FMI 0", x: 250, y: 176, anchor: "end", tone: CRIT },
  { at: 0.88, label: "OPERATOR", value: "NULL", x: 660, y: 96, anchor: "start", tone: CRIT, secondary: true },
  { at: 0.91, label: "SITE", value: "NULL", x: 660, y: 152, anchor: "start", tone: CRIT, secondary: true },
  { at: 0.94, label: "IDLE HOURS / DAY", value: "12", x: 660, y: 430, anchor: "start", tone: HAZARD },
]

export default function MachineExploded({
  id = "EQX1007",
  compact = false,
}: { id?: string; compact?: boolean }) {
  const stroke = { stroke: CHALK, strokeWidth: 1.6, fill: "none", strokeLinejoin: "round" as const }
  const thin = { stroke: STEEL, strokeWidth: 1, fill: "none" }

  return (
    <svg
      viewBox="0 0 900 520"
      className="h-auto w-full"
      style={{ ["--burst" as string]: compact ? 0.5 : 1, overflow: "visible" }}
      role="img"
      aria-label={`${id} shown as an exploded assembly with its telemetry annotated`}
    >
      {/* ---- ground datum -------------------------------------------------- */}
      <g style={fade(0.02, 0.14)}>
        <path d="M90 470 H810" stroke="#2a3444" strokeWidth={1} />
        {Array.from({ length: 13 }, (_, i) => (
          <path key={i} d={`M${104 + i * 58} 470 V${i % 4 === 0 ? 482 : 476}`}
                stroke="#2a3444" strokeWidth={1} />
        ))}
      </g>

      {/* ================= UNDERCARRIAGE — drops away last ==================== */}
      <g style={part(0.56, 0.80, 0, 78)}>
        <path
          d="M250 452 h250 a40 40 0 0 0 40-40 v-6 a40 40 0 0 0-40-40 H250 a40 40 0 0 0-40 40 v6 a40 40 0 0 0 40 40 z"
          {...stroke}
        />
        <path
          d="M250 452 h250 a40 40 0 0 0 40-40 v-6 a40 40 0 0 0-40-40 H250 a40 40 0 0 0-40 40 v6 a40 40 0 0 0 40 40 z"
          fill={GLASS} stroke="none" style={xray(0.58, 0.78)}
        />
      </g>

      {/* rollers spread down-left out of the track frame */}
      {[262, 300, 338, 376, 414, 452, 490].map((cx, i) => (
        <g key={cx} style={part(0.62, 0.88, -18 - i * 9, 96 + (i % 2) * 14)}>
          <circle cx={cx} cy={412} r={i === 0 || i === 6 ? 15 : 9} {...thin} strokeWidth={1.2} />
          <circle cx={cx} cy={412} r={i === 0 || i === 6 ? 15 : 9} fill={GLASS} stroke="none"
                  style={xray(0.64, 0.86)} />
        </g>
      ))}

      {/* ================= HOUSE / TURNTABLE ================================== */}
      <g style={part(0.44, 0.68, 0, -46)}>
        <path d="M258 372 V330 a10 10 0 0 1 10-10 h214 a10 10 0 0 1 10 10 v42 z" {...stroke} />
        <path d="M258 372 V330 a10 10 0 0 1 10-10 h214 a10 10 0 0 1 10 10 v42 z"
              fill={GLASS} stroke="none" style={xray(0.46, 0.66)} />
      </g>

      {/* counterweight slides back-left */}
      <g style={part(0.40, 0.64, -118, -18, -6)}>
        <path d="M258 330 h-46 a8 8 0 0 0-8 8 v30 a8 8 0 0 0 8 8 h46 z" {...stroke} />
        <path d="M258 330 h-46 a8 8 0 0 0-8 8 v30 a8 8 0 0 0 8 8 h46 z"
              fill={GLASS} stroke="none" style={xray(0.42, 0.62)} />
      </g>

      {/* ================= ENGINE BAY — the reason any of this matters ======== */}
      {/* Revealed by the cab lifting off; it is the part the coolant rule reads. */}
      <g style={part(0.50, 0.74, -74, -104)}>
        <rect x="272" y="270" width="96" height="52" rx="4" {...stroke} />
        <rect x="272" y="270" width="96" height="52" rx="4" fill="rgba(255,91,69,0.12)"
              stroke="none" style={xray(0.52, 0.72)} />
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M${282 + i * 18} 278 v36`} stroke={CRIT} strokeWidth={1.1}
                opacity={0.75} />
        ))}
        {/* coolant circuit */}
        <path d="M272 296 h-18 a8 8 0 0 0-8 8 v14" {...thin} stroke={CRIT} />
        <path d="M368 296 h18 a8 8 0 0 1 8 8 v14" {...thin} stroke={CRIT} />
      </g>

      {/* ================= CAB — lifts up and left ============================ */}
      <g style={part(0.34, 0.60, -46, -152, -5)}>
        <path d="M282 320 V268 a10 10 0 0 1 10-10 h40 l16-30 h44 a10 10 0 0 1 10 10 v82 z" {...stroke} />
        <path d="M282 320 V268 a10 10 0 0 1 10-10 h40 l16-30 h44 a10 10 0 0 1 10 10 v82 z"
              fill={GLASS} stroke="none" style={xray(0.36, 0.58)} />
        <path d="M340 258 l14-26 h34 v26 z" {...thin} />
      </g>

      {/* ================= BOOM ============================================== */}
      <g style={part(0.24, 0.50, 26, -118, -7)}>
        <path d="M418 336 L556 214 a16 16 0 0 1 24 2 L646 300" {...stroke} strokeWidth={1.8}
              strokeLinecap="round" />
        <circle cx={418} cy={336} r={6} stroke={HAZARD} strokeWidth={1.3} fill="none" />
      </g>

      {/* hydraulic rams spread outward */}
      <g style={part(0.28, 0.54, 62, -150, 10)}>
        <path d="M436 352 L524 272" {...thin} strokeWidth={1.2} strokeLinecap="round" />
        <path d="M572 232 L642 292" {...thin} strokeWidth={1.2} strokeLinecap="round" />
      </g>

      {/* ================= ARM ================================================ */}
      <g style={part(0.18, 0.44, 96, -74, 12)}>
        <path d="M646 300 L706 258" {...stroke} strokeWidth={1.8} strokeLinecap="round" />
        <circle cx={646} cy={300} r={5} stroke={HAZARD} strokeWidth={1.2} fill="none" />
      </g>

      {/* ================= BUCKET — first to go ============================== */}
      <g style={part(0.12, 0.36, 124, 92, 26)}>
        <path d="M706 258 l36 24 -12 38 -44 -10 z" {...stroke} strokeWidth={1.8} />
        <path d="M706 258 l36 24 -12 38 -44 -10 z" fill={GLASS} stroke="none"
              style={xray(0.14, 0.34)} />
        <circle cx={706} cy={258} r={5} stroke={HAZARD} strokeWidth={1.2} fill="none" />
      </g>

      {/* ================= ANNOTATION ========================================= */}
      {TAGS.filter((t) => !(compact && t.secondary)).map((t) => (
        <g key={t.label} style={fade(t.at, t.at + 0.06)}>
          <circle cx={t.anchor === "end" ? t.x + 84 : t.x - 84} cy={t.y + 6} r={2.5}
                  fill={t.tone ?? STEEL} />
          <path d={`M${t.anchor === "end" ? t.x + 84 : t.x - 84} ${t.y + 6} H${t.x}`}
                stroke={t.tone ?? STEEL} strokeWidth={0.9} opacity={0.5} />
          <text x={t.x} y={t.y} textAnchor={t.anchor} fill={STEEL}
                fontFamily="'IBM Plex Mono', monospace" fontSize={10} letterSpacing="0.16em">
            {t.label}
          </text>
          <text x={t.x} y={t.y + 24} textAnchor={t.anchor} fill={t.tone ?? CHALK}
                fontFamily="'IBM Plex Mono', monospace" fontSize={21} fontWeight={600}>
            {t.value}
          </text>
        </g>
      ))}

      {/* identity plate */}
      <g style={fade(0.10, 0.20)}>
        <path d="M64 48 h18 M64 48 v18" stroke={HAZARD} strokeWidth={1.4} />
        <text x={64} y={90} fill={CHALK} fontFamily="'IBM Plex Mono', monospace"
              fontSize={28} fontWeight={600}>{id}</text>
        <text x={64} y={110} fill={STEEL} fontFamily="'IBM Plex Mono', monospace"
              fontSize={10} letterSpacing="0.2em">EXCAVATOR · 320 GC</text>
      </g>
      <g style={fade(0.88, 0.97)}>
        <text x={836} y={90} textAnchor="end" fill={CRIT}
              fontFamily="'IBM Plex Mono', monospace" fontSize={26} fontWeight={600}>
          4 RULES FIRING
        </text>
        <text x={836} y={110} textAnchor="end" fill={STEEL}
              fontFamily="'IBM Plex Mono', monospace" fontSize={10} letterSpacing="0.2em">
          R1 · R3 · R6 · R7
        </text>
      </g>
    </svg>
  )
}
