import { type SerialDriver } from "../serial/driver.js"
import { FrameParser } from "../frame/parser.js"
import { serializeFrame } from "../frame/serializer.js"
import { ackMatch } from "../command/ack-match.js"
import { weatherStationMatcher } from "../parsers/weather-station.js"
import { deviceScanResponseMatcher } from "../parsers/device-scan-response.js"
import { deviceStatusMatcher } from "../parsers/device-status.js"
import { waveResponseMatcher } from "../parsers/wave-response.js"
import { waveRequestMatcher } from "../parsers/wave-request.js"
import { moveResponseMatcher } from "../parsers/move-response.js"
import { TypedEventEmitter } from "./events.js"
import type { ConnectionState, KnownDevice, NetworkEventMap } from "./types.js"
import type { DeviceStatus } from "../parsers/device-status.js"
import { info, debug } from "../logging/logger.js"

export class NetworkManager {
  private driver: SerialDriver
  private parser = new FrameParser()
  private emitter = new TypedEventEmitter<NetworkEventMap>()
  private writeQueue: Promise<void> = Promise.resolve()
  private _state: ConnectionState = "disconnected"
  private devices = new Map<string, KnownDevice>()
  private stickName = ""
  private movingTimer: ReturnType<typeof setInterval> | null = null

  constructor(driver: SerialDriver) {
    this.driver = driver
  }

  get state(): ConnectionState {
    return this._state
  }

  get knownDevices(): KnownDevice[] {
    return [...this.devices.values()]
  }

