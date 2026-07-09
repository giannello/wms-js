import { describe, it, expect } from "vitest"
import { weatherStationMatcher } from "./weather-station.js"

describe("weatherStationMatcher", () => {
  // Frame: rSSSSSS7080YYWWL1AAAAAAL2RRxxTTtthhhhhuuuu
  //       0 1-6    7-10  11-12 13-14 15-16 17-22 23-24 25-26 27-28 29-30 31-32 33-36 37-38
  //       RR=battery, xx=rain(C8), TT=temperature, tt=indoor temp, hhhh=unknown, uu=humidity

  it("parses all fields from a valid frame", () => {
    // WW=1A(26) → wind=13, L1=03, L2=0A(10) → lux=60
    // RR=32(50) → battery=25V, xx=C8 → rain=true
    // TT=6E(110) → temp=15°C, tt=6E(110) → indoor=15°C
    // uu=4B(75) → humidity=37.5%
    const frame = "r0000017080001A030000000A32C86E6E00004B"
    const result = weatherStationMatcher(frame)

    expect(result).not.toBeNull()
    expect(result!.serialNumber).toBe("000001")
    expect(result!.windSpeed).toBe(13)
    expect(result!.rain).toBe(true)
    expect(result!.temperature).toBe(15)
    expect(result!.illuminance).toBe(60)
    expect(result!.battery).toBe(25)
    expect(result!.temperatureIndoor).toBe(15)
    expect(result!.humidity).toBe(37.5)
  })

  it("parses wind speed 0", () => {
    const frame = "r00000170800000000000000000000000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.windSpeed).toBe(0)
  })

  it("parses wind speed correctly (/2)", () => {
    // WW=28 → 40/2 = 20
    const frame = "r00000170800028000000000000006E000000"
    const result = weatherStationMatcher(frame)
    expect(result!.windSpeed).toBe(20)
  })

  it("parses temperature correctly", () => {
    // TT=6E=110 → 110/2 - 40 = 15°C
    const frame = "r00000170800000000000000000006E000000"
    const result = weatherStationMatcher(frame)
    expect(result!.temperature).toBe(15)
  })

  it("parses negative temperature", () => {
    // TT=1E=30 → 30/2 - 40 = -25°C
    const frame = "r00000170800000000000000000001E000000"
    const result = weatherStationMatcher(frame)
    expect(result!.temperature).toBe(-25)
  })

  it("parses rain flag true at offset 27-28", () => {
    // xx=C8 at positions 27-28
    const frame = "r00000170800000000000000000C80000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.rain).toBe(true)
  })

  it("parses rain flag false", () => {
    // xx=00 at positions 27-28
    const frame = "r00000170800000000000000000000000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.rain).toBe(false)
  })

  it("does not treat RR field at 25-26 as rain", () => {
    // RR=C8 at 25-26, xx=00 at 27-28 → should be false
    const frame = "r000001708000000000000000C8000000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.rain).toBe(false)
  })

  it("parses battery voltage", () => {
    // RR=64=100 → 100/2 = 50V
    const frame = "r00000170800000000000000064000000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.battery).toBe(50)
  })

  it("returns null for battery on invalid hex", () => {
    const frame = "r000001708000000000000000XX000000000000"
    const result = weatherStationMatcher(frame)
    expect(result!.battery).toBeNull()
  })

  it("calculates illuminance in direct mode (L1=0)", () => {
    // L1=00 at 15-16, L2=0A at 23-24 → 10 * 2 = 20
    const frame = "r00000170800000000000000A00006E00000000"
    const result = weatherStationMatcher(frame)
    expect(result!.illuminance).toBe(20)
  })

  it("calculates illuminance in multiplied mode (L1>0)", () => {
    // L1=03 at 15-16, L2=0A at 23-24 → 3 * 10 * 2 = 60
    const frame = "r00000170800000030000000A00006E00000000"
    const result = weatherStationMatcher(frame)
    expect(result!.illuminance).toBe(60)
  })

  it("parses indoor temperature when frame is long enough", () => {
    // tt=5A=90 → 90/2 - 40 = 5°C
    const frame = "r00000170800000000000000000006E5A000000"
    const result = weatherStationMatcher(frame)
    expect(result!.temperatureIndoor).toBe(5)
  })

  it("returns null for indoor temperature on short frame", () => {
    const frame = "r00000170800000000000000000006E" // 31 chars
    const result = weatherStationMatcher(frame)
    expect(result!.temperatureIndoor).toBeNull()
  })

  it("parses humidity when frame is long enough", () => {
    // uu=32=50 → 50/2 = 25%
    const frame = "r00000170800000000000000000006E00000032"
    const result = weatherStationMatcher(frame)
    expect(result!.humidity).toBe(25)
  })

  it("returns null for humidity on short frame", () => {
    const frame = "r00000170800000000000000000006E0000" // 35 chars
    const result = weatherStationMatcher(frame)
    expect(result!.humidity).toBeNull()
  })

  it("returns null if frame does not start with r", () => {
    const frame = "x00000170800000000000000000006E000000"
    const result = weatherStationMatcher(frame)
    expect(result).toBeNull()
  })

  it("returns null if message type is not 7080", () => {
    const frame = "r00000112340000000000000000006E000000"
    const result = weatherStationMatcher(frame)
    expect(result).toBeNull()
  })

  it("returns null if frame is too short", () => {
    const frame = "r00000170800000"
    const result = weatherStationMatcher(frame)
    expect(result).toBeNull()
  })

  it("preserves the raw frame", () => {
    const frame = "r0000017080001A030000000A32C86E6E00004B"
    const result = weatherStationMatcher(frame)
    expect(result!.raw).toBe(frame)
  })
})
