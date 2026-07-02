import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RadioController } from "../controller.js"
import { MockSerialDriver } from "../testing/mock-serial.js"
import { Commands } from "./name.js"

const enc = (s: string) => new TextEncoder().encode(s)

describe("Commands.getName", () => {
  let driver: MockSerialDriver
  let controller: RadioController
  let commands: Commands

  beforeEach(async () => {
    vi.useFakeTimers()
    driver = new MockSerialDriver()
    controller = new RadioController(driver)
    commands = new Commands(controller)
    await controller.open("/dev/ttyUSB0")
  })

  afterEach(async () => {
    await controller.close()
    vi.useRealTimers()
  })

  it("returns the device name from a prefix response", async () => {
    const resultPromise = commands.getName()
    driver.simulateData(enc("{gWMS USB-Stick}"))

    const name = await resultPromise
    expect(name).toBe("WMS USB-Stick")
  })

  it("handles empty name", async () => {
    const resultPromise = commands.getName()
    driver.simulateData(enc("{g}"))

    const name = await resultPromise
    expect(name).toBe("")
  })

  it("throws on timeout", async () => {
    const resultPromise = commands.getName()
    vi.advanceTimersByTime(100)

    await expect(resultPromise).rejects.toThrow("ack timeout")
  })
})

describe("Commands.getVersion", () => {
  let driver: MockSerialDriver
  let controller: RadioController
  let commands: Commands

  beforeEach(async () => {
    vi.useFakeTimers()
    driver = new MockSerialDriver()
    controller = new RadioController(driver)
    commands = new Commands(controller)
    await controller.open("/dev/ttyUSB0")
  })

  afterEach(async () => {
    await controller.close()
    vi.useRealTimers()
  })

  it("returns the version string from a prefix response", async () => {
    const resultPromise = commands.getVersion()
    driver.simulateData(enc("{v12345678   }"))

    const version = await resultPromise
    expect(version).toBe("12345678")
  })

  it("trims leading and trailing spaces", async () => {
    const resultPromise = commands.getVersion()
    driver.simulateData(enc("{v  1.0.0  }"))

    const version = await resultPromise
    expect(version).toBe("1.0.0")
  })

  it("throws on timeout", async () => {
    const resultPromise = commands.getVersion()
    vi.advanceTimersByTime(100)

    await expect(resultPromise).rejects.toThrow("ack timeout")
  })
})

describe("Commands.setNetworkParameters", () => {
  let driver: MockSerialDriver
  let controller: RadioController
  let commands: Commands

  beforeEach(async () => {
    vi.useFakeTimers()
    driver = new MockSerialDriver()
    controller = new RadioController(driver)
    commands = new Commands(controller)
    await controller.open("/dev/ttyUSB0")
  })

  afterEach(async () => {
    await controller.close()
    vi.useRealTimers()
  })

  it("sends correct frame with broadcasts enabled", async () => {
    const promise = commands.setNetworkParameters({ receiveBroadcasts: true, channel: 15, panId: "1A2B" })
    driver.simulateData(enc("{a}"))
    await promise

    const writes = driver.getWrites()
    expect(new TextDecoder().decode(writes[0])).toBe("{M % 15 1A2B}")
  })

  it("sends correct frame with broadcasts disabled", async () => {
    const promise = commands.setNetworkParameters({ receiveBroadcasts: false, channel: 12, panId: "FFFF" })
    driver.simulateData(enc("{a}"))
    await promise

    const writes = driver.getWrites()
    expect(new TextDecoder().decode(writes[0])).toBe("{M # 12 FFFF}")
  })

  it("uppercases the panId", async () => {
    const promise = commands.setNetworkParameters({ receiveBroadcasts: true, channel: 11, panId: "abcd" })
    driver.simulateData(enc("{a}"))
    await promise

    const writes = driver.getWrites()
    expect(new TextDecoder().decode(writes[0])).toBe("{M % 11 ABCD}")
  })

  it("resolves on {a}", async () => {
    const promise = commands.setNetworkParameters({ receiveBroadcasts: true, channel: 15, panId: "1A2B" })
    driver.simulateData(enc("{a}"))

    await expect(promise).resolves.toBeUndefined()
  })

  it("throws on {f}", async () => {
    const promise = commands.setNetworkParameters({ receiveBroadcasts: true, channel: 15, panId: "1A2B" })
    driver.simulateData(enc("{f}"))

    await expect(promise).rejects.toThrow("command rejected")
  })

  it("throws on timeout", async () => {
    const promise = commands.setNetworkParameters({ receiveBroadcasts: true, channel: 15, panId: "1A2B" })
    vi.advanceTimersByTime(100)

    await expect(promise).rejects.toThrow("ack timeout")
  })

  it("rejects on invalid channel (too low)", async () => {
    await expect(
      commands.setNetworkParameters({ receiveBroadcasts: true, channel: 10, panId: "1A2B" }),
    ).rejects.toThrow("invalid channel")
  })

  it("rejects on invalid channel (too high)", async () => {
    await expect(
      commands.setNetworkParameters({ receiveBroadcasts: true, channel: 27, panId: "1A2B" }),
    ).rejects.toThrow("invalid channel")
  })

  it("rejects on invalid PAN ID", async () => {
    await expect(
      commands.setNetworkParameters({ receiveBroadcasts: true, channel: 15, panId: "XYZ" }),
    ).rejects.toThrow("invalid PAN ID")
  })
})

describe("Commands.setEncryptionKey", () => {
  let driver: MockSerialDriver
  let controller: RadioController
  let commands: Commands

  beforeEach(async () => {
    vi.useFakeTimers()
    driver = new MockSerialDriver()
    controller = new RadioController(driver)
    commands = new Commands(controller)
    await controller.open("/dev/ttyUSB0")
  })

  afterEach(async () => {
    await controller.close()
    vi.useRealTimers()
  })

  const validKey = "AABBCCDDEEFF00112233445566778899"

  it("sends correct frame", async () => {
    const promise = commands.setEncryptionKey(validKey)
    driver.simulateData(enc("{a}"))
    await promise

    const writes = driver.getWrites()
    expect(new TextDecoder().decode(writes[0])).toBe(`{K 401 ${validKey}}`)
  })

  it("uppercases lowercase hex input", async () => {
    const promise = commands.setEncryptionKey(validKey.toLowerCase())
    driver.simulateData(enc("{a}"))
    await promise

    const writes = driver.getWrites()
    expect(new TextDecoder().decode(writes[0])).toBe(`{K 401 ${validKey}}`)
  })

  it("resolves on {a}", async () => {
    const promise = commands.setEncryptionKey(validKey)
    driver.simulateData(enc("{a}"))

    await expect(promise).resolves.toBeUndefined()
  })

  it("throws on {f}", async () => {
    const promise = commands.setEncryptionKey(validKey)
    driver.simulateData(enc("{f}"))

    await expect(promise).rejects.toThrow("command rejected")
  })

  it("throws on timeout", async () => {
    const promise = commands.setEncryptionKey(validKey)
    vi.advanceTimersByTime(100)

    await expect(promise).rejects.toThrow("ack timeout")
  })

  it("rejects on invalid key (wrong length)", async () => {
    await expect(commands.setEncryptionKey("AABB")).rejects.toThrow("invalid key")
  })

  it("rejects on invalid key (non-hex)", async () => {
    await expect(commands.setEncryptionKey("Z".repeat(32))).rejects.toThrow("invalid key")
  })
})
