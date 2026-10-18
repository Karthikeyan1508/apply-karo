// Loads the extension into real Chrome and checks it reads and fills two kinds of page.
// Needs the app running on APP (default http://localhost:3100) and Google Chrome installed.
import { chromium } from "playwright-core"
import { spawn } from "node:child_process"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const ext = path.resolve(here, "..")
const APP = process.env.APP ?? "http://localhost:3100"
let failed = 0
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`)
  if (!ok) failed++
}

const server = http.createServer((req, res) => {
  const file = path.join(here, req.url.replace(/^\/|\?.*$/g, "") || "plain.html")
  if (!fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { "content-type": "text/html" }).end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(0, r))
const site = `http://localhost:${server.address().port}`

// Branded Chrome ignores --load-extension, so start it with a debugging port and load the extension
// over the DevTools protocol instead.
const chromeExe = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const chrome = spawn(chromeExe, ["--remote-debugging-port=9333", "--enable-unsafe-extension-debugging", "--headless=new", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "bb-ext-"))}`, "about:blank"], { stdio: "ignore" })
await new Promise((r) => setTimeout(r, 4000))
const browser = await chromium.connectOverCDP("http://localhost:9333")
const { id } = await (await browser.newBrowserCDPSession()).send("Extensions.loadUnpacked", { path: ext })
const context = browser.contexts()[0]

// The app's model calls are answered here, so this test needs no model key. It records what was sent.
// "error" makes /api/ingest fail (the fixture checks above); "session" builds a form from what was sent.
let sent = null
let ingestMode = "error"
await context.route("**/api/ingest", async (route) => {
  sent = JSON.parse(route.request().postData())
  if (ingestMode === "error") {
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST", message: "stub" } }) })
  }
  const fields = sent.page.fields.map((f, i) => ({
    id: `F${i + 1}`, index: i, entryId: f.ref, label: f.label, kind: f.kind, options: f.options, multi: f.multi, required: f.required,
    intent: "", slots: [{ name: "answer", ask: f.label, value: null, quote: null, skipped: false, fromProfile: false }],
    maxChars: null, draft: "", draftSig: "", edited: false, flags: [],
  }))
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ session: { id: "s-e2e", title: sent.page.title, description: "", source: "page", formUrl: null, context: "", lang: "en-IN", fields } }) })
})
// Saved facts that match the fixture come back as "no further matches": the model step has nothing to add.
await context.route("**/api/prefill", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ fills: [] }) }))

/** Open a fixture, open the panel pointed at it, press Read, and return what the app was sent. */
async function readPage(name) {
  console.log(`\n== ${name} ==`)
  const page = await context.newPage()
  await page.goto(`${site}/${name}`)
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${id}/panel.html`)
  const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, `${site}/${name}`)
  await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`)
  await panel.frameLocator("iframe").locator("#main").waitFor({ timeout: 30000 })
  await panel.waitForTimeout(2000)

  sent = null
  await panel.getByRole("button", { name: "Read this page" }).click()
  await panel.waitForFunction(() => /Read \d+ questions/.test(document.getElementById("status").textContent), null, { timeout: 15000 }).catch(() => {})
  await panel.waitForTimeout(1500)
  const fields = sent?.page?.fields ?? []
  console.log("read:\n  " + fields.map((f) => `${f.label} [${f.kind}${f.multi ? ",multi" : ""}${f.required ? ",req" : ""}]${f.options.length ? " " + JSON.stringify(f.options) : ""}`).join("\n  "))
  return { page, panel, fields, frame: panel.frames().find((f) => f.url().startsWith(APP)) }
}

/** Ask for a fill from inside the app frame, the way its Fill this page button does. */
const fillFrom = (frame, fields, want) =>
  frame.evaluate(
    ([fields, want]) =>
      new Promise((resolve) => {
        window.addEventListener("message", (e) => e.data?.type === "bolbharo:filled" && resolve(e.data), { once: true })
        const list = fields.filter((f) => want[f.label] !== undefined).map((f) => ({ ref: f.ref, value: want[f.label] }))
        parent.postMessage({ type: "bolbharo:fill", fields: list }, "*")
      }),
    [fields, want]
  )

const plain = await readPage("plain.html")
{
  const by = Object.fromEntries(plain.fields.map((f) => [f.label, f]))
  check("plain: finds 6 questions and skips search and password", plain.fields.length === 6, `n=${plain.fields.length}`)
  check("plain: name is required text", by["Full name"]?.kind === "text" && by["Full name"]?.required)
  check("plain: textarea is long_text", by["Why do you want to join us?"]?.kind === "long_text")
  check("plain: select options exclude the placeholder", by["Notice period"]?.options.join() === "Immediately,30 days,60 days")
  check("plain: radio group takes the legend", by["Work authorisation"]?.options.length === 2 && !by["Work authorisation"].multi)
  check("plain: checkbox group is multi", by["Which areas interest you?"]?.multi === true && by["Which areas interest you?"].options.join() === "Web,Mobile,Data")

  const done = await fillFrom(plain.frame, plain.fields, {
    "Full name": "Asha Patil",
    Email: "asha@example.com",
    "Why do you want to join us?": "I like fintech for small shops.",
    "Notice period": "30 days",
    "Work authorisation": "Yes, I can work in India",
    "Which areas interest you?": "Web, Data",
  })
  check("plain: fill reports all six", done.filled === 6 && done.skipped.length === 0, JSON.stringify(done))
  const got = await plain.page.evaluate(() => ({
    name: document.querySelector("#name").value,
    email: document.querySelector("#email").value,
    why: document.querySelector("#why").value,
    notice: document.querySelector("#notice").selectedOptions[0].textContent,
    auth: document.querySelector("input[name=auth]:checked")?.value,
    areas: [...document.querySelectorAll("input[name=area]:checked")].map((i) => i.value).join(),
    search: location.search,
  }))
  check("plain: text, textarea, select, radio and checkboxes are filled", got.name === "Asha Patil" && got.email === "asha@example.com" && got.why.startsWith("I like fintech") && got.notice === "30 days" && got.auth === "yes" && got.areas === "web,data", JSON.stringify(got))
  check("plain: nothing was submitted", got.search === "")
}

const aria = await readPage("aria.html")
{
  const by = Object.fromEntries(aria.fields.map((f) => [f.label, f]))
  check("aria: finds 5 questions", aria.fields.length === 5, `n=${aria.fields.length}`)
  check("aria: text input labelled by a heading, required", by["Shop name"]?.kind === "text" && by["Shop name"]?.required)
  check("aria: radiogroup options", by["Type of shop"]?.options.join() === "Kirana,Pharmacy")
  check("aria: checkbox group is multi", by["What do you sell?"]?.multi === true)
  check("aria: an unlabelled input takes the nearby text", Object.keys(by).some((l) => l.startsWith("Monthly sales")))

  const done = await fillFrom(aria.frame, aria.fields, {
    "Shop name": "Gupta General Store",
    "Tell us about your business": "A kirana store, twelve years old.",
    "Type of shop": "Kirana",
    "What do you sell?": "Groceries, Dairy",
  })
  check("aria: fill reports four", done.filled === 4, JSON.stringify(done))
  const got = await aria.page.evaluate(() => ({
    shop: document.querySelector("input[type=text]").value,
    about: document.querySelector("textarea").value,
    type: [...document.querySelectorAll("[role=radio]")].map((r) => r.getAttribute("aria-checked")).join(),
    sells: [...document.querySelectorAll("[role=checkbox]")].map((r) => r.getAttribute("aria-checked")).join(),
  }))
  check("aria: text, textarea, radiogroup and checkbox group are filled", got.shop === "Gupta General Store" && got.about.startsWith("A kirana") && got.type === "true,false" && got.sells === "true,true", JSON.stringify(got))
}

// The profile lives in the framed app's own localStorage (the side panel's copy). Seed it there, then read
// the plain fixture: the known fields fill from the profile and only the leftover questions stay open.
{
  console.log("== profile in the side panel ==")
  ingestMode = "session"
  const page = await context.newPage()
  await page.goto(`${site}/plain.html`)
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${id}/panel.html`)
  const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, `${site}/plain.html`)
  await panel.goto(`chrome-extension://${id}/panel.html?tab=${tabId}`)
  await panel.frameLocator("iframe").locator("#main").waitFor({ timeout: 30000 })
  const seed = [
    { label: "Full name", slot: "answer", value: "Asha Patil", quote: "Asha Patil", form: "Your profile", savedAt: 1, key: "full_name", source: "resume.pdf", confirmed: true },
    { label: "Email", slot: "answer", value: "asha@example.com", quote: "asha@example.com", form: "Your profile", savedAt: 1, key: "email", source: "resume.pdf", confirmed: true },
    { label: "Expected CTC", slot: "answer", value: "15 LPA", quote: "15 LPA", form: "Your profile", savedAt: 1, key: "expected_ctc", source: "resume.pdf", confirmed: true, sensitive: true },
  ]
  await panel.frames().find((f) => f.url().startsWith(APP)).evaluate((v) => localStorage.setItem("bolbharo.profile.v1", v), JSON.stringify(seed))
  await panel.reload()
  await panel.frameLocator("iframe").locator("#main").waitFor({ timeout: 30000 })
  await panel.waitForTimeout(1500)
  const frame = panel.frames().find((f) => f.url().startsWith(APP))
  check("profile: the framed app sees the seeded facts", (await frame.evaluate(() => localStorage.getItem("bolbharo.profile.v1")))?.includes("asha@example.com") === true)

  await panel.getByRole("button", { name: "Read this page" }).click()
  await frame.getByText("2/6 facts").waitFor({ timeout: 20000 }).catch(() => {})
  const header = await frame.locator("header").first().textContent().catch(() => "")
  check("profile: two known fields are filled from the profile", /2\/6 facts/.test(header), header.trim().slice(0, 80))
  const plan = await frame.locator("section", { hasText: "Plan" }).first().textContent().catch(() => "")
  check("profile: the rest are left open for the interview", /4 to go/.test(plan) && /Notice period/.test(plan) && /Work authorisation/.test(plan), plan.replace(/\s+/g, " ").slice(0, 120))
  ingestMode = "error"
  await panel.close()
}

// Microphone: the extension's permission page gets it, and that covers the framed app. (Chrome is
// started with a fake microphone that accepts its own prompt, so the button's before-and-after is not tested.)
{
  console.log("== microphone ==")
  const tab = await context.newPage()
  await tab.goto(`chrome-extension://${id}/mic.html`)
  await tab.getByText(/Microphone (allowed|blocked)/).waitFor({ timeout: 10000 })
  check("mic: the extension page gets the microphone", (await tab.locator("#title").textContent()) === "Microphone allowed")
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${id}/panel.html`)
  await panel.frameLocator("iframe").locator("#main").waitFor({ timeout: 30000 })
  const frame = panel.frames().find((f) => f.url().startsWith(APP))
  const heard = await frame.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => (s.getTracks().forEach((t) => t.stop()), "ok"), (e) => e.name))
  check("mic: the framed app can then use the microphone", heard === "ok", heard)
}

await browser.close()
chrome.kill()
server.close()
console.log(failed ? `\n${failed} FAILED` : "\nall passed")
process.exit(failed ? 1 : 0)
