import { describe, it, expect } from "vitest"
import { deviceScanMatcher } from "./device-scan.js"

describe("deviceScanMatcher", () => {
  it("parses a valid device scan query", () => {
    const frame = "rABCDEF7020DEAD02"
    const result = deviceScanMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("ABCDEF")
    expect(result!.panId).toBe("DEAD")
    expect(result!.raw).toBe(frame)
  })

  it("returns null if frame does not start with r", () => {
    const result = deviceScanMatcher("xABCDEF7020DEAD02")
    expect(result).toBeNull()
  })

  it("returns null if message type is not 7020", () => {
    const result = deviceScanMatcher("rABCDEF5060DEAD02")
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const result = deviceScanMatcher("rABCDEF7020DEA")
    expect(result).toBeNull()
  })

  it("parses PAN ID with leading zeros", () => {
    const result = deviceScanMatcher("r9876547020004202")
    expect(result).not.toBeNull()
    expect(result!.panId).toBe("0042")
  })
})