  on<K extends keyof NetworkEventMap>(
    type: K,
    fn: (event: NetworkEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(type, fn)
  }

  async open(
    path: string,
    params: { channel: number; panId: string; key?: string },
  ): Promise<void> {
    this._state = "connecting"
    await this.driver.open(path)

    const setupParser = new FrameParser()
    const send = (cmd: string) => this.driver.write(serializeFrame(cmd))

    const sendAndWait = <T>(
      cmd: string,
      matcher: (frame: string) => T | null,
      timeoutMs = 1000,
    ): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null
        const cleanup = () => {
          if (timer !== null) clearTimeout(timer)
          unsub()
        }
        const unsub = this.driver.onData((data) => {
          const frames = setupParser.feed(data)
          for (const frame of frames) {
            if (frame === "f") {
              cleanup()
              reject(new Error(`Command rejected: ${cmd}`))
              return
            }
            const result = matcher(frame)
            if (result !== null) {
              cleanup()
              resolve(result)
              return
            }
          }
        })
        send(cmd)
        timer = setTimeout(() => {
          cleanup()
          reject(new Error(`Timeout waiting for response to: ${cmd}`))
        }, timeoutMs)
      })
    }

    try {
      const name = await sendAndWait("G", ackMatch.prefix("g"))
      this.stickName = name.trim()

      const modeChar = "%"
      const panId = params.panId.toUpperCase()
      await sendAndWait(
        `M ${modeChar} ${params.channel} ${panId}`,
        ackMatch.exact("a"),
      )

      if (params.key) {
        await sendAndWait(
          `K 401 ${params.key.toUpperCase()}`,
          ackMatch.exact("a"),
        )
      }
    } catch (err) {
      await this.driver.close().catch(() => {})
      this._state = "disconnected"
      throw err
    }

    this.parser.reset()
    const unsubData = this.driver.onData((data) => this.onSerialData(data))
    const unsubError = this.driver.onError((error) => this.emitError(error))
    const unsubClose = this.driver.onClose(() => this.onClose())

    this._state = "configured"
    this.emitter.emit("connected", { stickName: this.stickName })
    this.emitter.emit("configured", {})
  }

  async close(): Promise<void> {
    this.parser.reset()
    if (this.movingTimer) {
      clearInterval(this.movingTimer)
      this.movingTimer = null
    }
    await this.driver.close().catch(() => {})
    this._state = "disconnected"
    this.devices.clear()
    this.emitter.emit("disconnected", {})
  }

  scanNetwork(panId: string): void {
    this.sendCommand(`R04FFFFFF7020${panId.toUpperCase()}02`)
  }

  queryStatus(serialNumber: string): void {
    this.sendCommand(`R06${serialNumber.toUpperCase()}801001000005`)
  }

  waveDevice(serialNumber: string): void {
    this.sendCommand(`R06${serialNumber.toUpperCase()}7050`)
  }

  moveToPosition(serialNumber: string, position: number, inclination = 0): void {
    const upper = serialNumber.toUpperCase()
    const pp = Math.round(position * 2).toString(16).toUpperCase().padStart(2, "0")
    const ww = Math.round(inclination + 127).toString(16).toUpperCase().padStart(2, "0")
    this.sendCommand(`R06${upper}707003${pp}${ww}FFFF`)

    const device = this.devices.get(upper)
    if (device) {
      const prev = device.status
      device.status = {
        serialNumber: upper,
        deviceType: device.deviceType,
        deviceTypeName: device.deviceTypeName,
        position: prev?.position ?? 0,
        inclination: prev?.inclination ?? 0,
        valance1: prev?.valance1 ?? 0,
        valance2: prev?.valance2 ?? 0,
        moving: true,
        raw: "",
      }
      this.devices.set(upper, device)
      this.emitter.emit("deviceStatus", { serial: upper, status: device.status })
      info("MOVE", `${upper} moving=true (from moveToPosition)`)
    }

    this.startMovingPoll()
    this.queryStatus(upper)
  }

  stopDevice(serialNumber: string): void {
    const upper = serialNumber.toUpperCase()
    this.sendCommand(`R06${upper}707001`)

    // Always reflect stop immediately — even if we don't think it's moving
    const device = this.devices.get(upper)
    if (device?.status) {
      device.status = { ...device.status, moving: false }
      this.devices.set(upper, device)
      this.emitter.emit("deviceStatus", { serial: upper, status: device.status })
      this.stopMovingPoll()
      info("STOP", `${upper} moving=false (from stopDevice)`)
    }

    this.queryStatus(upper)
  }

  private startMovingPoll(): void {
    if (this.movingTimer) return
    this.movingTimer = setInterval(() => {
      for (const [serial, device] of this.devices) {
        if (device.status?.moving) {
          this.queryStatus(serial)
        }
      }
    }, 2000)
  }

  private stopMovingPoll(): void {
    const hasMoving = [...this.devices.values()].some((d) => d.status?.moving)
    if (!hasMoving && this.movingTimer) {
      clearInterval(this.movingTimer)
      this.movingTimer = null
    }
  }

  private sendCommand(frame: string): void {
    this.writeQueue = this.writeQueue
      .then(() => this.driver.write(serializeFrame(frame)))
      .catch(() => {})
  }

  private onSerialData(data: Uint8Array): void {
    const frames = this.parser.feed(data)
    for (const frame of frames) {
      this.processFrame(frame)
    }
  }

  private processFrame(frame: string): void {
    const ws = weatherStationMatcher(frame)
    if (ws) {
      this.emitter.emit("weatherStation", {
        serial: ws.serialNumber,
        windSpeed: ws.windSpeed,
      })
      return
    }

    const ds = deviceScanResponseMatcher(frame)
    if (ds) {
      if (!this.devices.has(ds.serialNumber)) {
        this.devices.set(ds.serialNumber, {
          serialNumber: ds.serialNumber,
          deviceType: ds.deviceType,
          deviceTypeName: ds.deviceTypeName,
        })
        this.emitter.emit("deviceDiscovered", { device: ds })
      }
      return
    }

    const st = deviceStatusMatcher(frame)
    if (st) {
      // Once stopped, ignore 8011 reports that say "moving" — only
      // moveToPosition() or a 7071 with valid pp can re-enter moving.
      const prev = this.devices.get(st.serialNumber)?.status
      const wouldOverride = !!(prev && !prev.moving && st.moving)
      if (wouldOverride) {
        debug("8011", `${st.serialNumber} override prev=${prev!.moving} raw=${st.moving} → false`)
        st.moving = false
      }
      if (!prev || this.hasStatusChanged(prev, st)) {
        const device = this.devices.get(st.serialNumber) ?? {
          serialNumber: st.serialNumber,
          deviceType: st.deviceType,
          deviceTypeName: st.deviceTypeName,
        }
        device.status = st
        this.devices.set(st.serialNumber, device)
        this.emitter.emit("deviceStatus", { serial: st.serialNumber, status: st })
      }
      if (st.moving) {
        this.startMovingPoll()
      }
      this.stopMovingPoll()
      return
    }

    const mv = moveResponseMatcher(frame)
    if (mv) {
      debug(
        "7071",
        `${frame}  serial=${mv.serialNumber} cmd=${mv.subCommand} pp=${mv.previousPosition}% ww=${mv.previousInclination}°`,
      )
      return
    }

    const wr = waveResponseMatcher(frame)
    if (wr) {
      this.emitter.emit("waveResult", {
        serial: wr.serialNumber,
        code: wr.code,
      })
      return
    }

    const wq = waveRequestMatcher(frame)
    if (wq) {
      this.emitter.emit("waveResult", { serial: wq.serialNumber })
      return
    }
  }

  private hasStatusChanged(a: DeviceStatus, b: DeviceStatus): boolean {
    return (
      a.position !== b.position ||
      a.inclination !== b.inclination ||
      a.moving !== b.moving ||
      a.valance1 !== b.valance1 ||
      a.valance2 !== b.valance2
    )
  }

  private emitError(error: Error): void {
    this.emitter.emit("error", { error })
  }

  private onClose(): void {
    this.close()
  }
}
