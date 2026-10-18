import type { ApiError } from "./types"

export class AppError extends Error {
  // Plain fields, not parameter properties: scripts load this file with Node's type stripping.
  readonly code: string
  readonly status: number
  constructor(code: string, status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json(
      { error: { code: e.code, message: e.message } } satisfies ApiError,
      { status: e.status }
    )
  }
  console.error(e)
  return Response.json(
    {
      error: { code: "INTERNAL", message: "Something went wrong on the server." },
    } satisfies ApiError,
    { status: 500 }
  )
}
