"use client"

import { DownloadIcon, EyeIcon, FileTextIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { loadResume, removeResume, RESUME_EVENT, type StoredResume } from "@/lib/resume-store"

/** The resume the person gave, kept in this browser: view it, download it, or remove it. */
export function ResumeCard({ className }: { className?: string }) {
  const [resume, setResume] = useState<StoredResume | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const refresh = () => void loadResume().then((r) => alive && setResume(r))
    refresh()
    window.addEventListener(RESUME_EVENT, refresh)
    return () => {
      alive = false
      window.removeEventListener(RESUME_EVENT, refresh)
    }
  }, [])

  if (!resume) return null

  const url = () => URL.createObjectURL(resume.blob)
  const view = () => {
    const u = url()
    window.open(u, "_blank", "noopener,noreferrer")
    // Give the new tab time to read it before the address is released.
    setTimeout(() => URL.revokeObjectURL(u), 60_000)
  }
  const download = () => {
    const a = document.createElement("a")
    a.href = url()
    a.download = resume.name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className={`rounded-[3px] border bg-foreground/[0.04] p-4 text-sm ${className ?? ""}`}>
      <p className="flex items-center gap-2 font-semibold">
        <FileTextIcon className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{resume.name}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Your resume, kept in this browser ({Math.max(1, Math.round(resume.size / 1024))} KB, saved{" "}
        {new Date(resume.savedAt).toLocaleDateString()}). It is not uploaded anywhere.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={view}>
          <EyeIcon /> View
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <DownloadIcon /> Download
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={async () => {
            await removeResume()
            toast.success("Resume removed from this browser")
          }}
        >
          <Trash2Icon /> Remove
        </Button>
      </div>
    </div>
  )
}
