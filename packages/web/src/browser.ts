import {
  NetworkManager,
  RadioController,
  Commands,
  FrameParser,
  networkParamsMatcher,
  deviceScanMatcher,
  waveRequestMatcher,
  networkJoinMatcher,
  weatherStationMatcher,
} from "@wms-js/lib"
import { WebSerialDriver, type WMSerialPort } from "./drivers/web-serial.js"

export type DiscoveryEventType =
  | "log"
  | "error"
  | "connected"
  | "network-params"
  | "device-scan"
  | "wave-request"
  | "network-join"
  | "weather-station"

export type DiscoveryEvent = {
  type: DiscoveryEventType
  timestamp: string
} & Record<string, unknown>

function ts(): string {
  const d = new Date()
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  )
}

export async function startDiscovery(
  port: WMSerialPort,
  onEvent: (event: DiscoveryEvent) => void,
): Promise<void> {
  const driver = new WebSerialDriver(port)
  const radio = new RadioController(driver)
  const commands = new Commands(radio)

  const logParser = new FrameParser()

  driver.onData((data) => {
    const frames = logParser.feed(data)
    for (const frame of frames) {
      onEvent({ type: "log", timestamp: ts(), message: `[<<] {${frame}}` })
    }
  })

  const originalWrite = driver.write.bind(driver)
  driver.write = async (data: Uint8Array) => {
    const frame = new TextDecoder().decode(data)
    const inner = frame.startsWith("{") && frame.endsWith("}") ? frame.slice(1, -1) : frame
    onEvent({ type: "log", timestamp: ts(), message: `[>>] {${inner}}` })
    await originalWrite(data)
  }

  radio.onError((error) => {
    onEvent({ type: "error", timestamp: ts(), message: error.message })
  })

  onEvent({ type: "log", timestamp: ts(), message: "Opening serial port..." })
  await radio.open("web-serial")

  let stickName = ""
  try {
    stickName = await commands.getName()
    onEvent({ type: "log", timestamp: ts(), message: `Stick name: ${stickName}` })
  } catch (e) {
    onEvent({
      type: "error",
      timestamp: ts(),
      message: `Failed to configure network: ${(e as Error).message}`,
    })
    await radio.close()
    throw new Error("Failed to configure network")
  }

  onEvent({ type: "connected", timestamp: ts() })

  try {
    await commands.setNetworkParameters({
      receiveBroadcasts: true,
      channel: 18,
      panId: "FFFF",
    })
    onEvent({
      type: "log",
      timestamp: ts(),
      message: "Network configured: channel 18, PAN ID FFFF",
    })
  } catch (e) {
    onEvent({
      type: "error",
      timestamp: ts(),
      message: `Failed to configure network: ${(e as Error).message}`,
    })
    await radio.close()
    return
  }

  onEvent({
    type: "log",
    timestamp: ts(),
    message: "Press the L button on a remote to scan",
  })

  radio.onBroadcast(async (frame) => {
    const ws = weatherStationMatcher(frame)
    if (ws) {
      onEvent({
        type: "weather-station",
        timestamp: ts(),
        serialNumber: ws.serialNumber,
        windSpeed: ws.windSpeed,
        temperature: ws.temperature,
        rain: ws.rain,
        illuminance: ws.illuminance,
      })
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[WS] ${ws.serialNumber}  wind=${ws.windSpeed} km/h`,
      })
    }

    const np = networkParamsMatcher(frame)
    if (np) {
      onEvent({
        type: "network-params",
        timestamp: ts(),
        serialNumber: np.serialNumber,
        panId: np.panId,
        channel: np.channel,
      })
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[NET] ${np.serialNumber}  PAN ID=${np.panId}  channel=${np.channel}`,
      })
      try {
        await commands.setNetworkParameters({
          receiveBroadcasts: true,
          channel: np.channel,
          panId: np.panId,
        })
        onEvent({
          type: "log",
          timestamp: ts(),
          message: `[NET] Switched to channel ${np.channel}, PAN ID ${np.panId}`,
        })
      } catch (e) {
        onEvent({
          type: "error",
          timestamp: ts(),
          message: `[NET] Switch failed: ${(e as Error).message}`,
        })
      }
      return
    }

    const sq = deviceScanMatcher(frame)
    if (sq) {
      onEvent({
        type: "device-scan",
        timestamp: ts(),
        serialNumber: sq.serialNumber,
        panId: sq.panId,
      })
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[SCN] ${sq.serialNumber}  PAN ID=${sq.panId}`,
      })
      const cmd = `R01${sq.serialNumber}7021FFFF02`
      setTimeout(() => {
        try {
          radio.send(cmd, {
            ackMatcher: () => null,
            ackTimeoutMs: 0,
            responseWindowMs: 0,
          })
        } catch (e) {
          onEvent({
            type: "error",
            timestamp: ts(),
            message: `Scan response failed: ${(e as Error).message}`,
          })
        }
      }, 0)
    }

    const wr = waveRequestMatcher(frame)
    if (wr) {
      onEvent({
        type: "wave-request",
        timestamp: ts(),
        serialNumber: wr.serialNumber,
      })
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[WAV] ${wr.serialNumber}`,
      })
    }

    const nj = networkJoinMatcher(frame)
    if (nj) {
      onEvent({
        type: "network-join",
        timestamp: ts(),
        serialNumber: nj.serialNumber,
        panId: nj.panId,
        channel: nj.channel,
        key: nj.key,
      })
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[KEY] ${nj.serialNumber}  PAN=${nj.panId}  CH=${nj.channel}`,
      })
      try {
        await radio.close()
        onEvent({ type: "log", timestamp: ts(), message: "Port closed" })
      } catch (e) {
        onEvent({
          type: "error",
          timestamp: ts(),
          message: `Failed to close port: ${(e as Error).message}`,
        })
      }
    }
  })
}

export type MonitorParams = {
  channel: number
  panId: string
  key: string
}

export async function startMonitor(
  port: WMSerialPort,
  params: MonitorParams,
  onEvent: (event: DiscoveryEvent) => void,
): Promise<NetworkManager> {
  const driver = new WebSerialDriver(port)
  const manager = new NetworkManager(driver)

  manager.on("error", (e) => {
    onEvent({ type: "error", timestamp: ts(), message: e.error.message })
  })

  manager.on("connected", () => {
    onEvent({ type: "connected", timestamp: ts() })
  })

  manager.on("weatherStation", (e) => {
    onEvent({
      type: "weather-station",
      timestamp: ts(),
      serialNumber: e.serial,
      windSpeed: e.windSpeed,
      temperature: e.temperature,
      rain: e.rain,
      illuminance: e.illuminance,
    })
  })

  onEvent({ type: "log", timestamp: ts(), message: "Opening serial port..." })

  try {
    await manager.open("web-serial", {
      channel: params.channel,
      panId: params.panId,
      key: params.key || undefined,
    })
    onEvent({
      type: "log",
      timestamp: ts(),
      message: `Network configured: channel ${params.channel}, PAN ID ${params.panId}`,
    })
  } catch (e) {
    onEvent({
      type: "error",
      timestamp: ts(),
      message: `Failed to configure network: ${(e as Error).message}`,
    })
    throw e
  }

  window.addEventListener("beforeunload", () => {
    manager.close()
  })

  return manager
}
