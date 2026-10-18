// Starts the official ElevenLabs MCP server (https://pypi.org/project/elevenlabs-mcp/) with the key
// from .env.local, so the key never has to be exported in your shell or written into .mcp.json.
// Needs `uv` (https://docs.astral.sh/uv/). It must print nothing itself: stdout carries the protocol.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const file = join(root, ".env.local")
const env = {}
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=")
    if (line.trim() && !line.startsWith("#") && i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
}

const key = process.env.ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY
if (!key) {
  console.error("ELEVENLABS_API_KEY is not set in .env.local")
  process.exit(1)
}

const child = spawn("uvx", ["elevenlabs-mcp"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ELEVENLABS_API_KEY: key },
})
child.on("error", (e) => {
  console.error("Could not start uvx. Install uv: https://docs.astral.sh/uv/", e.message)
  process.exit(1)
})
child.on("exit", (code) => process.exit(code ?? 0))
