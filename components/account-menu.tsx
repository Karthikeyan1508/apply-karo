"use client"

import { Popover } from "@base-ui/react/popover"
import { ChevronDownIcon, LayoutDashboardIcon, LogOutIcon, Trash2Icon, UserRoundIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { GoogleMark } from "@/components/brand/google-mark"
import { useView } from "@/components/profile/view"
import { Button } from "@/components/ui/button"
import { refreshAuth, useAuth } from "@/hooks/use-auth"
import { authClient, signInWithGoogle } from "@/lib/auth/client"
import { deleteSyncedHistory, syncHistory } from "@/lib/history-client"
import { deleteSynced, syncProfile } from "@/lib/profile"
import type { AuthInfo } from "@/lib/types"

const NOTICE: Record<string, [kind: "success" | "error" | "message", text: string]> = {
  ok: ["success", "Signed in with Google"],
  denied: ["message", "Google sign-in was cancelled"],
  error: ["error", "Google sign-in failed. Try again."],
}

let noticed = false
let synced: string | null = null

/** The sign-in round trip ends on /?auth=...: say what happened once, then tidy the address. */
function useAuthNotice() {
  useEffect(() => {
    if (noticed) return
    noticed = true
    const reason = new URLSearchParams(location.search).get("auth")
    if (!reason) return
    const hit = NOTICE[reason]
    if (hit) toast[hit[0]](hit[1])
    history.replaceState(null, "", location.pathname)
  }, [])
}

/** Once per page load after signing in, bring the account and this device level: saved facts and filled forms. */
function useSyncOnSignIn(info: AuthInfo | null) {
  const email = info?.user?.email
  useEffect(() => {
    if (!email || !info?.sync || synced === email) return
    synced = email
    void syncProfile()
    void syncHistory()
  }, [email, info?.sync])
}

function Avatar({ user }: { user: NonNullable<AuthInfo["user"]> }) {
  return user.picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- a Google profile picture, not worth the image optimiser
    <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-9 rounded-[3px] object-cover" />
  ) : (
    <span className="grid size-9 place-items-center rounded-[3px] bg-foreground text-sm font-bold text-background">
      {user.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Sign in with Google, or the signed-in account: profile, dashboard, and log out. Hidden until sign-in is set up. */
export function AccountMenu() {
  const info = useAuth()
  const view = useView()
  const [open, setOpen] = useState(false)
  useAuthNotice()
  useSyncOnSignIn(info)

  if (!info?.configured) return null
  const user = info.user
  if (!user) {
    return (
      <Button
        variant="outline"
        className="h-9 gap-2 px-2.5 sm:px-3"
        aria-label="Sign in with Google"
        onClick={() => void signInWithGoogle()}
      >
        <GoogleMark />
        <span className="hidden sm:inline">Sign in with Google</span>
      </Button>
    )
  }

  async function signOut() {
    await authClient.signOut()
    synced = null
    await refreshAuth()
    toast.success("Signed out")
  }

  const go = (to: "profile" | "dashboard") => {
    setOpen(false)
    view.open(to)
  }

  const row =
    "flex w-full items-center gap-3 rounded-[3px] px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Account menu"
        className="flex h-10 items-center gap-2 rounded-[3px] border bg-background/40 py-0 pr-2.5 pl-0.5 outline-offset-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar user={user} />
        <span className="hidden max-w-32 truncate text-sm font-semibold md:inline">{user.name.split(" ")[0]}</span>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="isolate z-50">
          <Popover.Popup className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-1.5 text-sm text-foreground shadow-2xl outline-none">
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar user={user} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div className="my-1 border-t" />

            <button type="button" className={row} onClick={() => go("profile")}>
              <UserRoundIcon className="size-4 shrink-0" />
              <span className="flex-1">Your profile</span>
            </button>
            <button type="button" className={row} onClick={() => go("dashboard")}>
              <LayoutDashboardIcon className="size-4 shrink-0" />
              <span className="flex-1">Dashboard</span>
              <span className="text-xs text-muted-foreground">filled forms</span>
            </button>

            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {info.sync
                ? "Your saved facts and filled forms are kept in your account."
                : "Needs a database to keep them in your account. Add DATABASE_URL to .env.local."}
            </p>
            {info.sync && (
              <button
                type="button"
                className={row}
                onClick={async () => {
                  const [facts, forms] = await Promise.all([deleteSynced(), deleteSyncedHistory()])
                  if (facts && forms) toast.success("Deleted from your account")
                  else toast.warning("Couldn't reach your account")
                }}
              >
                <Trash2Icon className="size-4 shrink-0" />
                <span className="flex-1">Delete what is in my account</span>
              </button>
            )}

            <div className="my-1 border-t" />
            <button type="button" className={row} onClick={signOut}>
              <LogOutIcon className="size-4 shrink-0" />
              <span className="flex-1">Log out</span>
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
