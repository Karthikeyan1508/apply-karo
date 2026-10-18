"use client"

import { useTheme } from "next-themes"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { createScene, NOISE, PRECISION } from "@/lib/gl"

/**
 * Slow, domain-warped noise in the palette's greens, with a lit corner like the reference and a
 * little film grain. Rendered at half resolution (the blur hides it) and paused when hidden.
 */
const FRAGMENT = `${PRECISION}
uniform vec2 uRes;
uniform float uTime;
uniform float uDark;
${NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float t = uTime * 0.045;

  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p * 1.5 + 2.0 * q + vec2(1.7, 9.2) + t * 1.2),
                fbm(p * 1.5 + 2.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.2 + 2.2 * r);

  float glowA = smoothstep(0.95, 0.05, length(p - vec2(0.32 * asp, 0.34)));
  float glowB = smoothstep(1.0, 0.1, length(p - vec2(-0.3 * asp, -0.5)));

  vec3 col;
  if (uDark > 0.5) {
    vec3 forest = vec3(0.031, 0.094, 0.0);
    vec3 deep   = vec3(0.085, 0.160, 0.040);
    vec3 olive  = vec3(0.300, 0.420, 0.020);
    vec3 lime   = vec3(0.878, 0.945, 0.431);
    vec3 floorCol = vec3(0.150, 0.195, 0.030);
    col = mix(forest, deep, smoothstep(0.15, 0.7, f));
    col = mix(col, olive, glowA * smoothstep(0.2, 0.75, f) * 1.0);
    col += lime * pow(glowA * smoothstep(0.38, 0.9, f), 2.0) * 0.55;
    col = mix(col, olive * 0.85, glowB * smoothstep(0.25, 0.8, f) * 0.7);
    col = mix(col, floorCol, smoothstep(0.1, -0.55, p.y) * (0.35 + 0.4 * f));
    col *= mix(0.78, 1.0, smoothstep(1.2, 0.2, length(p)));
  } else {
    vec3 cream  = vec3(0.914, 0.973, 0.722);
    vec3 limeL  = vec3(0.855, 0.929, 0.447);
    vec3 oliveL = vec3(0.690, 0.796, 0.306);
    vec3 white  = vec3(1.0, 1.0, 0.93);
    col = mix(cream, limeL, smoothstep(0.2, 0.8, f) * 0.7);
    col = mix(col, white, glowA * smoothstep(0.3, 0.9, f) * 0.7);
    col = mix(col, oliveL, glowB * smoothstep(0.35, 0.9, f) * 0.6);
    col *= mix(0.9, 1.0, smoothstep(1.2, 0.2, length(p)));
  }

  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.03;
  gl_FragColor = vec4(col, 1.0);
}
`

const FALLBACK = {
  dark: "radial-gradient(60% 55% at 78% 8%, oklch(0.4 0.1 125 / 0.55), transparent 70%), oklch(0.187 0.054 134)",
  light: "radial-gradient(60% 55% at 78% 8%, oklch(1 0.05 118 / 0.9), transparent 70%), oklch(0.93 0.09 118)",
}

export function ShaderBackground() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()
  const reduced = useReducedMotion()
  // The server can't know a stored light theme: render dark until mounted, so hydration matches.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const dark = !mounted || resolvedTheme !== "light"

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const scene = createScene(el, FRAGMENT, ["uRes", "uTime", "uDark"])
    if (!scene) return
    const { gl, uniforms } = scene
    const start = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const w = Math.max(1, Math.floor(el.clientWidth * 0.5))
      const h = Math.max(1, Math.floor(el.clientHeight * 0.5))
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
        gl.viewport(0, 0, w, h)
      }
      gl.uniform2f(uniforms.uRes, w, h)
      gl.uniform1f(uniforms.uTime, reduced ? 14 : (now - start) / 1000)
      gl.uniform1f(uniforms.uDark, dark ? 1 : 0)
      scene.draw()
      if (!reduced && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const resume = () => {
      if (!document.hidden && !reduced) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(frame)
      }
    }
    const redraw = () => frame(performance.now())

    raf = requestAnimationFrame(frame)
    document.addEventListener("visibilitychange", resume)
    if (reduced) window.addEventListener("resize", redraw)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", resume)
      window.removeEventListener("resize", redraw)
      scene.dispose()
    }
  }, [dark, reduced])

  return (
    <div
      className="fixed inset-0 -z-10"
      style={{ background: dark ? FALLBACK.dark : FALLBACK.light }}
      aria-hidden="true"
    >
      <canvas ref={canvas} className="size-full" />
    </div>
  )
}
