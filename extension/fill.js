// Types approved answers into the controls extract.js marked. The side panel puts the answers in
// window.__bolbharoValues first. It only sets values: it never clicks a submit or next button.
;(() => {
  const values = window.__bolbharoValues || []
  delete window.__bolbharoValues

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase()
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })))

  // Frameworks that track input values ignore a plain `el.value = x`, so use the native setter.
  function setNative(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v)
  }

  /** The option whose label is the wanted text: exact first, then one contains the other. */
  function pick(options, want) {
    const w = norm(want)
    return options.find((o) => norm(o.label) === w) || options.find((o) => w && (norm(o.label).includes(w) || w.includes(norm(o.label)))) || null
  }

  function click(el) {
    el.scrollIntoView({ block: "center" })
    el.click()
  }

  function fillOne(ref, value) {
    const els = [...document.querySelectorAll(`[data-bolbharo-ref="${CSS.escape(ref)}"]`)]
    if (!els.length) return false
    const first = els[0]
    const wants = (value || "").split(/\s*[,;\n]\s*/).filter(Boolean)

    // Native radios and checkboxes: one marked input per option.
    if (first instanceof HTMLInputElement && (first.type === "radio" || first.type === "checkbox")) {
      const options = els.map((el) => ({ el, label: el.getAttribute("data-bolbharo-opt") }))
      const chosen = first.type === "radio" ? [pick(options, value)] : wants.map((w) => pick(options, w))
      let any = false
      for (const o of chosen) if (o) { if (!o.el.checked) click(o.el); any = true }
      return any
    }

    // ARIA groups (Google Forms, Microsoft Forms): the group is marked, its options carry the labels.
    const role = first.getAttribute("role")
    if (role === "radiogroup" || role === "group" || role === "list") {
      const options = [...first.querySelectorAll("[data-bolbharo-opt]")].map((el) => ({ el, label: el.getAttribute("data-bolbharo-opt") }))
      const multi = options.some((o) => o.el.getAttribute("role") === "checkbox")
      const chosen = multi ? wants.map((w) => pick(options, w)) : [pick(options, value)]
      let any = false
      for (const o of chosen) {
        if (!o) continue
        any = true
        if (o.el.getAttribute("aria-checked") !== "true") click(o.el)
      }
      return any
    }

    if (first instanceof HTMLSelectElement) {
      const options = [...first.options].map((el) => ({ el, label: el.textContent }))
      const chosen = first.multiple ? wants.map((w) => pick(options, w)).filter(Boolean) : [pick(options, value)].filter(Boolean)
      if (!chosen.length) return false
      if (first.multiple) for (const o of first.options) o.selected = chosen.some((c) => c.el === o)
      else setNative(first, chosen[0].el.value)
      fire(first, ["input", "change"])
      return true
    }

    first.focus()
    if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
      setNative(first, value)
      fire(first, ["input", "change"])
    } else {
      // contenteditable or role=textbox
      first.textContent = ""
      if (!document.execCommand("insertText", false, value)) first.textContent = value
      fire(first, ["input", "change"])
    }
    first.blur()
    return true
  }

  let filled = 0
  const skipped = []
  for (const { ref, value } of values) {
    let ok = false
    try {
      ok = fillOne(ref, String(value))
    } catch {
      ok = false
    }
    if (ok) filled++
    else skipped.push(ref)
  }
  return { filled, skipped }
})()
