import { RadioController, Commands, weatherStationMatcher, networkParamsMatcher, deviceScanMatcher, waveRequestMatcher, networkJoinMatcher } from "@warema/lib"
import { NodeSerialDriver } from "./node-serial.js"

function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `[${hh}:${mm}:${ss}]`
}

function usage(): never {
  console.error(`Usage: tsx packages/cli/src/index.ts --port <path> ( --channel <n> | --discover ) [options]

Options:
  --port <path>       Serial port path (e.g. /dev/ttyUSB0)
  --channel <n>       Radio channel (11-26)
  --pan-id <XXXX>     PAN ID in hex, defaults to FFFF
  --key <hex>         32-char hex encryption key (optional, for encrypted networks)
  --discover          Listen for a remote pairing broadcast to detect and switch to
                      the remote's network (ignores --channel, --pan-id, --key)
  --help              Show this help
`)
  process.exit(1)
}

function parseArgs(): {
  port: string
  channel: number
  panId: string
  key: string | undefined
  discover: boolean
} {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes("--help")) usage()

  let port = ""
  let channel = 0
  let panId = "FFFF"
  let key: string | undefined
  let discover = false
  let channelSet = false
  let panIdSet = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        port = args[++i] ?? ""
        break
      case "--channel":
        channel = Number(args[++i])
        channelSet = true
        break
      case "--pan-id":
        panId = args[++i] ?? "FFFF"
        panIdSet = true
        break
      case "--key":
        key = args[++i]
        break
      case "--discover":
        discover = true
        break
      default:
        console.error(`Unknown option: ${args[i]}`)
        usage()
    }
  }

  if (!port) {
    console.error("Error: --port is required")
    usage()
  }

  if (discover) {
    if (channel === 0) channel = 18
  } else if (channel < 11 || channel > 26) {
    console.error("Error: --channel must be between 11 and 26")
    usage()
  }

  if (!/^[0-9A-Fa-f]{4}$/.test(panId)) {
    console.error("Error: --pan-id must be a 4-digit hex value (e.g. FFFF)")
    usage()
  }

  if (key !== undefined && !/^[0-9A-Fa-f]{32}$/.test(key)) {
    console.error("Error: --key must be a 32-character hex string")
    usage()
  }

  if (discover && channelSet) {
    console.error("Error: --discover mode does not accept --channel")
    usage()
  }

  if (discover && panIdSet) {
    console.error("Error: --discover mode does not accept --pan-id")
    usage()
  }

  if (discover && key !== undefined) {
    console.error("Error: --discover mode does not accept --key")
    usage()
  }

  return { port, channel, panId: panId.toUpperCase(), key, discover }
}

async function main(): Promise<void> {
  const { port, channel, panId, key, discover } = parseArgs()

  const driver = new NodeSerialDriver()
  const radio = new RadioController(driver)
  const commands = new Commands(radio)

  const originalWrite = driver.write.bind(driver)
  driver.write = async (data: Uint8Array) => {
    const frame = new TextDecoder().decode(data)
    const inner = frame.startsWith("{") && frame.endsWith("}")
      ? frame.slice(1, -1)
      : frame
    console.log(`${timestamp()} [>>] {${inner}}`)
    await originalWrite(data)
  }

  radio.onError((error) => {
    console.error(`${timestamp()} [ERR] ${error.message}`)
  })

  signalTraps(() => radio.close())

  console.log(`${timestamp()} [INF] Opening ${port} at 128000 baud`)
  await radio.open(port)
  console.log(`${timestamp()} [INF] Serial port opened`)

  try {
    const name = await commands.getName()
    console.log(`${timestamp()} [INF] Stick name: ${name}`)
  } catch (e) {
    console.error(`${timestamp()} [ERR] Failed to get stick name: ${(e as Error).message}`)
    await radio.close()
    process.exit(1)
  }

  try {
    await commands.setNetworkParameters({
      receiveBroadcasts: true,
      channel,
      panId,
    })
    console.log(`${timestamp()} [INF] Network configured: channel ${channel}, PAN ID ${panId}`)

  if (discover) {
    console.log(`${timestamp()} [INF] Discovery mode: press the L button on a remote to scan`)
    console.log(`${timestamp()} [INF] The remote will broadcast its network parameters`)
  }
  } catch (e) {
    console.error(`${timestamp()} [ERR] Failed to configure network: ${(e as Error).message}`)
    await radio.close()
    process.exit(1)
  }

  if (key) {
    try {
      await commands.setEncryptionKey(key)
      console.log(`${timestamp()} [INF] Encryption key set`)
    } catch (e) {
      console.error(`${timestamp()} [ERR] Failed to set encryption key: ${(e as Error).message}`)
      await radio.close()
      process.exit(1)
    }
  }

  radio.onBroadcast(async (frame) => {
    console.log(`${timestamp()} [<<] {${frame}}`)

    const ws = weatherStationMatcher(frame)
    if (ws) {
      console.log(`${timestamp()} [WS]  ${ws.serialNumber}  wind=${ws.windSpeed} km/h`)
    }

    const np = networkParamsMatcher(frame)
    if (np) {
      if (discover) {
        const ch = np.channel
        console.log(`${timestamp()} [NET] Switching to channel ${ch}, PAN ID ${np.panId}`)
        try {
          await commands.setNetworkParameters({
            receiveBroadcasts: true,
            channel: ch,
            panId: np.panId,
          })
          console.log(`${timestamp()} [NET] Switch succeeded`)
        } catch (e) {
          console.error(`${timestamp()} [NET] Switch failed: ${(e as Error).message}`)
        }
      } else {
        console.log(`${timestamp()} [NET] ${np.serialNumber}  PAN ID=${np.panId}  channel=${np.channel}`)
      }
    }

    const sq = deviceScanMatcher(frame)
    if (sq) {
      console.log(`${timestamp()} [SCN] ${sq.serialNumber}  PAN ID=${sq.panId}  → answering`)
      const cmd = `R01${sq.serialNumber}7021FFFF02`
      radio.send(cmd, {
        ackMatcher: () => null,
        ackTimeoutMs: 0,
        responseWindowMs: 0,
      })
    }

    const wr = waveRequestMatcher(frame)
    if (wr) {
      console.log(`${timestamp()} [WAV] ${wr.serialNumber}  wave request received`)
    }

    const nj = networkJoinMatcher(frame)
    if (nj) {
      console.log(`${timestamp()} [KEY] Remote serial:  ${nj.serialNumber}`)
      console.log(`${timestamp()} [KEY] PAN ID:          ${nj.panId}`)
      console.log(`${timestamp()} [KEY] Channel:         ${nj.channel}`)
      console.log(`${timestamp()} [KEY] Encryption key:  ${nj.key}`)
      await radio.close()
      process.exit(0)
    }
  })

  console.log(`${timestamp()} [INF] Listening for broadcasts (Ctrl+C to stop)...`)
}

function signalTraps(cleanup: () => Promise<void>): void {
  let cleaning = false

  async function shutdown(): Promise<void> {
    if (cleaning) return
    cleaning = true
    console.log(`\n${timestamp()} [INF] Shutting down...`)
    await cleanup()
    process.exit(0)
  }

  process.on("SIGINT", () => { shutdown().catch(() => process.exit(1)) })
  process.on("SIGTERM", () => { shutdown().catch(() => process.exit(1)) })
}

main().catch((err) => {
  console.error(`${timestamp()} [ERR] ${(err as Error).message}`)
  process.exit(1)
})
