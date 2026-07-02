import { describe, it, expect } from "vitest"
import { weatherStationMatcher } from "./weather-station.js"

describe("weatherStationMatcher", () => {
  it("parses a valid weather station frame", () => {
    const frame = "r0000017080001AL1AAAAAAL2RRxxTTyyyy"
    const result = weatherStationMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("000001")
    expect(result!.windSpeed).toBe(26)
  })

  it("returns null if frame does not start with r", () => {
    const result = weatherStationMatcher("x0000017080001AL1AAAAAAL2RRxxTTyyyy")
    expect(result).toBeNull()
  })

  it("returns null if message type is not 7080", () => {
    const result = weatherStationMatcher("r0000011234001AL1AAAAAAL2RRxxTTyyyy")
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const result = weatherStationMatcher("r0000017080001A")
    expect(result).toBeNull()
  })

  it("preserves the raw frame", () => {
    const frame = "r0000017080001AL1AAAAAAL2RRxxTTyyyy"
    const result = weatherStationMatcher(frame)

    expect(result!.raw).toBe(frame)
  })

  it("parses wind speed 0", () => {
    const frame = "r00000170800000L1AAAAAAL2RRxxTTyyyy"
    const result = weatherStationMatcher(frame)

    expect(result!.windSpeed).toBe(0)
  })

  it("parses max wind speed", () => {
    const frame = "r000001708000FFL1AAAAAAL2RRxxTTyyyy"
    const result = weatherStationMatcher(frame)

    expect(result!.windSpeed).toBe(255)
  })
})
