import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Neon Auth imports "next/headers" without an extension, which Node cannot resolve on its own.
    server: { deps: { inline: [/@neondatabase\/auth/] } },
  },
})
