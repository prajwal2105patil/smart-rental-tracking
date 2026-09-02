"use client"

import { useEffect, useRef, useState } from "react"

// ─────────────────────────────────────────────────────────────
// Locked scroll-scrub video hero.
//
// The page cannot move while this is active — body is pinned with
// position:fixed (the technique modal libraries use; plain
// overflow:hidden alone isn't reliable across browsers). Wheel and
// touch input is captured and used purely to drive video.currentTime,
// forward and backward.
//
// CHANGED FROM THE ORIGINAL: the original engaged the lock on mount and
// only released it on unmount, so a visitor could never reach the rest
// of the page — the header comment described an unlock that the code did
// not implement. This version does what that comment described: once the
// scrub completes and the user keeps pushing forward, the page unlocks
// and scrolls normally; scrolling back to the top re-engages it.
//
// Also added: an `onComplete` callback, and a graceful still-frame
// fallback so the hero is never a black rectangle when the video is
// missing or slow.
// ─────────────────────────────────────────────────────────────

export interface MetroHeroProps {
  videoSrc?: string
  poster?: string
  title?: string
  kicker?: string
  scrollHint?: string
  tagline?: string
  signature?: { name: string; url: string } | false
  /** Total input distance (px) needed to scrub the full video. Tune to taste. */
  scrubDistance?: number
  /** Extra forward push (px) past the end before the page unlocks. */
  releaseOvershoot?: number
  /** Fires the first time the scrub completes. */
  onComplete?: () => void
  /**
   * Anything that should be revealed by the scrub. It is rendered inside the hero and
   * can animate off the --reveal custom property (0 to 1) that this component writes on
   * the section every frame - no React state, so the scrub stays on the compositor.
   * Providing a stage arms the scroll lock even when there is no video.
   */
  stage?: React.ReactNode
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

const SANS = "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, monospace"

const COL_BG = "#05070d"
const COL_TEXT = "#f2f4f8"
const COL_HAZARD = "#ffcd11"

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export default function MetroHero({
  videoSrc,
  poster,
  title = "THE CITY OPENS",
  kicker,
  scrollHint = "SCROLL",
  tagline = "Every door in the city is already open.",
  signature = false,
  scrubDistance = 3200,
  releaseOvershoot = 260,
  onComplete,
  stage,
  children,
  className,
  style,
}: MetroHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const taglineRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)
  const hasStage = Boolean(stage)

