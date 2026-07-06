import { describe, it, expect } from "vitest"
import { moveResponseMatcher } from "./move-response.js"

describe("moveResponseMatcher", () => {
  it("parses a valid move response with position 96 (75%)", () => {
    const frame = "rABCDEF70710010023F02967FFFFFFF0CFFFFFF"
    const result = moveResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.previousPosition).toBe(75)
    expect(result!.previousInclination).toBe(0)
    expect(result!.raw).toBe(frame)
  })

  it("parses a response with position C8 (100%)", () => {
    const frame = "rABCDEF70710010023F02C87FFFFFFF0CFFFFFF"
    const result = moveResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.previousPosition).toBe(100)
    expect(result!.previousInclination).toBe(0)
  })

  it("parses a response with position 64 (50%)", () => {
    const frame = "rABCDEF70710010023F02647FFFFFFF0CFFFFFF"
    const result = moveResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.previousPosition).toBe(50)
    expect(result!.previousInclination).toBe(0)
  })

  it("returns null if frame does not start with r", () => {
    expect(moveResponseMatcher("XABCDEF70710010023F02967FFFFFFF0CFFFFFF")).toBeNull()
  })

  it("returns null if message type is not 7071", () => {
    expect(moveResponseMatcher("rABCDEF70720010023F02967FFFFFFF0CFFFFFF")).toBeNull()
  })

  it("returns null if frame is too short", () => {
    expect(moveResponseMatcher("rABCDEF70710010023F02")).toBeNull()
  })
})
