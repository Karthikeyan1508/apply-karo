"use client"

import { createAuthClient } from "@neondatabase/auth/next"

export const authClient = createAuthClient()

/** Full-page trip to Google and back. The page reloads signed in. */
export const signInWithGoogle = () =>
  authClient.signIn.social({ provider: "google", callbackURL: window.location.origin })
