import { cn } from "@/lib/utils"

/** The mono strip across the top of every panel: "01 / PLAN" on the left, state on the right. */
export function PanelHeader({
  index,
  title,
  right,
  className,
}: {
  index: string
  title: string
  right?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "label-caps flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3 text-muted-foreground",
        className
      )}
    >
      <span>
        <span className="mono-caps font-semibold text-brand">{index}</span>
        <span className="mx-2 opacity-40">/</span>
        {title}
      </span>
      {right}
    </header>
  )
}
