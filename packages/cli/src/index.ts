import { RadioController, Commands, weatherStationMatcher } from "@warema/lib"
import { NodeSerialDriver } from "./node-serial.js"

function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `[${hh}:${mm}:${ss}]`
}

function usage(): never {
  console.error(`Usage: tsx packages/cli/src/index.ts --port <path> --channel <n> [options]

Options:
  --port <path>       Serial port path (e.g. /dev/ttyUSB0)
  --channel <n>       Radio channel (11-26)
  --pan-id <XXXX>     PAN ID in hex, defaults to FFFF
  --key <hex>         32-char hex encryption key (optional, for encrypted networks)
  --help              Show this help
`)
  process.exit(1)
}

function parseArgs(): {
  port: string
  channel: number
  panId: string
  key: string | undefined
} {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes("--help")) usage()

  let port = ""
  let channel = 0
  let panId = "FFFF"
  let key: string | undefined

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        port = args[++i] ?? ""
        break
      case "--channel":
        channel = Number(args[++i])
        break
      case "--pan-id":
        panId = args[++i] ?? "FFFF"
        break
      case "--key":
        key = args[++i]
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

  if (channel < 11 || channel > 26) {
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

  return { port, channel, panId: panId.toUpperCase(), key }
}

async function main(): Promise<void> {
  const { port, channel, panId, key } = parseArgs()

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

  radio.onBroadcast((frame) => {
    console.log(`${timestamp()} [<<] {${frame}}`)

    const ws = weatherStationMatcher(frame)
    if (ws) {
      console.log(`${timestamp()} [WS]  ${ws.serialNumber}  wind=${ws.windSpeed} km/h`)
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
