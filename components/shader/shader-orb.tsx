"use client"

import { animate } from "animejs"
import { useTheme } from "next-themes"
import { useEffect, useRef } from "react"
import type { AgentMode, AgentStatus } from "@/hooks/use-agent"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { createScene, NOISE, PRECISION } from "@/lib/gl"
import { BANDS } from "@/lib/spectrum"
import { cn } from "@/lib/utils"

/**
 * A lit sphere with a flowing interior, ringed by a dial of ticks. The ticks are a live frequency
 * spectrum of whoever is talking: mirrored left and right, they grow with the voice.
 */
const FRAGMENT = `${PRECISION}
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform float uEnergy;
uniform float uDark;
uniform float uBands[${BANDS}];
${NOISE}

float bandAt(float t) {
  float x = t * ${BANDS}.0 - 0.5;
  float i0 = floor(x);
  float f = fract(x);
  float a = 0.0;
  float b = 0.0;
  for (int i = 0; i < ${BANDS}; i++) {
    float fi = float(i);
    if (fi == clamp(i0, 0.0, ${BANDS - 1}.0)) a = uBands[i];
    if (fi == clamp(i0 + 1.0, 0.0, ${BANDS - 1}.0)) b = uBands[i];
  }
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}

void main(){
  vec2 p = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = uTime * (0.3 + uEnergy * 0.9);

  float wob = (noise(vec2(cos(ang), sin(ang)) * 1.5 + t * 0.8) - 0.5) * (0.05 + uEnergy * 0.07);
  float R = 0.4 + wob + uLevel * 0.07;
  float d = r - R;
  float edge = smoothstep(0.01, -0.01, d);

  float rr = clamp(r / R, 0.0, 1.0);
  float z = sqrt(max(0.0, 1.0 - rr * rr));
  vec3 n = normalize(vec3(p / R, z));
  vec3 L = normalize(vec3(-0.5, 0.7, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.2);

  vec2 w = n.xy * 1.7;
  float s = fbm(w + vec2(t * 0.35, -t * 0.22) + 1.5 * fbm(w * 1.5 - t * 0.3));

  vec3 forest = vec3(0.031, 0.094, 0.0);
  vec3 olive  = vec3(0.392, 0.525, 0.0);
  vec3 lime   = vec3(0.878, 0.945, 0.431);
  vec3 hi     = vec3(0.969, 1.0, 0.72);

  vec3 body = mix(forest, olive, smoothstep(0.05, 0.55, s) * (0.5 + 0.5 * diff));
  body = mix(body, lime, smoothstep(0.42, 0.9, s) * (0.35 + 0.65 * diff) * (0.6 + 0.4 * uEnergy));
  body += lime * fres * (0.5 + uLevel * 1.1 + uEnergy * 0.3);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 22.0);
  body += hi * spec * 0.8;
  body *= mix(0.72, 1.12, uEnergy);

  // dial of ticks: 72 around the circle, length follows the spectrum, mirrored left and right
  float tickCount = 72.0;
  float k = fract(ang / 6.2831853 * tickCount);
  float across = abs(k - 0.5);
  float side = abs(ang) / 3.14159265;
  float len = 0.014 + bandAt(side) * 0.2 * (0.25 + 0.75 * uEnergy);
  float r0 = R + 0.075;
  float inBar = smoothstep(0.2, 0.1, across) * smoothstep(r0 - 0.004, r0, r) * smoothstep(r0 + len + 0.004, r0 + len, r);
  vec3 tickCol = mix(vec3(0.07, 0.2, 0.0), lime, uDark);
  float tickA = inBar * (0.35 + 0.65 * smoothstep(0.0, 0.1, len - 0.014 + 0.02));

  vec3 glowCol = mix(olive, lime, uDark);
  float fade = smoothstep(0.98, 0.55, r);
  float glow = exp(-max(d, 0.0) * 9.0) * (0.22 + uLevel * 0.8 + uEnergy * 0.3) * fade;

  vec3 outside = (glowCol * glow + tickCol * tickA) * (1.0 - edge);
  float a = clamp(edge + (glow + tickA) * (1.0 - edge), 0.0, 1.0);
  gl_FragColor = vec4(body * edge + outside, a);
}
`

const ENERGY: Record<AgentMode, number> = { idle: 0.25, listening: 0.7, speaking: 1 }

interface Props {
  mode: AgentMode
  status: AgentStatus
  getLevels: () => { input: number; output: number }
  getSpectrum: () => number[]
  size?: number
  className?: string
}

export function ShaderOrb({ mode, status, getLevels, getSpectrum, size = 340, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()
  const reduced = useReducedMotion()
  const dark = resolvedTheme !== "light"

  const live = status === "live"
  const effective: AgentMode = live ? mode : "idle"
  const modeRef = useRef(effective)
  const levels = useRef(getLevels)
  const spectrum = useRef(getSpectrum)
  const energy = useRef({ v: ENERGY[effective] })
  const redraw = useRef<(() => void) | null>(null)

  useEffect(() => {
    levels.current = getLevels
    spectrum.current = getSpectrum
  }, [getLevels, getSpectrum])

  useEffect(() => {
    modeRef.current = effective
    if (reduced) {
      energy.current.v = ENERGY[effective]
      redraw.current?.()
      return
    }
    const a = animate(energy.current, { v: ENERGY[effective], duration: 900, ease: "outExpo" })
    return () => {
      a.pause()
    }
  }, [effective, reduced])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const scene = createScene(el, FRAGMENT, ["uRes", "uTime", "uLevel", "uEnergy", "uDark", "uBands"])
    if (!scene) return
    const { gl, uniforms } = scene
    const px = Math.round(size * Math.min(window.devicePixelRatio || 1, 2))
    el.width = px
    el.height = px
    gl.viewport(0, 0, px, px)
    const start = performance.now()
    const bands = new Float32Array(BANDS)
    let raf = 0
    let level = 0

    const frame = (now: number) => {
      const m = modeRef.current
      if (!reduced && m !== "idle") {
        const { input, output } = levels.current()
        const target = Math.min(1, (m === "speaking" ? output : input) * 1.6)
        level += (target - level) * 0.22
        const fresh = spectrum.current()
        for (let i = 0; i < BANDS; i++) bands[i] += ((fresh[i] ?? 0) - bands[i]) * 0.35
      } else {
        level *= 0.85
        for (let i = 0; i < BANDS; i++) bands[i] *= 0.85
      }
      gl.uniform2f(uniforms.uRes, px, px)
      gl.uniform1f(uniforms.uTime, reduced ? 6 : (now - start) / 1000)
      gl.uniform1f(uniforms.uLevel, level)
      gl.uniform1f(uniforms.uEnergy, energy.current.v)
      gl.uniform1f(uniforms.uDark, dark ? 1 : 0)
      gl.uniform1fv(uniforms.uBands, bands)
      scene.draw()
      if (!reduced && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const resume = () => {
      if (!document.hidden && !reduced) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(frame)
      }
    }

    redraw.current = () => frame(performance.now())
    raf = requestAnimationFrame(frame)
    document.addEventListener("visibilitychange", resume)
    return () => {
      redraw.current = null
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", resume)
      scene.dispose()
    }
  }, [dark, reduced, size])

  return (
    <div
      className={cn("relative shrink-0 transition-[width,height] duration-500", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Shown only where WebGL is unavailable: the canvas paints over it otherwise. */}
      <div className="absolute inset-[30%] rounded-full bg-[radial-gradient(circle_at_32%_28%,var(--lime),var(--chart-4)_55%,var(--forest))] opacity-80" />
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  )
}
