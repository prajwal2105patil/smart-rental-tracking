/**
 * A drawn machine, by type.
 *
 * Four silhouettes rather than one generic shape: a crane that looks like an excavator
 * tells the operator nothing, and the whole point of the panel is instant recognition.
 * Line art in the console's own weight, so it sits beside the plot rather than on it.
 */

const CHALK = "#f2f4f8"
const STEEL = "#9aa5b6"

export default function MachineSilhouette({
  type, tone = CHALK, className,
}: { type: string; tone?: string; className?: string }) {
  const stroke = { stroke: tone, strokeWidth: 1.6, fill: "none", strokeLinejoin: "round" as const }
  const thin = { stroke: STEEL, strokeWidth: 1.1, fill: "none" }

  const body = () => {
    switch (type) {
      case "Bulldozer":
        return (
          <>
            {/* blade */}
            <path d="M34 96 q-8 -22 2 -40 l14 4 q-8 16 -2 34 z" {...stroke} />
            {/* hull */}
            <path d="M56 96 V70 a6 6 0 0 1 6-6 h44 l14-20 h34 a6 6 0 0 1 6 6 v46 z" {...stroke} />
            {/* cab glazing */}
            <path d="M112 64 l12 -17 h24 v17 z" {...thin} />
            {/* track frame */}
            <path d="M54 98 h116 a20 20 0 0 1 0 30 H54 a20 20 0 0 1 0 -30 z" {...stroke} />
            {[70, 92, 114, 136, 156].map((x, i) => (
              <circle key={x} cx={x} cy={113} r={i === 0 || i === 4 ? 10 : 6} {...thin} />
            ))}
          </>
        )
      case "Crane":
        return (
          <>
            {/* carrier */}
            <path d="M40 112 h130 a8 8 0 0 1 8 8 v10 H32 v-10 a8 8 0 0 1 8 -8 z" {...stroke} />
            {[56, 84, 128, 158].map((x) => <circle key={x} cx={x} cy={132} r={9} {...thin} />)}
            {/* house */}
            <path d="M48 112 V86 a6 6 0 0 1 6 -6 h40 a6 6 0 0 1 6 6 v26 z" {...stroke} />
            {/* lattice boom */}
            <path d="M96 88 L182 22" {...stroke} />
            <path d="M104 96 L190 30" {...stroke} />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <path key={i} d={`M${100 + i * 15} ${92 - i * 11.5} l6 6`} {...thin} />
            ))}
            {/* hook line */}
            <path d="M186 26 V64" {...thin} />
            <path d="M181 64 h10 v8 h-10 z" {...stroke} />
          </>
        )
      case "Grader":
        return (
          <>
            {/* long frame */}
            <path d="M30 104 H176" {...stroke} />
            {/* cab */}
            <path d="M120 104 V72 a6 6 0 0 1 6 -6 h30 a6 6 0 0 1 6 6 v32 z" {...stroke} />
            <path d="M126 72 h24 v-6 h-24 z" {...thin} />
            {/* engine deck */}
            <path d="M162 104 V84 h16 v20 z" {...thin} />
            {/* mouldboard */}
            <path d="M62 104 l30 -12 v10 l-30 12 z" {...stroke} />
            {/* wheels */}
            <circle cx={44} cy={116} r={13} {...stroke} />
            <circle cx={140} cy={116} r={13} {...stroke} />
            <circle cx={168} cy={116} r={13} {...stroke} />
          </>
        )
      default: // Excavator
        return (
          <>
            {/* undercarriage */}
            <path d="M44 112 h108 a18 18 0 0 1 0 30 H44 a18 18 0 0 1 0 -30 z" {...stroke} />
            {[58, 80, 100, 120, 140].map((x, i) => (
              <circle key={x} cx={x} cy={127} r={i === 0 || i === 4 ? 9 : 5.5} {...thin} />
            ))}
            {/* house + cab */}
            <path d="M52 112 V80 a6 6 0 0 1 6 -6 h26 l10 -18 h26 a6 6 0 0 1 6 6 v50 z" {...stroke} />
            <path d="M88 74 l9 -17 h22 v17 z" {...thin} />
            {/* boom, arm, bucket */}
            <path d="M126 96 L172 50 a9 9 0 0 1 13 1 L206 82" {...stroke} />
            <path d="M206 82 L228 66" {...stroke} />
            <path d="M228 66 l14 10 -5 15 -17 -4 z" {...stroke} />
            <path d="M134 104 L166 76" {...thin} />
          </>
        )
    }
  }

  return (
    <svg viewBox="0 0 260 152" className={className} fill="none" role="img"
         aria-label={`${type} illustration`}>
      {body()}
    </svg>
  )
}
