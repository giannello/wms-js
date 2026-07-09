import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NetworkManager } from "./manager.js"
import { MockSerialDriver } from "../testing/mock-serial.js"

const enc = (s: string) => new TextEncoder().encode(s)

/** Let pending microtasks (Promise continuations) drain before returning */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe("NetworkManager", () => {
  let driver: MockSerialDriver

  beforeEach(() => {
    driver = new MockSerialDriver()
  })

  describe("open / close", () => {
    it("connects and configures with setup responses", async () => {
      const manager = new NetworkManager(driver)
      const openPromise = manager.open("/dev/tty", { channel: 18, panId: "FFFF" })

      // Let open() progress into the first sendAndWait("G")
      await tick()
      driver.simulateData(enc("{gWMS USB-Stick}"))
      // Let open() progress into sendAndWait("M …")
      await tick()
      driver.simulateData(enc("{a}"))

      await openPromise
      expect(manager.state).toBe("configured")
      expect(driver.isOpen).toBe(true)
      await manager.close()
    })

    it("connects and configures with encryption key", async () => {
      const manager = new NetworkManager(driver)
      const openPromise = manager.open("/dev/tty", {
        channel: 18,
        panId: "1A2B",
        key: "AABBCCDDEEFF00112233445566778899",
      })

      await tick()
      driver.simulateData(enc("{gStick}"))
      await tick()
      driver.simulateData(enc("{a}"))
      await tick()
      driver.simulateData(enc("{a}"))

      await openPromise
      expect(manager.state).toBe("configured")
      await manager.close()
    })

    it("throws on command rejected during setup", async () => {
      const manager = new NetworkManager(driver)
      const openPromise = manager.open("/dev/tty", { channel: 18, panId: "FFFF" })

      await tick()
      driver.simulateData(enc("{f}"))

      await expect(openPromise).rejects.toThrow("Command rejected")
      expect(driver.isOpen).toBe(false)
    })

    it("close disconnects and clears devices", async () => {
      const manager = new NetworkManager(driver)
      const openPromise = manager.open("/dev/tty", { channel: 18, panId: "FFFF" })

      await tick()
      driver.simulateData(enc("{gStick}"))
      await tick()
      driver.simulateData(enc("{a}"))
      await openPromise

      expect(manager.state).toBe("configured")

      await manager.close()
      expect(manager.state).toBe("disconnected")
      expect(driver.isOpen).toBe(false)
      expect(manager.knownDevices).toEqual([])
    })
  })

  describe("broadcast handling", () => {
    async function openManager(): Promise<NetworkManager> {
      const m = new NetworkManager(driver)
      const p = m.open("/dev/tty", { channel: 18, panId: "FFFF" })
      await tick()
      driver.simulateData(enc("{gStick}"))
      await tick()
      driver.simulateData(enc("{a}"))
      await p
      return m
    }

    it("emits weatherStation on weather station broadcast", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("weatherStation", (e) => events.push(e))

      driver.simulateData(
        enc("{rABCDEF7080010A000000000000000000000000}"),
      )

      expect(events).toEqual([{ serial: "ABCDEF", windSpeed: 10, temperature: -35, rain: false, illuminance: 0 }])
      await manager.close()
    })

    it("emits deviceDiscovered on scan response", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("deviceDiscovered", (e) => events.push(e))

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        device: { serialNumber: "A1B2C3", panId: "FFFF", deviceType: "25" },
      })
      await manager.close()
    })

    it("does not re-emit deviceDiscovered for known serial", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("deviceDiscovered", (e) => events.push(e))

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )

      expect(events).toHaveLength(1)
      await manager.close()
    })

    it("emits waveResult on wave response (50AC)", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("waveResult", (e) => events.push(e))

      driver.simulateData(enc("{rA1B2C350AC1234}"))

      expect(events).toEqual([{ serial: "A1B2C3", code: "1234" }])
      await manager.close()
    })

    it("emits waveResult on wave request echo (7050)", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("waveResult", (e) => events.push(e))

      driver.simulateData(enc("{rA1B2C37050}"))

      expect(events).toEqual([{ serial: "A1B2C3" }])
      await manager.close()
    })

    it("emits deviceStatus on status response and deduplicates", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("deviceStatus", (e) => events.push(e))

      // Format: r<serial>8011<6-pad><deviceType><pos><incl><v1><v2><moving>
      // position 50 → 64 hex, moving=true → 01
      driver.simulateData(
        enc("{rA1B2C3801100000025647F000001}"),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        serial: "A1B2C3",
        status: { position: 50, moving: true },
      })

      // Second identical frame — should be deduplicated (no new event)
      driver.simulateData(
        enc("{rA1B2C3801100000025647F000001}"),
      )

      expect(events).toHaveLength(1)
      await manager.close()
    })

    it("tracks direction from position changes", async () => {
      const manager = await openManager()
      const events: { serial: string; status: { direction: string; position: number; moving: boolean } }[] = []
      manager.on("deviceStatus", (e) => events.push(e))

      // Discover device first
      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      await tick()

      // Initial status at position 80, stopped
      driver.simulateData(
        enc("{rA1B2C3801100000025A07F000000}"),
      )
      await tick()
      expect(events[0].status.direction).toBe("stopped")
      expect(events[0].status.position).toBe(80)

      // Put device in moving state via moveToPosition (target < current → opening)
      events.length = 0
      manager.moveToPosition("A1B2C3", 0)
      await tick()
      expect(events[0].status.direction).toBe("opening")
      expect(events[0].status.moving).toBe(true)

      // 8011 confirms position 40, still moving → direction "opening"
      events.length = 0
      driver.simulateData(
        enc("{rA1B2C3801100000025507F000001}"),
      )
      await tick()
      expect(events[0].status.direction).toBe("opening")
      expect(events[0].status.position).toBe(40)
      expect(events[0].status.moving).toBe(true)

      // Position drops to 10, still moving → still "opening"
      events.length = 0
      driver.simulateData(
        enc("{rA1B2C3801100000025147F000001}"),
      )
      await tick()
      expect(events[0].status.direction).toBe("opening")
      expect(events[0].status.position).toBe(10)

      // Reaches 0, stopped → direction "stopped"
      events.length = 0
      driver.simulateData(
        enc("{rA1B2C3801100000025007F000000}"),
      )
      await tick()
      expect(events[0].status.direction).toBe("stopped")
      expect(events[0].status.position).toBe(0)
      expect(events[0].status.moving).toBe(false)

      // Move down via moveToPosition (target > current → closing)
      events.length = 0
      manager.moveToPosition("A1B2C3", 100)
      await tick()
      expect(events[0].status.direction).toBe("closing")

      // 8011 confirms position 30, still moving → direction "closing"
      events.length = 0
      driver.simulateData(
        enc("{rA1B2C38011000000253C7F000001}"),
      )
      await tick()
      expect(events[0].status.direction).toBe("closing")
      expect(events[0].status.position).toBe(30)

      await manager.close()
    })

  })

  describe("fire-and-forget operations", () => {
    async function openManager(): Promise<NetworkManager> {
      const m = new NetworkManager(driver)
      const p = m.open("/dev/tty", { channel: 18, panId: "FFFF" })
      await tick()
      driver.simulateData(enc("{gStick}"))
      await tick()
      driver.simulateData(enc("{a}"))
      await p
      driver.clearWrites()
      return m
    }

    it("queryStatus writes correct frame", async () => {
      const manager = await openManager()

      manager.queryStatus("A1B2C3")

      await vi.waitFor(() => {
        const writes = driver.getWrites()
        expect(writes.length).toBeGreaterThanOrEqual(1)
        expect(new TextDecoder().decode(writes[0])).toBe(
          "{R06A1B2C3801001000005}",
        )
      })
      await manager.close()
    })

    it("waveDevice writes correct frame", async () => {
      const manager = await openManager()

      manager.waveDevice("A1B2C3")

      await vi.waitFor(() => {
        const writes = driver.getWrites()
        expect(writes.length).toBeGreaterThanOrEqual(1)
        expect(new TextDecoder().decode(writes[0])).toBe(
          "{R06A1B2C37050}",
        )
      })
      await manager.close()
    })

    it("moveToPosition writes correct frame and auto-queries status", async () => {
      const manager = await openManager()

      manager.moveToPosition("A1B2C3", 50)

      await vi.waitFor(() => {
        const writes = driver.getWrites()
        expect(writes.length).toBeGreaterThanOrEqual(2)
        expect(new TextDecoder().decode(writes[0])).toBe(
          "{R06A1B2C3707003647FFFFF}",
        )
        expect(new TextDecoder().decode(writes[1])).toBe(
          "{R06A1B2C3801001000005}",
        )
      })
      await manager.close()
    })

    it("moveToPosition sets moving=true optimistically", async () => {
      const manager = await openManager()

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      await tick()

      const events: unknown[] = []
      manager.on("deviceStatus", (e) => events.push(e))

      manager.moveToPosition("A1B2C3", 50)

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        serial: "A1B2C3",
        status: { position: 0, moving: true },
      })

      await manager.close()
    })

    it("moveToPosition with custom inclination", async () => {
      const manager = await openManager()

      manager.moveToPosition("A1B2C3", 100, 10)

      await vi.waitFor(() => {
        expect(new TextDecoder().decode(driver.getWrites()[0])).toBe(
          "{R06A1B2C3707003C889FFFF}",
        )
      })
      await manager.close()
    })

    it("stopDevice writes correct frame and auto-queries status", async () => {
      const manager = await openManager()

      manager.stopDevice("A1B2C3")

      await vi.waitFor(() => {
        const writes = driver.getWrites()
        expect(writes.length).toBeGreaterThanOrEqual(2)
        expect(new TextDecoder().decode(writes[0])).toBe(
          "{R06A1B2C3707001}",
        )
        expect(new TextDecoder().decode(writes[1])).toBe(
          "{R06A1B2C3801001000005}",
        )
      })
      await manager.close()
    })

    it("scanNetwork writes correct frame", async () => {
      const manager = await openManager()

      manager.scanNetwork("1A2B")

      await vi.waitFor(() => {
        const writes = driver.getWrites()
        expect(writes.length).toBeGreaterThanOrEqual(1)
        expect(new TextDecoder().decode(writes[0])).toBe(
          "{R04FFFFFF70201A2B02}",
        )
      })
      await manager.close()
    })
  })

  describe("error handling", () => {
    async function openManager(): Promise<NetworkManager> {
      const m = new NetworkManager(driver)
      const p = m.open("/dev/tty", { channel: 18, panId: "FFFF" })
      await tick()
      driver.simulateData(enc("{gStick}"))
      await tick()
      driver.simulateData(enc("{a}"))
      await p
      return m
    }

    it("emits error on serial driver error", async () => {
      const manager = await openManager()
      const events: unknown[] = []
      manager.on("error", (e) => events.push(e))

      driver.simulateError(new Error("connection lost"))

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        error: expect.objectContaining({ message: "connection lost" }),
      })
      await manager.close()
    })
  })

  describe("moving state and polling", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function openManager(): Promise<NetworkManager> {
      const m = new NetworkManager(driver)
      const p = m.open("/dev/tty", { channel: 18, panId: "FFFF" })
      await vi.advanceTimersByTimeAsync(0)
      driver.simulateData(enc("{gStick}"))
      await vi.advanceTimersByTimeAsync(0)
      driver.simulateData(enc("{a}"))
      await vi.advanceTimersByTimeAsync(0)
      await p
      driver.clearWrites()
      return m
    }

    it("polls a moving device every 2s", async () => {
      const manager = await openManager()

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      driver.simulateData(
        enc("{rA1B2C3801100000025647F000001}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      driver.clearWrites()

      await vi.advanceTimersByTimeAsync(2000)

      const writes = driver.getWrites()
      expect(writes.length).toBeGreaterThanOrEqual(1)
      expect(new TextDecoder().decode(writes[0])).toBe(
        "{R06A1B2C3801001000005}",
      )

      vi.useRealTimers()
      await manager.close()
    })

    it("7071 does not override moving state (subCommand=3)", async () => {
      const manager = await openManager()

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      // Set initial moving=true
      driver.simulateData(
        enc("{rA1B2C3801100000025647F000001}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      const events: unknown[] = []
      manager.on("deviceStatus", (e) => events.push(e))

      // 7071 with 3F → subCommand=3 — must NOT emit deviceStatus
      driver.simulateData(
        enc("{rA1B2C370710010023F02647FFFFFFF0CFFFFFF}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(events).toHaveLength(0)

      // Verify moving is still true
      const device = manager.knownDevices.find((d) => d.serialNumber === "A1B2C3")
      expect(device?.status?.moving).toBe(true)

      vi.useRealTimers()
      await manager.close()
    })

    it("7071 does not override moving state (subCommand=1)", async () => {
      const manager = await openManager()

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      // Set initial moving=false
      driver.simulateData(
        enc("{rA1B2C3801100000025647F000000}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      const events: unknown[] = []
      manager.on("deviceStatus", (e) => events.push(e))

      // 7071 with 3D → subCommand=1 — must NOT emit deviceStatus
      driver.simulateData(
        enc("{rA1B2C370710010023D02FFFFFFFF0CFFFFFF}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(events).toHaveLength(0)

      // Verify moving is still false
      const device = manager.knownDevices.find((d) => d.serialNumber === "A1B2C3")
      expect(device?.status?.moving).toBe(false)

      vi.useRealTimers()
      await manager.close()
    })

    it("stops polling when device stops moving", async () => {
      const manager = await openManager()

      driver.simulateData(
        enc("{rA1B2C37021FFFF25" + "0".repeat(40) + "}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      driver.simulateData(
        enc("{rA1B2C3801100000025647F000001}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      driver.clearWrites()

      // Device reports stopped
      driver.simulateData(
        enc("{rA1B2C3801100000025647F000000}"),
      )
      await vi.advanceTimersByTimeAsync(0)

      driver.clearWrites()

      await vi.advanceTimersByTimeAsync(4000)

      expect(driver.getWrites()).toHaveLength(0)

      vi.useRealTimers()
      await manager.close()
    })
  })
})
