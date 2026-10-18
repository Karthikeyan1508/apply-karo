// Loads the extension into Chrome, opens a URL, presses Read this page, and prints what it found.
// Usage: node extension/test/read-url.mjs <url>   (the app must be running on APP, default :3100)
import { chromium } from "playwright-core"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const url = process.argv[2]
if (!url) throw new Error("Give the page address as the first argument.")
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const chromeExe = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const chrome = spawn(chromeExe, ["--remote-debugging-port=9334", "--enable-unsafe-extension-debugging", "--headless=new", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "bb-read-"))}`, "about:blank"], { stdio: "ignore" })
await new Promise((r) => setTimeout(r, 4000))
const browser = await chromium.connectOverCDP("http://localhost:9334")
const { id } = await (await browser.newBrowserCDPSession()).send("Extensions.loadUnpacked", { path: ext })
const context = browser.contexts()[0]

// Capture what the app is sent without needing a model key.
let sent = null
await context.route("**/api/ingest", (route) => {
  sent = JSON.parse(route.request().postData())
  return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST", message: "stub" } }) })
})

const page = await context.newPage()
await page.goto(url, { waitUntil: "networkidle" })
console.log("page title:", await page.title(), "| final url:", page.url().slice(0, 90))
const panel = await context.newPage()
await panel.goto(`chrome-extension://${id}/panel.html`)
const tabId = await panel.evaluate(async () => (await chrome.tabs.query({}))[1].id)
await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`)
await panel.frameLocator("iframe").locator("#main").waitFor({ timeout: 30000 })
await panel.waitForTimeout(2000)
await panel.getByRole("button", { name: "Read this page" }).click()
await panel.waitForTimeout(4000)
console.log("panel status:", await panel.locator("#status").textContent())
const form = sent?.page
console.log("title:", form?.title)
for (const f of form?.fields ?? []) console.log(`- ${f.label} [${f.kind}${f.multi ? ",multi" : ""}${f.required ? ",required" : ""}]${f.options.length ? " " + JSON.stringify(f.options) : ""}`)
await page.screenshot({ path: path.join(os.tmpdir(), "bb-read.png"), fullPage: true })
console.log("--- what the page shows (text) ---")
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500))
await browser.close()
chrome.kill()
