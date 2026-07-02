import { describe, it, expect, vi } from "vitest"
import { MockSerialDriver } from "./mock-serial.js"

describe("MockSerialDriver", () => {
  it("tracks open/close state", async () => {
    const mock = new MockSerialDriver()
    expect(mock.isOpen).toBe(false)

    await mock.open("/dev/ttyUSB0")
    expect(mock.isOpen).toBe(true)
    expect(mock.path).toBe("/dev/ttyUSB0")

    await mock.close()
    expect(mock.isOpen).toBe(false)
  })

  it("records writes", async () => {
    const mock = new MockSerialDriver()
    await mock.open("/dev/ttyUSB0")

    await mock.write(new Uint8Array([1, 2, 3]))
    await mock.write(new Uint8Array([4, 5]))

    const writes = mock.getWrites()
    expect(writes).toHaveLength(2)
    expect(Array.from(writes[0])).toEqual([1, 2, 3])
    expect(Array.from(writes[1])).toEqual([4, 5])
  })

  it("clearWrites empties the write buffer", async () => {
    const mock = new MockSerialDriver()
    await mock.open("/dev/ttyUSB0")
    await mock.write(new Uint8Array([1]))

    mock.clearWrites()
    expect(mock.getWrites()).toHaveLength(0)
  })

  it("simulateData triggers onData handlers", async () => {
    const mock = new MockSerialDriver()
    const handler = vi.fn()
    mock.onData(handler)

    await mock.open("/dev/ttyUSB0")
    mock.simulateData(new Uint8Array([0x48]))

    expect(handler).toHaveBeenCalledWith(new Uint8Array([0x48]))
  })

  it("simulateError triggers onError handlers", async () => {
    const mock = new MockSerialDriver()
    const handler = vi.fn()
    mock.onError(handler)

    await mock.open("/dev/ttyUSB0")
    const error = new Error("test error")
    mock.simulateError(error)

    expect(handler).toHaveBeenCalledWith(error)
  })

  it("simulateClose triggers onClose handlers", async () => {
    const mock = new MockSerialDriver()
    const handler = vi.fn()
    mock.onClose(handler)

    await mock.open("/dev/ttyUSB0")
    mock.simulateClose()

    expect(handler).toHaveBeenCalled()
  })

  it("unsubscribe removes handlers", async () => {
    const mock = new MockSerialDriver()
    const handler = vi.fn()

    await mock.open("/dev/ttyUSB0")
    const unsub = mock.onData(handler)
    unsub()

    mock.simulateData(new Uint8Array([1]))
    expect(handler).not.toHaveBeenCalled()
  })

  it("close clears handlers and writes", async () => {
    const mock = new MockSerialDriver()
    await mock.open("/dev/ttyUSB0")

    const handler = vi.fn()
    mock.onData(handler)
    await mock.write(new Uint8Array([1]))

    await mock.close()

    expect(mock.isOpen).toBe(false)
    expect(mock.getWrites()).toHaveLength(0)

    mock.simulateData(new Uint8Array([2]))
    expect(handler).not.toHaveBeenCalled()
  })
})
