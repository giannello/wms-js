import { describe, it, expect } from "vitest"
import { waveRequestMatcher } from "./wave-request.js"

describe("waveRequestMatcher", () => {
  it("parses a valid wave request", () => {
    const frame = "rABCDEF7050"
    const result = waveRequestMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.raw).toBe(frame)
  })

  it("returns null if frame does not start with r", () => {
    const result = waveRequestMatcher("xABCDEF7050")
    expect(result).toBeNull()
  })

  it("returns null if message type is not 7050", () => {
    const result = waveRequestMatcher("rABCDEF7020")
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const result = waveRequestMatcher("rABCDEF70")
    expect(result).toBeNull()
  })
})
