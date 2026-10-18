/** Neon Auth sends people here when finishing a sign-in failed. The home page has the sign-in button. */
export const GET = () => new Response(null, { status: 302, headers: { location: "/?auth=error" } })
