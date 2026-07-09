import { describe, it, expect } from "vitest"
import { deviceStatusMatcher } from "./device-status.js"

describe("deviceStatusMatcher", () => {
  it("parses a valid device status response (stopped)", () => {
    const frame = "rABCDEF80110100000500FFFFFF00"
    const result = deviceStatusMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.deviceType).toBe("05")
    expect(result!.deviceTypeName).toBe("Unknown")
    expect(result!.position).toBe(0)
    expect(result!.inclination).toBe(128)
    expect(result!.valance1).toBe(255)
    expect(result!.valance2).toBe(255)
    expect(result!.moving).toBe(false)
    expect(result!.direction).toBe("stopped")
    expect(result!.raw).toBe(frame)
  })

  it("parses a response with device moving", () => {
    const frame = "rABCDEF80110100000514FFFFFF01"
    const result = deviceStatusMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.position).toBe(10)
    expect(result!.moving).toBe(true)
  })

  it("parses a response at higher position", () => {
    const frame = "rABCDEF80110100000536FFFFFF00"
    const result = deviceStatusMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.position).toBe(27)
    expect(result!.moving).toBe(false)
  })

  it("caps position at 100% when hex value exceeds 200", () => {
    const frame = "rABCDEF801101000025C8FFFFFF00"
    const result = deviceStatusMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.position).toBe(100)
    expect(result!.moving).toBe(false)
  })

  it("maps device type 25 to Shade", () => {
    const frame = "rABCDEF80110100002500FFFFFF00"
    const result = deviceStatusMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.deviceType).toBe("25")
    expect(result!.deviceTypeName).toBe("Shade")
  })

  it("returns null if frame does not start with r", () => {
    const frame = "XABCDEF80110100000500FFFFFF00"
    expect(deviceStatusMatcher(frame)).toBeNull()
  })

  it("returns null if message type is not 8011", () => {
    const frame = "rABCDEF7021DEAD0200FFFFFF00"
    expect(deviceStatusMatcher(frame)).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const frame = "rABCDEF801101000005"
    expect(deviceStatusMatcher(frame)).toBeNull()
  })
})
