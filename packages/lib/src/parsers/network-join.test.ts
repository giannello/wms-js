import { describe, it, expect } from "vitest"
import { networkJoinMatcher } from "./network-join.js"

describe("networkJoinMatcher", () => {
  it("parses a valid network join message and reverses byte order", () => {
    const rawKey = "0102030405060708090A0B0C0D0E0F10"
    const reversed = "100F0E0D0C0B0A090807060504030201"
    const frame = `rABCDEF5018DEAD${rawKey}FF12`
    const result = networkJoinMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.panId).toBe("DEAD")
    expect(result!.key).toBe(reversed)
    expect(result!.channel).toBe(18)
    expect(result!.raw).toBe(frame)
  })

  it("returns null if frame does not start with r", () => {
    const rawKey = "0102030405060708090A0B0C0D0E0F10"
    const result = networkJoinMatcher(`xABCDEF5018DEAD${rawKey}FF12`)
    expect(result).toBeNull()
  })

  it("returns null if message type is not 5018", () => {
    const rawKey = "0102030405060708090A0B0C0D0E0F10"
    const result = networkJoinMatcher(`rABCDEF5060DEAD${rawKey}FF12`)
    expect(result).toBeNull()
  })

  it("returns null if constant FF is missing", () => {
    const rawKey = "0102030405060708090A0B0C0D0E0F10"
    const result = networkJoinMatcher(`rABCDEF5018DEAD${rawKey}0012`)
    expect(result).toBeNull()
  })

  it("returns null if channel is out of range", () => {
    const rawKey = "0102030405060708090A0B0C0D0E0F10"
    const result = networkJoinMatcher(`rABCDEF5018DEAD${rawKey}FF0A`)
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const result = networkJoinMatcher("rABCDEF5018DEAD")
    expect(result).toBeNull()
  })

  it("parses key with all zeros", () => {
    const rawKey = "00000000000000000000000000000000"
    const frame = `r1234565018FFFF${rawKey}FF11`
    const result = networkJoinMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("123456")
    expect(result!.key).toBe(rawKey)
    expect(result!.channel).toBe(17)
  })
})
