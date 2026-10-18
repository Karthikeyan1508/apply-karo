// The side panel: BolBharo's app in a frame, plus the two things only an extension can do.
// Read the form on the active tab and send it to the app, and type approved answers back into it.
const DEFAULT_APP = "http://localhost:3100"

const frame = document.getElementById("app")
const status = document.getElementById("status")
const readButton = document.getElementById("read")
const autofillButton = document.getElementById("autofill")
const micButton = document.getElementById("mic")
const appInput = document.getElementById("appUrl")
let appOrigin = ""
let questionCount = 0

const say = (text) => (status.textContent = text)

function setApp(url) {
  const base = url.trim().replace(/\/+$/, "")
  try {
    appOrigin = new URL(base).origin
  } catch {
    say("That app address is not a web address.")
    return
  }
  appInput.value = base
  frame.src = `${base}/?embed=1`
}

/** The tab to read. `?tab=<id>` points the panel at one tab, so it can be tested in an ordinary tab. */
async function targetTab() {
  const forced = Number(new URLSearchParams(location.search).get("tab"))
  if (forced) return chrome.tabs.get(forced)
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab
}

/** Run a file in every frame of the tab. Frames the browser will not let us into are skipped. */
async function inject(tabId, file) {
  return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [file] })
}

let lastForm = { fields: [], files: [] }

/** Read the form on the tab and hand it to the app. With `autofill` the app also asks for the page to be filled. */
async function readPage(autofill) {
  readButton.disabled = autofillButton.disabled = true
  try {
    const tab = await targetTab()
    if (!tab?.id) return say("No page to read.")
    if (tab.url && new URL(tab.url).origin === appOrigin) return say("That is BolBharo itself. Switch to the tab with the form, then press Read.")
    const frames = (await inject(tab.id, "extract.js")).filter((r) => r.result && r.result.fields.length)
    if (!frames.length) {
      say("No form found. If the form is inside another site's frame, open it in its own tab.")
      return
    }
    // Refs are only unique inside a frame, so each is prefixed with its frame id.
    const top = frames.find((r) => r.frameId === 0) || frames[0]
    const form = {
      title: top.result.title,
      url: top.result.url,
      fields: frames.flatMap((r) => r.result.fields.map((f) => ({ ...f, ref: `${r.frameId}:${f.ref}` }))),
    }
    questionCount = form.fields.length
    lastForm = { fields: form.fields, files: frames.flatMap((r) => r.result.files || []) }
    say(`Read ${form.fields.length} questions.`)
    frame.contentWindow.postMessage({ type: "bolbharo:form", form, autofill }, appOrigin)
  } catch (e) {
    say(`Can't read this page (${e instanceof Error ? e.message : "error"}).`)
  } finally {
    readButton.disabled = autofillButton.disabled = false
  }
}

readButton.addEventListener("click", () => readPage(false))
autofillButton.addEventListener("click", () => readPage(true))

/** Type the approved answers into the page. The app asks for this; nothing here submits anything. */
async function fill(fields) {
  const tab = await targetTab()
  const byFrame = new Map()
  for (const f of fields) {
    const [frameId, ref] = [Number(f.ref.split(":")[0]), f.ref.split(":").slice(1).join(":")]
    byFrame.set(frameId, [...(byFrame.get(frameId) || []), { ref, value: f.value }])
  }
  let filled = 0
  const skipped = []
  for (const [frameId, values] of byFrame) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: (v) => void (window.__bolbharoValues = v),
      args: [values],
    })
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: ["fill.js"] })
    filled += r.result.filled
    skipped.push(...r.result.skipped.map((s) => `${frameId}:${s}`))
  }
  return { filled, skipped }
}

window.addEventListener("message", async (e) => {
  // Only the app we framed, and only the one message type, may ask for the page to be filled.
  if (e.source !== frame.contentWindow || e.origin !== appOrigin || e.data?.type !== "bolbharo:fill") return
  try {
    const result = await fill(Array.isArray(e.data.fields) ? e.data.fields : [])
    const of = questionCount ? ` of ${questionCount}` : ""
    say(`Filled ${result.filled}${of}. The rest is for the interview. Check the page, then submit it yourself.`)
    // Say what was not filled and why, so nothing is left silently empty.
    const sent = new Set((Array.isArray(e.data.fields) ? e.data.fields : []).map((f) => f.ref))
    const bad = new Set(result.skipped)
    const left = lastForm.fields.filter((f) => !sent.has(f.ref) || bad.has(f.ref))
    const notes = [
      ...lastForm.files.map((l) => `"${l}" is a file upload. I cannot attach files, so please upload it yourself.`),
      ...left.map((f) => (f.kind === "choice" ? `"${f.label}" is a choice I could not pick. Tell me the answer, or select it yourself.` : `"${f.label}" is still empty. Tell me the answer.`)),
    ]
    frame.contentWindow.postMessage({ type: "bolbharo:filled", ...result, notes }, appOrigin)
  } catch (err) {
    say(`Couldn't fill the page (${err instanceof Error ? err.message : "error"}).`)
    frame.contentWindow.postMessage({ type: "bolbharo:filled", filled: 0, skipped: [] }, appOrigin)
  }
})

appInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ appUrl: appInput.value })
  setApp(appInput.value)
})

chrome.storage.local.get("appUrl").then(({ appUrl }) => setApp(appUrl || DEFAULT_APP))

// The microphone: shown until the extension has been allowed to use it. Granting it here covers the
// framed app, because Chrome keys the permission to the page that holds the frame.
micButton.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") }))
navigator.permissions
  .query({ name: "microphone" })
  .then((p) => {
    const sync = () => (micButton.hidden = p.state === "granted")
    sync()
    p.onchange = sync
  })
  .catch(() => (micButton.hidden = false))
