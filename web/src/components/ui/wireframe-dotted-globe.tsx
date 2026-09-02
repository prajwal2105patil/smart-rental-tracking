"use client"

import { useEffect, useRef, useState } from "react"
import { geoOrthographic, geoPath, geoGraticule, geoBounds, geoDistance } from "d3-geo"
import { timer, type Timer } from "d3-timer"

/**
 * Wireframe dotted globe, carrying the live fleet.
 *
 * Adapted from the supplied component. Four deliberate changes, each for a reason:
 *
 *  1. LAND DATA IS BUNDLED, not fetched from raw.githubusercontent.com at runtime. On
 *     venue wifi an external CDN is a single point of failure for the opening screen,
 *     and a globe with no continents is worse than no globe.
 *  2. d3-geo + d3-timer instead of the whole of d3 — the same five functions, a fraction
 *     of the bundle.
 *  3. The palette comes from the console's own tokens, not hardcoded #ffffff on #000000,
 *     so the globe belongs to the product rather than sitting on top of it.
 *  4. It plots MACHINES. A rotating earth is decoration; a rotating earth with your
 *     overdue excavator on it is the product. Back-facing machines are hidden by true
 *     angular distance from the projection centre, so a marker never bleeds through the
 *     far side of the sphere.
 */

export interface GlobeMarker {
  id: string
  lat: number
  lon: number
  tone: string
  label: string
  detail: string
  emphasis?: boolean
}

interface RotatingEarthProps {
  width?: number
  height?: number
  className?: string
  markers?: GlobeMarker[]
  /** Longitude/latitude the globe settles on, e.g. India. */
  focus?: [number, number]
  onMarkerHover?: (id: string | null) => void
}

const OCEAN = "#080c14"
const LAND_LINE = "#3a4658"
const DOT = "#4d5c72"
const RIM = "#6e8098"
const GRID = "#232c3a"

