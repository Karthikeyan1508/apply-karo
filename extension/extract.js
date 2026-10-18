// Reads the questions on the open page: any site, not only Google Forms. Injected by the side panel
// when the person presses "Read this page". It reads the page and marks each control it finds with a
// data-bolbharo-ref attribute so fill.js can find it again. It changes nothing else and sends nothing.
//
// shortcut: heuristics, not a per-site parser. It reads standard HTML controls and the ARIA roles
// Google Forms and Microsoft Forms use. Custom widgets (dropdowns that only render when opened,
// controls inside closed shadow roots) are skipped. Add a site-specific reader if one matters.
;(() => {
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "file", "password", "search", "range", "color"])
  const TEXT_TYPES = new Set(["", "text", "email", "tel", "url", "number", "date", "time", "datetime-local", "month", "week"])

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim()
  const text = (el) => clean(el.innerText || el.textContent)
  const strip = (s) => clean(s.replace(/\s*\*+\s*$/, "").replace(/\s*\(required\)\s*$/i, ""))
  const norm = (s) => clean(s).toLowerCase()

  function shown(el) {
    if (el.closest("[hidden],[aria-hidden='true'],[inert]")) return false
    if (getComputedStyle(el).visibility === "hidden") return false
    // Radios and checkboxes are often drawn by a sibling and the input itself is 0x0.
    const box = el.labels && el.labels[0] ? el.labels[0] : el.parentElement || el
    return el.getClientRects().length > 0 || box.getClientRects().length > 0
  }

  /** A label the page states outright: aria-labelledby, aria-label or a <label>. */
  function statedLabel(el) {
    const ids = el.getAttribute("aria-labelledby")
    if (ids) {
      const t = clean(ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(" "))
      if (t) return t
    }
    const aria = clean(el.getAttribute("aria-label"))
    if (aria) return aria
    if (el.labels && el.labels.length) {
      const t = clean([...el.labels].map(text).join(" "))
      if (t) return t
    }
    return ""
  }

  /** The question text near a control: the first line of the nearest container that has one. */
  function nearbyLabel(el, skip) {
    const own = new Set(skip.map(norm))
    let node = el.parentElement
    for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
      const line = (node.innerText || "")
        .split("\n")
        .map(clean)
        .find((l) => l && l.length < 300 && !own.has(norm(l)))
      if (line) return line
    }
    return ""
  }

  function groupLabel(container, first, options) {
    const legend = container.matches("fieldset") && container.querySelector("legend")
    return (
      (legend && text(legend)) ||
      statedLabel(container) ||
      nearbyLabel(first, options)
    )
  }

  const fields = []
  let n = 0
  const add = (f) => {
    const label = strip(f.label || "")
    fields.push({ ...f, label: label || "Untitled question", ref: "b" + ++n })
    return "b" + n
  }
  const isRequired = (el, label) => el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(label || "")
  const optionLabel = (input) => statedLabel(input) || text(input.closest("label") || input.parentElement || input) || input.value || ""

  const used = new Set()
  const inScope = (el) => !used.has(el) && shown(el) && !el.closest("[role='search'],nav")

  // ARIA groups first (Google Forms, Microsoft Forms, most custom UIs).
  for (const group of document.querySelectorAll("[role='radiogroup'],[role='group']")) {
    // The innermost group owns its options: an outer wrapper must not claim them again.
    if (group.querySelector("[role='radiogroup'],[role='group']")) continue
    const radios = [...group.querySelectorAll("[role='radio']")]
    const boxes = [...group.querySelectorAll("[role='checkbox']")]
    const items = radios.length ? radios : boxes
    if (!items.length || !inScope(group)) continue
    const options = items.map((o) => clean(o.getAttribute("aria-label")) || text(o) || clean(o.getAttribute("data-value")))
    if (options.some((o) => !o)) continue
    const label = groupLabel(group, items[0], options)
    const ref = add({ label, kind: "choice", options, multi: !radios.length, required: isRequired(group, label) })
    group.setAttribute("data-bolbharo-ref", ref)
    items.forEach((o, i) => {
      o.setAttribute("data-bolbharo-opt", options[i])
      used.add(o)
    })
    for (const o of items) for (const input of o.querySelectorAll("input")) used.add(input)
  }

  // Native radio and checkbox groups, by name.
  const groups = new Map()
  for (const input of document.querySelectorAll("input[type='radio'],input[type='checkbox']")) {
    if (used.has(input) || !inScope(input)) continue
    const key = input.type + ":" + (input.name || "#" + (n + groups.size)) + ":" + (input.name ? "" : fieldsetKey(input))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(input)
  }
  function fieldsetKey(input) {
    return (input.closest("fieldset,[role='group']") || input.parentElement || input).tagName + [...document.querySelectorAll("input")].indexOf(input)
  }
  for (const inputs of groups.values()) {
    const options = inputs.map(optionLabel)
    if (options.some((o) => !o)) continue
    const container = inputs[0].closest("fieldset,[role='group'],[role='radiogroup']") || inputs[0].parentElement
    const label = groupLabel(container, inputs[0], options)
    const multi = inputs[0].type === "checkbox"
    const ref = add({ label, kind: "choice", options, multi, required: isRequired(inputs[0], label) })
    inputs.forEach((input, i) => {
      input.setAttribute("data-bolbharo-ref", ref)
      input.setAttribute("data-bolbharo-opt", options[i])
      used.add(input)
    })
  }

  // Selects, text boxes, text areas and contenteditable answers.
  const controls = document.querySelectorAll("select,textarea,input,[contenteditable='true'],[contenteditable=''],[role='textbox']")
  for (const el of controls) {
    if (!inScope(el)) continue
    const tag = el.tagName.toLowerCase()
    if (tag === "input" && (SKIP_TYPES.has(el.type) || !TEXT_TYPES.has(el.type))) continue
    if (tag === "input" && el.type === "radio") continue
    if (el.closest("[contenteditable]") !== el && el.isContentEditable && tag !== "input" && tag !== "textarea") continue
    if (el.readOnly || el.disabled) continue

    let label = statedLabel(el)
    if (tag === "select") {
      const options = [...el.options].filter((o) => o.value !== "" && !o.disabled).map((o) => clean(o.textContent))
      if (!options.length) continue
      label = label || nearbyLabel(el, options) || clean(el.name)
      el.setAttribute("data-bolbharo-ref", add({ label, kind: "choice", options, multi: el.multiple, required: isRequired(el, label) }))
      continue
    }
    label = label || nearbyLabel(el, []) || clean(el.placeholder) || clean(el.name)
    const long = tag === "textarea" || tag !== "input"
    el.setAttribute("data-bolbharo-ref", add({ label, kind: long ? "long_text" : "text", options: [], multi: false, required: isRequired(el, label) }))
  }

  const heading = document.querySelector("h1,[role='heading'][aria-level='1']")
  return {
    title: clean((heading && text(heading)) || document.title).slice(0, 200),
    url: location.href,
    fields: fields.map((f) => ({ options: [], multi: false, required: false, ...f })),
  }
})()
