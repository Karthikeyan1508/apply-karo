import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // The scoreboard reads data/eval.json at request time, so the file has to ship with the server.
  outputFileTracingIncludes: { "/scoreboard": ["./data/eval.json"] },
}

export default nextConfig
