import { cn } from "@/lib/utils"

/** Lime tile, forest bars: the palette's two anchors, as a voice waveform. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="2" style={{ fill: "var(--lime)" }} />
      <g style={{ fill: "var(--forest)" }}>
        <rect x="6.5" y="13" width="3" height="6" />
        <rect x="11.5" y="7.5" width="3" height="17" />
        <rect x="16.5" y="10.5" width="3" height="11" />
        <rect x="21.5" y="14" width="3" height="4" />
      </g>
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark className="size-9 shrink-0" />
      <div className="display text-xl leading-none uppercase">
        Apply <span className="font-deva ml-1 text-[1.12em] font-extrabold tracking-normal normal-case">करो</span>
      </div>
    </div>
  )
}