export default function RotatingEarth({
  width = 760,
  height = 560,
  className = "",
  markers = [],
  focus = [78, 22],
  onMarkerHover,
}: RotatingEarthProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(0)
  const [hovered, setHovered] = useState<GlobeMarker | null>(null)
  const [spinning, setSpinning] = useState(true)

  // Live refs so the render loop always sees current props without re-running the effect.
  const markersRef = useRef(markers)
  markersRef.current = markers
  const spinRef = useRef(spinning)
  spinRef.current = spinning
  const focusRef = useRef(focus)
  focusRef.current = focus

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const context = canvas.getContext("2d")
    if (!context) return

    let containerWidth = Math.min(width, wrap.clientWidth || width)
    let containerHeight = Math.min(height, Math.round(containerWidth * 0.74))
    let radius = Math.min(containerWidth, containerHeight) / 2.35

    const projection = geoOrthographic().clipAngle(90)
    const path = geoPath().projection(projection).context(context)
    const graticule = geoGraticule()

    function size() {
      containerWidth = Math.max(280, Math.min(width, wrap!.clientWidth || width))
      containerHeight = Math.min(height, Math.round(containerWidth * 0.74))
      radius = Math.min(containerWidth, containerHeight) / 2.35
      const dpr = window.devicePixelRatio || 1
      canvas!.width = containerWidth * dpr
      canvas!.height = containerHeight * dpr
      canvas!.style.width = `${containerWidth}px`
      canvas!.style.height = `${containerHeight}px`
      context!.setTransform(dpr, 0, 0, dpr, 0, 0)
      projection.scale(radius).translate([containerWidth / 2, containerHeight / 2])
    }
    size()

    // ---- halftone dots over land ------------------------------------------
    const pointInRing = (p: [number, number], ring: number[][]) => {
      const [x, y] = p
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }
    const inFeature = (p: [number, number], f: any): boolean => {
      const g = f.geometry
      const polys = g.type === "Polygon" ? [g.coordinates]
        : g.type === "MultiPolygon" ? g.coordinates : []
      for (const poly of polys) {
        if (!pointInRing(p, poly[0])) continue
        let hole = false
        for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) { hole = true; break }
        if (!hole) return true
      }
      return false
    }

    let land: any = null
    const dots: [number, number][] = []
    let rafId: Timer | null = null
    const rotation: [number, number] = [-focusRef.current[0], -focusRef.current[1]]
    let disposed = false

    function render() {
      if (disposed) return
      context!.clearRect(0, 0, containerWidth, containerHeight)
      const cx = containerWidth / 2
      const cy = containerHeight / 2
      const scaleFactor = projection.scale() / radius

      // sphere
      context!.beginPath()
      context!.arc(cx, cy, projection.scale(), 0, 2 * Math.PI)
      context!.fillStyle = OCEAN
      context!.fill()
      context!.lineWidth = 1.4 * scaleFactor
      context!.strokeStyle = RIM
      context!.stroke()

      if (land) {
        context!.beginPath()
        path(graticule())
        context!.strokeStyle = GRID
        context!.lineWidth = 1
        context!.stroke()

        context!.beginPath()
        land.features.forEach((f: any) => path(f))
        context!.strokeStyle = LAND_LINE
        context!.lineWidth = 1 * scaleFactor
        context!.stroke()

        const centre: [number, number] = [-rotation[0], -rotation[1]]
        context!.fillStyle = DOT
        for (const d of dots) {
          if (geoDistance(d, centre) > Math.PI / 2) continue
          const p = projection(d)
          if (!p) continue
          context!.beginPath()
          context!.arc(p[0], p[1], 1.1 * scaleFactor, 0, 2 * Math.PI)
          context!.fill()
        }

        // ---- the fleet -----------------------------------------------------
        const centreLL: [number, number] = [-rotation[0], -rotation[1]]
        let shown = 0
        for (const m of markersRef.current) {
          if (geoDistance([m.lon, m.lat], centreLL) > Math.PI / 2) continue
          const p = projection([m.lon, m.lat])
          if (!p) continue
          shown++
          if (m.emphasis) {
            context!.beginPath()
            context!.arc(p[0], p[1], 11 * scaleFactor, 0, 2 * Math.PI)
            context!.fillStyle = m.tone
            context!.globalAlpha = 0.16
            context!.fill()
            context!.globalAlpha = 1
          }
          context!.beginPath()
          context!.arc(p[0], p[1], 4.2 * scaleFactor, 0, 2 * Math.PI)
          context!.fillStyle = m.tone
          context!.fill()
          // surface ring keeps overlapping machines countable
          context!.lineWidth = 1.6 * scaleFactor
          context!.strokeStyle = OCEAN
          context!.stroke()
        }
        if (shown !== visibleCount) setVisibleCount(shown)
      }
    }

    async function load() {
      try {
        setIsLoading(true)
        // Served from our own origin — no external dependency at demo time.
        const res = await fetch("/ne_110m_land.json")
        if (!res.ok) throw new Error(`land data ${res.status}`)
        const type = res.headers.get("content-type") ?? ""
        if (!type.includes("json")) throw new Error("land data missing")
        land = await res.json()

        for (const f of land.features) {
          const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(f)
          const step = 1.5
          for (let lng = minLng; lng <= maxLng; lng += step) {
            for (let lat = minLat; lat <= maxLat; lat += step) {
              if (inFeature([lng, lat], f)) dots.push([lng, lat])
            }
          }
        }
        projection.rotate(rotation)
        render()
        setIsLoading(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not load the map")
        setIsLoading(false)
      }
    }

    rafId = timer(() => {
      if (spinRef.current) {
        rotation[0] += 0.16
        projection.rotate(rotation)
        render()
      }
    })

    // ---- interaction -------------------------------------------------------
    const toLL = (ev: MouseEvent): [number, number] | null => {
      const r = canvas!.getBoundingClientRect()
      const inv = projection.invert?.([ev.clientX - r.left, ev.clientY - r.top])
      return inv ? [inv[0], inv[1]] : null
    }

    let dragging = false
    const onDown = (ev: MouseEvent) => {
      dragging = true
      setSpinning(false)
      const sx = ev.clientX, sy = ev.clientY
      const start: [number, number] = [rotation[0], rotation[1]]
      const move = (mv: MouseEvent) => {
        rotation[0] = start[0] + (mv.clientX - sx) * 0.4
        rotation[1] = Math.max(-90, Math.min(90, start[1] - (mv.clientY - sy) * 0.4))
        projection.rotate(rotation)
        render()
      }
      const up = () => {
        dragging = false
        document.removeEventListener("mousemove", move)
        document.removeEventListener("mouseup", up)
      }
      document.addEventListener("mousemove", move)
      document.addEventListener("mouseup", up)
    }

    const onMove = (ev: MouseEvent) => {
      if (dragging) return
      const ll = toLL(ev)
      if (!ll) { setHovered(null); onMarkerHover?.(null); return }
      let best: GlobeMarker | null = null
      let bestD = Infinity
      for (const m of markersRef.current) {
        const d = geoDistance([m.lon, m.lat], ll)
        if (d < bestD) { bestD = d; best = m }
      }
      // ~2.5 degrees of arc, so a marker is grabbable without being sticky
      const hit = best && bestD < 0.045 ? best : null
      setHovered(hit)
      onMarkerHover?.(hit?.id ?? null)
    }

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const f = ev.deltaY > 0 ? 0.92 : 1.08
      projection.scale(Math.max(radius * 0.6, Math.min(radius * 4, projection.scale() * f)))
      render()
    }

    const onResize = () => { size(); render() }

    canvas.addEventListener("mousedown", onDown)
    canvas.addEventListener("mousemove", onMove)
    canvas.addEventListener("wheel", onWheel, { passive: false })
    window.addEventListener("resize", onResize)

    load()

    return () => {
      disposed = true
      rafId?.stop()
      canvas.removeEventListener("mousedown", onDown)
      canvas.removeEventListener("mousemove", onMove)
      canvas.removeEventListener("wheel", onWheel)
      window.removeEventListener("resize", onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])

  if (error) {
    return (
      <div className={`border border-hairline bg-surface px-6 py-10 text-center ${className}`}>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-critical">
          Globe unavailable
        </p>
        <p className="mt-2 text-[13px] text-steel">{error}</p>
        <p className="label mt-3">the flat map below still has every position</p>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <canvas ref={canvasRef} className="block w-full cursor-grab active:cursor-grabbing" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="label">plotting the fleet…</p>
        </div>
      )}

      {hovered && (
        <div className="pointer-events-none absolute left-4 top-4 border border-hairline-bright bg-ground px-3 py-2">
          <p className="num text-[13px] font-semibold text-chalk">{hovered.label}</p>
          <p className="num mt-0.5 text-[11.5px]" style={{ color: hovered.tone }}>{hovered.detail}</p>
          <p className="num mt-0.5 text-[11px] text-slate">
            {hovered.lat.toFixed(4)}, {hovered.lon.toFixed(4)}
          </p>
        </div>
      )}

      {/* Below the canvas rather than floating on it: absolutely positioned corners
          collide with each other once the container is narrow, and this globe is 280px
          wide on a phone. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="label">drag to rotate · scroll to zoom</span>
        <div className="flex items-center gap-2">
          <span className="label">{visibleCount} of {markers.length} in view</span>
          <button
            onClick={() => setSpinning((s) => !s)}
            className="border border-hairline-bright px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-steel transition-colors hover:border-hazard hover:text-hazard"
          >
            {spinning ? "Pause" : "Spin"}
          </button>
        </div>
      </div>
    </div>
  )
}
