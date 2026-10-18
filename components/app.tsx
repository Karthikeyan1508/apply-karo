"use client"

import { useEffect, useRef } from "react"
import { EmbedHome, ExtensionBridge, useEmbedded } from "@/components/extension-bridge"
import { Dashboard } from "@/components/dashboard/dashboard"
import { Landing } from "@/components/landing/landing"
import { Workspace } from "@/components/workspace/workspace"
import { Onboarding } from "@/components/profile/onboarding"
import { ProfileScreen } from "@/components/profile/profile-screen"
import { useView, ViewProvider } from "@/components/profile/view"
import { AgentProvider, useAgent } from "@/hooks/use-agent"
import { InterviewProvider, useInterview, useInterviewStore } from "@/hooks/use-interview"
import { demoSession } from "@/lib/demo"
import { replayMode } from "@/lib/replay"

/** `/?replay=1`: skip the landing page and replay the scripted interview, for when the network fails. */
function useReplayStart() {
  const store = useInterviewStore()
  const agent = useAgent()
  const started = useRef(false)
  useEffect(() => {
    const replay = replayMode()
    if (!replay || started.current) return
    started.current = true
    store.dispatch({ type: "session", session: demoSession(replay.lang) })
    agent.setDemoSpeed(replay.speed)
    void agent.start("demo")
    // Runs once on load: the flag cannot change without a new page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function Shell() {
  const { phase } = useInterview()
  const { view } = useView()
  const embedded = useEmbedded()
  useReplayStart()
  if (view === "profile") return <ProfileScreen />
  if (view === "dashboard") return <Dashboard />
  if (view === "onboarding") return <Onboarding />
  if (phase !== "landing") return <Workspace />
  return embedded ? <EmbedHome /> : <Landing />
}

export function App() {
  return (
    <ViewProvider>
      <InterviewProvider>
        <AgentProvider>
          <ExtensionBridge />
          <Shell />
        </AgentProvider>
      </InterviewProvider>
    </ViewProvider>
  )
}
