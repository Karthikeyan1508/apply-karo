"use client"

import { useInterview } from "@/hooks/use-interview"

/**
 * Big subtitles for the recorded replay: the latest line from either side, readable from the back of
 * a room. Hidden from screen readers because the Talk panel already carries the same transcript.
 */
export function Captions() {
  const { transcript } = useInterview()
  const last = transcript[transcript.length - 1]
  if (!last) return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6"
    >
      <p
        key={last.id}
        className="block-lime animate-in max-w-4xl rounded-xl border border-forest px-6 py-3.5 text-center text-2xl leading-snug font-semibold text-balance duration-300 fade-in"
      >
        <span className="label-caps mr-3 border border-current px-1.5 py-0.5 align-middle">
          {last.role === "agent" ? "Apply करो" : "You"}
        </span>
        {last.text}
      </p>
    </div>
  )
}
