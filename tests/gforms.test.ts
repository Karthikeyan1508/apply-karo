import { describe, expect, it } from "vitest"
import { extractLoadData, parseFormUrl, parseGoogleForm } from "@/lib/gforms"

// Synthetic page that follows the FB_PUBLIC_LOAD_DATA_ layout. It checks my parser's
// assumptions, not Google's current markup: verify on a real form (see docs).
const items = [
  [111, "Full name", null, 0, [[1001, null, 1]]],
  [112, "Tell us about something you've built ]; (really)", "help text", 1, [[1002, null, 0]]],
  [113, "Notice period", null, 2, [[1003, [["Immediate"], ["1 month"], ["2 months"]], 1]]],
  [114, "Section break", null, 8],
  [115, "Skills", null, 4, [[1004, [["Python"], ["TypeScript"]], 0]]],
]
const data = [
  null,
  ["Apply to Aurora Labs", items, null, null, null, null, null, null, "Aurora Labs Application"],
  null,
  "Doc title",
]
const html = `<html><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};</script></html>`

describe("parseGoogleForm", () => {
  it("extracts the data array even when strings contain brackets", () => {
    expect(extractLoadData(html)).toEqual(data)
  })

  it("maps questions, kinds, options, required flags and entry ids", () => {
    const form = parseGoogleForm(html)
    expect(form?.title).toBe("Aurora Labs Application")
    expect(form?.description).toBe("Apply to Aurora Labs")
    expect(form?.fields.map((f) => [f.index, f.kind, f.entryId, f.required])).toEqual([
      [0, "text", "1001", true],
      [1, "long_text", "1002", false],
      [2, "choice", "1003", true],
      [4, "choice", "1004", false],
    ])
    expect(form?.fields[1].label).toBe("Tell us about something you've built ]; (really)")
    expect(form?.fields[2].options).toEqual(["Immediate", "1 month", "2 months"])
    expect(form?.fields[3].multi).toBe(true)
  })

  it("returns null for pages that are not forms", () => {
    expect(parseGoogleForm("<html>nothing here</html>")).toBeNull()
    expect(parseGoogleForm("FB_PUBLIC_LOAD_DATA_ = [1, 2")).toBeNull()
  })
})

describe("parseFormUrl", () => {
  it("allows only https Google Forms links", () => {
    expect(parseFormUrl("https://docs.google.com/forms/d/e/abc/viewform")).not.toBeNull()
    expect(parseFormUrl("https://forms.gle/abc123")).not.toBeNull()
    expect(parseFormUrl("http://docs.google.com/forms/d/e/abc/viewform")).toBeNull()
    expect(parseFormUrl("https://docs.google.com/spreadsheets/d/abc")).toBeNull()
    expect(parseFormUrl("https://evil.example.com/forms/x")).toBeNull()
    expect(parseFormUrl("http://169.254.169.254/latest/meta-data")).toBeNull()
    expect(parseFormUrl("not a url")).toBeNull()
  })
})
