import type { TelemetryPoint } from "@/lib/types"

/**
 * Coolant trend. Not a decorative sparkline - the warning threshold and the
 * failure threshold are drawn on it, so the reader sees the verdict, not a wiggle.
 */
export default function TempSparkline({
  points, warn, failure, height = 96,
}: { points: TelemetryPoint[]; warn: number; failure: number; height?: number }) {
  if (points.length < 2) {
    return <div className="label py-6 text-center">no telemetry for this machine</div>
  }
  const w = 640, h = height, pad = 6
  const temps = points.map(p => p.coolant_temp_c)
  const lo = Math.min(...temps, warn) - 3
  const hi = Math.max(...temps, failure) + 2
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2)
  const y = (t: number) => pad + (1 - (t - lo) / (hi - lo)) * (h - pad * 2)

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.coolant_temp_c).toFixed(1)}`).join(" ")
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - pad} L${pad},${h - pad} Z`
  const last = points[points.length - 1]

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" preserveAspectRatio="none" role="img"
           aria-label={`Coolant temperature trend, latest ${last.coolant_temp_c} degrees`}>
        <defs>
          <linearGradient id="ct-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff5b45" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#ff5b45" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad} x2={w - pad} y1={y(failure)} y2={y(failure)}
              stroke="#ff5b45" strokeWidth="1" strokeDasharray="3 4" opacity="0.75" />
        <line x1={pad} x2={w - pad} y1={y(warn)} y2={y(warn)}
              stroke="#ffab2e" strokeWidth="1" strokeDasharray="3 4" opacity="0.6" />
        <path d={area} fill="url(#ct-fill)" />
        <path d={line} fill="none" stroke="#ff5b45" strokeWidth="1.75"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(last.coolant_temp_c)} r="3.5" fill="#ff5b45" />
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="label">
          <span className="text-critical">— failure {failure}&deg;C</span>
          <span className="ml-3 text-warning">— warn {warn}&deg;C</span>
        </span>
        <span className="num text-[12px] text-steel">
          latest <span className="text-critical">{last.coolant_temp_c.toFixed(1)}&deg;C</span>
          <span className="ml-2 text-slate">{points.length} days</span>
        </span>
      </div>
    </div>
  )
}
