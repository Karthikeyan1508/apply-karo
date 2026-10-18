import { neonAuth } from "./auth/server"

export interface Me {
  id: string
  email: string
  name: string
  image?: string
}

/** Who is signed in, from Neon Auth. Needs a Next request scope (a route handler or server component). */
export async function currentUser(): Promise<Me | null> {
  try {
    const { data } = (await neonAuth()?.getSession()) ?? {}
    const u = data?.user
    return u?.id ? { id: u.id, email: u.email, name: u.name || u.email, image: u.image ?? undefined } : null
  } catch {
    return null
  }
}
