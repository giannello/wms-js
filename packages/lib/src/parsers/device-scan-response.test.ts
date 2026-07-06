import { describe, it, expect } from "vitest"
import { deviceScanResponseMatcher } from "./device-scan-response.js"

describe("deviceScanResponseMatcher", () => {
  const UNKNOWN = "AABBCCDDEEFF00112233445566778899AABBCCDD"

  it("parses a valid device scan response", () => {
    const frame = `rABCDEF7021DEAD02${UNKNOWN}`
    const result = deviceScanResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.panId).toBe("DEAD")
    expect(result!.deviceType).toBe("02")
    expect(result!.deviceTypeName).toBe("Unknown")
    expect(result!.unknown).toBe(UNKNOWN)
    expect(result!.raw).toBe(frame)
  })

  it("parses a response with different device type", () => {
    const frame = `r9876547021004203${UNKNOWN}`
    const result = deviceScanResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("987654")
    expect(result!.panId).toBe("0042")
    expect(result!.deviceType).toBe("03")
    expect(result!.deviceTypeName).toBe("Unknown")
    expect(result!.unknown).toBe(UNKNOWN)
  })

  it("maps device type 25 to Awning", () => {
    const frame = `rABCDEF7021DEAD25${UNKNOWN}`
    const result = deviceScanResponseMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.deviceType).toBe("25")
    expect(result!.deviceTypeName).toBe("Awning")
  })

  it("returns null if frame does not start with r", () => {
    const frame = `XABCDEF7021DEAD02${UNKNOWN}`
    expect(deviceScanResponseMatcher(frame)).toBeNull()
  })

  it("returns null if message type is not 7021", () => {
    const frame = `rABCDEF5060DEAD02${UNKNOWN}`
    expect(deviceScanResponseMatcher(frame)).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const frame = "rABCDEF7021DEAD02"
    expect(deviceScanResponseMatcher(frame)).toBeNull()
  })
})
