import { describe, it, expect } from "vitest"
import { networkParamsMatcher } from "./network-params.js"

describe("networkParamsMatcher", () => {
  it("parses a valid network parameter broadcast", () => {
    const frame = "r1234565060ABCD021200"
    const result = networkParamsMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("123456")
    expect(result!.panId).toBe("ABCD")
    expect(result!.channel).toBe(18)
    expect(result!.raw).toBe(frame)
  })

  it("returns null if frame does not start with r", () => {
    const result = networkParamsMatcher("x1234565060ABCD021200")
    expect(result).toBeNull()
  })

  it("returns null if message type is not 5060", () => {
    const result = networkParamsMatcher("r1234567080ABCD021200")
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const result = networkParamsMatcher("r1234565060AB")
    expect(result).toBeNull()
  })

  it("returns null if channel is out of range (below 11)", () => {
    const frame = "r1234565060FFFF020A00"
    const result = networkParamsMatcher(frame)
    expect(result).toBeNull()
  })

  it("returns null if channel is out of range (above 26)", () => {
    const frame = "r1234565060FFFF021B00"
    const result = networkParamsMatcher(frame)
    expect(result).toBeNull()
  })

  it("parses channel 11 boundary", () => {
    const result = networkParamsMatcher("r1234565060FFFF020B00")
    expect(result).not.toBeNull()
    expect(result!.channel).toBe(11)
  })

  it("parses channel 26 boundary", () => {
    const result = networkParamsMatcher("r1234565060FFFF021A00")
    expect(result).not.toBeNull()
    expect(result!.channel).toBe(26)
  })

  it("parses PAN ID with leading zeros", () => {
    const result = networkParamsMatcher("r98765450600042020B00")
    expect(result).not.toBeNull()
    expect(result!.panId).toBe("0042")
    expect(result!.channel).toBe(11)
  })
})