  useEffect(() => {
    const video = videoRef.current
    const section = sectionRef.current
    if (!section) return

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    let duration = 0
    let rafId = 0
    let targetProgress = 0
    let currentProgress = 0
    let hasStartedScrolling = false
    let isSeeking = false
    let pendingTime: number | null = null
    let locked = false
    let lockedScrollY = 0
    let touchStartY = 0
    let overshoot = 0
    let completed = false

    const onLoadedData = () => {
      duration = video?.duration || 0
      setReady(true)
      if (reduceMotion && video) {
        video.currentTime = duration * 0.92
        targetProgress = 1
        currentProgress = 1
        releaseLock()
      }
    }
    // No video source is a valid state: show the still composition and let the
    // visitor straight through rather than trapping them behind a black box.
    if (video) video.addEventListener("loadeddata", onLoadedData)
    else setReady(true)

    const onSeeked = () => {
      isSeeking = false
      if (pendingTime !== null && video) {
        const t = pendingTime
        pendingTime = null
        isSeeking = true
        video.currentTime = t
      }
    }
    if (video) video.addEventListener("seeked", onSeeked)

    function seekTo(t: number) {
      if (!video) return
      if (isSeeking) {
        pendingTime = t
        return
      }
      isSeeking = true
      video.currentTime = t
    }

    function engageLock() {
      if (locked || typeof document === "undefined") return
      locked = true
      lockedScrollY = window.scrollY
      const b = document.body.style
      b.position = "fixed"
      b.top = `-${lockedScrollY}px`
      b.left = "0"
      b.right = "0"
      b.width = "100%"
    }

    function releaseLock() {
      if (!locked || typeof document === "undefined") return
      locked = false
      const y = lockedScrollY
      const b = document.body.style
      b.position = ""
      b.top = ""
      b.left = ""
      b.right = ""
      b.width = ""
      window.scrollTo(0, y)
    }

    const hasSomethingToScrub = Boolean(videoSrc) || hasStage
    if (!reduceMotion && hasSomethingToScrub) engageLock()

    function addDelta(deltaY: number) {
      if (!locked) return
      const next = clamp(targetProgress + deltaY / scrubDistance, 0, 1)

      // At the end, keep counting forward push. Once it exceeds the overshoot
      // budget the page is handed back to the browser.
      if (next >= 1 && targetProgress >= 1 && deltaY > 0) {
        overshoot += deltaY
        if (overshoot >= releaseOvershoot) {
          releaseLock()
          overshoot = 0
        }
      } else {
        overshoot = 0
      }

      targetProgress = next
      if (targetProgress > 0.001) hasStartedScrolling = true

      if (targetProgress >= 1 && !completed) {
        completed = true
        onComplete?.()
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (!locked) {
        // Scrolling back up into the hero re-engages the scrub, exactly as the
        // original header comment promised.
        if (window.scrollY <= 0 && e.deltaY < 0 && hasSomethingToScrub && !reduceMotion) {
          engageLock()
          targetProgress = 1
          e.preventDefault()
        }
        return
      }
      addDelta(e.deltaY)
      e.preventDefault()
    }

    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? touchStartY
      const deltaY = touchStartY - y
      touchStartY = y
      if (!locked) {
        if (window.scrollY <= 0 && deltaY < 0 && hasSomethingToScrub && !reduceMotion) {
          engageLock()
          targetProgress = 1
          e.preventDefault()
        }
        return
      }
      addDelta(deltaY)
      e.preventDefault()
    }

    // Keyboard is not an afterthought: the lock must not trap keyboard users.
    const onKey = (e: KeyboardEvent) => {
      if (!locked) return
      const step = scrubDistance / 12
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        addDelta(step); e.preventDefault()
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        addDelta(-step); e.preventDefault()
      } else if (e.key === "Escape" || e.key === "End") {
        targetProgress = 1; releaseLock(); e.preventDefault()
      }
    }

    window.addEventListener("wheel", onWheel, { passive: false })
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    window.addEventListener("keydown", onKey)

    function frame() {
      currentProgress += (targetProgress - currentProgress) * 0.18

      if (duration > 0) seekTo(currentProgress * duration)

      if (videoRef.current) {
        videoRef.current.style.transform = `scale(${1 + currentProgress * 0.06})`
      }
      if (titleRef.current) {
        const t = 1 - clamp(currentProgress / 0.35, 0, 1)
        titleRef.current.style.opacity = String(t)
        titleRef.current.style.transform = `translateY(${(1 - t) * -24}px) scale(${0.96 + t * 0.04})`
        titleRef.current.style.filter = `blur(${(1 - t) * 10}px)`
      }
      if (hintRef.current) {
        hintRef.current.style.opacity = hasStartedScrolling ? "0" : "1"
      }
      if (taglineRef.current) {
        const t = clamp((currentProgress - 0.82) / 0.18, 0, 1)
        taglineRef.current.style.opacity = String(t)
        taglineRef.current.style.transform = `translateY(${(1 - t) * 20}px) scale(${0.97 + t * 0.03})`
        taglineRef.current.style.filter = `blur(${(1 - t) * 8}px)`
      }
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${currentProgress})`
      }
      // The one value every revealed element reads. Written as a CSS custom property
      // so children animate without a React render on any frame.
      sectionRef.current?.style.setProperty("--reveal", currentProgress.toFixed(4))

      if (readoutRef.current) {
        readoutRef.current.textContent = String(Math.round(currentProgress * 100)).padStart(3, "0")
      }

      rafId = requestAnimationFrame(frame)
    }

    if (!reduceMotion) rafId = requestAnimationFrame(frame)

    return () => {
      if (video) {
        video.removeEventListener("loadeddata", onLoadedData)
        video.removeEventListener("seeked", onSeeked)
      }
      window.removeEventListener("wheel", onWheel)
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("keydown", onKey)
      cancelAnimationFrame(rafId)
      releaseLock()
    }
  }, [scrubDistance, videoSrc, releaseOvershoot, onComplete, hasStage])

  return (
    <div
      ref={sectionRef}
      className={className}
      style={{
        position: "relative",
        height: "100dvh",
        width: "100%",
        overflow: "hidden",
        background: COL_BG,
        ...style,
      }}
    >
      {videoSrc ? (
        <video
          ref={videoRef}
          src={videoSrc}
          poster={poster}
          muted
          playsInline
          preload="auto"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: ready ? 1 : 0,
            transformOrigin: "center center",
            willChange: "transform",
            transition: "opacity 0.6s ease",
          }}
        />
      ) : (
        // No video asset: render a composed technical still rather than a black
        // rectangle. Registration marks and a measured grid, in the annotated-hardware
        // language of the rest of the console.
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px)," +
                "linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 70% 55% at 50% 45%, rgba(255,205,17,0.07), transparent 70%)",
            }}
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: "8% 6%", width: "88%", height: "84%", opacity: 0.5 }}
          >
            {[
              "M0,0 L7,0 M0,0 L0,7",
              "M100,0 L93,0 M100,0 L100,7",
              "M0,100 L7,100 M0,100 L0,93",
              "M100,100 L93,100 M100,100 L100,93",
            ].map((d, i) => (
              <path key={i} d={d} stroke={COL_HAZARD} strokeWidth="0.35" fill="none"
                    vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="50" y1="0" x2="50" y2="4" stroke="rgba(255,255,255,0.28)" strokeWidth="0.25"
                  vectorEffect="non-scaling-stroke" />
            <line x1="50" y1="96" x2="50" y2="100" stroke="rgba(255,255,255,0.28)" strokeWidth="0.25"
                  vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(5,7,13,0.55), rgba(5,7,13,0.1) 30%, rgba(5,7,13,0.25) 70%, rgba(5,7,13,0.85))",
          pointerEvents: "none",
        }}
      />

      {stage && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Sits above centre so the tagline has the lower third to itself.
            padding: "0 4% 16vh",
            pointerEvents: "none",
          }}
        >
          {stage}
        </div>
      )}

      <div
        ref={titleRef}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 6%",
          textAlign: "center",
          pointerEvents: "none",
          gap: 18,
        }}
      >
        {kicker && (
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.34em", color: COL_HAZARD }}>
            {kicker}
          </span>
        )}
        <span
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: "clamp(30px, 7vw, 96px)",
            lineHeight: 0.98,
            letterSpacing: "-0.03em",
            color: COL_TEXT,
            textShadow: "0 4px 40px rgba(0,0,0,0.6)",
            display: "inline-block",
            willChange: "transform, filter, opacity",
          }}
        >
          {title}
        </span>
      </div>

      {tagline && (
        <div
          ref={taglineRef}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            // With a stage behind it the payoff drops to the lower third: centred, it
            // lands squarely on top of the machine it is describing.
            justifyContent: stage ? "flex-end" : "center",
            paddingBottom: stage ? "13vh" : undefined,
            padding: stage ? "0 8% 13vh" : "0 8%",
            textAlign: "center",
            opacity: 0,
            gap: 22,
          }}
        >
          <span
            style={{
              fontFamily: SANS,
              fontWeight: 600,
              fontSize: "clamp(20px, 3.4vw, 40px)",
              lineHeight: 1.18,
              letterSpacing: "-0.02em",
              color: COL_TEXT,
              textShadow: "0 4px 24px rgba(0,0,0,0.6)",
              maxWidth: "18ch",
            }}
          >
            {tagline}
          </span>
          {children}
        </div>
      )}

      {/* An explicit way out. The lock releases on overshoot and on Esc, but a first-time
          visitor whose scroll "does nothing" has no way to know that. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))}
        style={{
          position: "absolute", top: "clamp(14px,3vw,26px)", right: "clamp(14px,3vw,26px)",
          zIndex: 3, background: "transparent", border: "1px solid rgba(154,165,182,0.4)",
          color: "rgba(240,244,248,0.8)", fontFamily: MONO, fontSize: 11,
          letterSpacing: "0.14em", textTransform: "uppercase", padding: "7px 14px",
          cursor: "pointer",
        }}
      >
        Skip intro
      </button>

      <div
        ref={hintRef}
        style={{
          position: "absolute",
          left: "50%",
          bottom: "clamp(28px, 7vh, 56px)",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          color: "rgba(240,244,248,0.7)",
          fontFamily: MONO,
          fontSize: "clamp(10px, 1.4vw, 11px)",
          fontWeight: 500,
          letterSpacing: "0.34em",
          transition: "opacity 0.4s ease",
          pointerEvents: "none",
        }}
      >
        <span>{scrollHint}</span>
        <svg width="14" height="18" viewBox="0 0 14 18" style={{ animation: "metro-hero-bounce 1.6s ease-in-out infinite" }}>
          <style>{`
            @keyframes metro-hero-bounce {
              0%, 100% { transform: translateY(0); opacity: 0.4; }
              50% { transform: translateY(5px); opacity: 1; }
            }
          `}</style>
          <path d="M7 1 L7 17 M2 12 L7 17 L12 12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Telemetry-style readout, in keeping with the annotated-hardware language. */}
      <div
        style={{
          position: "absolute",
          left: "clamp(14px, 3vw, 30px)",
          bottom: "clamp(18px, 3vw, 30px)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.14em",
          color: "rgba(154,165,182,0.75)",
          pointerEvents: "none",
        }}
      >
        REVEAL <span ref={readoutRef} style={{ color: COL_HAZARD }}>000</span> / 100
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: "rgba(255,255,255,0.1)" }}>
        <div
          ref={progressBarRef}
          style={{
            height: "100%",
            width: "100%",
            background: `linear-gradient(90deg, rgba(255,205,17,0.4), ${COL_HAZARD})`,
            transform: "scaleX(0)",
            transformOrigin: "left center",
          }}
        />
      </div>

      {signature && (
        <span
          style={{
            position: "absolute",
            right: "clamp(12px, 2.5vw, 24px)",
            bottom: "clamp(10px, 2vw, 18px)",
            fontFamily: MONO,
            fontSize: 11,
            color: "rgba(154,165,182,0.55)",
            zIndex: 2,
          }}
        >
          by{" "}
          <a href={signature.url} target="_blank" rel="noopener noreferrer"
             style={{ color: "inherit", textDecoration: "none" }}>
            {signature.name}
          </a>
        </span>
      )}
    </div>
  )
}
