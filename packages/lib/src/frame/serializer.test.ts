import { describe, it, expect } from "vitest"
import { serializeFrame } from "./serializer.js"

const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe("serializeFrame", () => {
  it("wraps content in curly braces", () => {
    const result = serializeFrame("hello")
    expect(dec(result)).toBe("{hello}")
  })

  it("handles empty content", () => {
    const result = serializeFrame("")
    expect(dec(result)).toBe("{}")
  })

  it("handles utf-8 content", () => {
    const result = serializeFrame("café")
    expect(dec(result)).toBe("{café}")
  })

  it("returns Uint8Array", () => {
    const result = serializeFrame("test")
    expect(result).toBeInstanceOf(Uint8Array)
  })
})
