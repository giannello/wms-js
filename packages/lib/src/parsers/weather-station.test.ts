import { describe, it, expect } from "vitest"
import { weatherStationMatcher } from "./weather-station.js"

describe("weatherStationMatcher", () => {
  // Frame: rSSSSSS7080YYWWL1AAAAAAL2RRxxTTyyyy
  //       0 1-6    7-10  11-12 13-14 15-16 17-22 23-24 25-26 27-28 29-30 31-34

  it("parses all fields from a valid frame", () => {
    // WW=1A(26), L1=03, L2=0A(10), RR=00(no rain), TT=6E(20°C)
    // illuminance = 3 * 10 * 2 = 60
    const frame = "r0000017080001A030000000A00006E0000"
    const result = weatherStationMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("000001")
    expect(result!.windSpeed).toBe(26)
    expect(result!.rain).toBe(false)
    expect(result!.temperature).toBe(20)
    expect(result!.illuminance).toBe(60)
  })

  it("parses wind speed 0", () => {
    const frame = "r00000170800000030000000A00006E0000"
    const result = weatherStationMatcher(frame)
    expect(result!.windSpeed).toBe(0)
  })

  it("parses max wind speed", () => {
    const frame = "r000001708000FF030000000A00006E0000"
    const result = weatherStationMatcher(frame)
    expect(result!.windSpeed).toBe(255)
  })

  it("parses temperature correctly", () => {
    // TT=6E=110 → 110/2 - 35 = 20°C
    const frame = "r00000170800000000000000000006E0000"
    const result = weatherStationMatcher(frame)
    expect(result!.temperature).toBe(20)
  })

  it("parses negative temperature", () => {
    // TT=1E=30 → 30/2 - 35 = -20°C
    const frame = "r00000170800000000000000000001E0000"
    const result = weatherStationMatcher(frame)
    expect(result!.temperature).toBe(-20)
  })

  it("parses rain flag true", () => {
    // RR=C8 at positions 25-26
    const frame = "r000001708000000000000000C800000000"
    const result = weatherStationMatcher(frame)
    expect(result!.rain).toBe(true)
  })

  it("parses rain flag false", () => {
    // RR=00 at positions 25-26
    const frame = "r0000017080000000000000000000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.rain).toBe(false)
  })

  it("calculates illuminance in direct mode (L1=0)", () => {
    // L1=00 at 15-16, L2=0A at 23-24 → 10 * 2 = 20
    const frame = "r00000170800000000000000A0000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.illuminance).toBe(20)
  })

  it("calculates illuminance in multiplied mode (L1>0)", () => {
    // L1=03 at 15-16, L2=0A at 23-24 → 3 * 10 * 2 = 60
    const frame = "r00000170800000030000000A0000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.illuminance).toBe(60)
  })

  it("returns null if frame does not start with r", () => {
    const frame = "x0000017080000000000000010000000000"
    const result = weatherStationMatcher(frame)
    expect(result).toBeNull()
  })

  it("returns null if message type is not 7080", () => {
    const frame = "r0000011234000000000000000000000000"
    const result = weatherStationMatcher(frame)
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const frame = "r00000170800000"
    const result = weatherStationMatcher(frame)
    expect(result).toBeNull()
  })

  it("preserves the raw frame", () => {
    const frame = "r0000017080001A030000000A00006E0000"
    const result = weatherStationMatcher(frame)
    expect(result!.raw).toBe(frame)
  })
})
