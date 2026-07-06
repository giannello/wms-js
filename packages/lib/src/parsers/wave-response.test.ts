import { describe, it, expect } from "vitest"
import { waveResponseMatcher } from "./wave-response.js"

describe("waveResponseMatcher", () => {
  it("parses a valid wave response", () => {
    const frame = "rABCDEF50AC88ED"
    const result = waveResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.code).toBe("88ED")
    expect(result!.raw).toBe(frame)
  })

  it("parses different code values", () => {
    expect(waveResponseMatcher("rABCDEF50ACCDD6")!.code).toBe("CDD6")
    expect(waveResponseMatcher("rABCDEF50ACB043")!.code).toBe("B043")
  })

  it("returns null if frame does not start with r", () => {
    expect(waveResponseMatcher("XABCDEF50AC88ED")).toBeNull()
  })

  it("returns null if message type is not 50AC", () => {
    expect(waveResponseMatcher("rABCDEF50AD88ED")).toBeNull()
  })

  it("returns null if frame is too short", () => {
    expect(waveResponseMatcher("rABCDEF50AC88E")).toBeNull()
  })

  it("parses with extra trailing data", () => {
    const result = waveResponseMatcher("rABCDEF50AC88EDextra")
    expect(result).not.toBeNull()
    expect(result!.code).toBe("88ED")
    expect(result!.raw).toBe("rABCDEF50AC88EDextra")
  })
})
