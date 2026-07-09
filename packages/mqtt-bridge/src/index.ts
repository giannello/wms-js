import mqtt from "mqtt"
import { NetworkManager } from "@wms-js/lib"
import { info, error, debug } from "@wms-js/lib"
import { loadConfig, type Config } from "./config.js"
import { NodeSerialDriver } from "./driver.js"

function flipDirection(dir: string): string {
  if (dir === "opening") return "closing"
  if (dir === "closing") return "opening"
  return "stopped"
}

function main(): void {
  const config = loadConfig()

  const driver = new NodeSerialDriver()
  const manager = new NetworkManager(driver)

  const mqttClient = mqtt.connect(config.mqttBrokerUrl, {
    clientId: config.mqttClientId,
    username: config.mqttUsername,
    password: config.mqttPassword,
    will: {
      topic: `${config.mqttTopicPrefix}/status`,
      payload: "offline",
      qos: 1,
      retain: true,
    },
  })

  let mqttConnected = false
  let wmsConfigured = false
  let cleaning = false

  const coverDevices = new Map<string, { serial: string; deviceTypeName: string }>()
  const allWsSerials = new Set<string>()
  const wsDiscoverySent = new Set<string>()

  function publishOnlineIfReady(): void {
    if (mqttConnected && wmsConfigured) {
      mqttClient.publish(`${config.mqttTopicPrefix}/status`, "online", { qos: 1, retain: true })
      info("BRDG", "Online")
    }
  }

  function publishCoverDiscovery(serial: string, deviceTypeName: string): void {
    const topic = `${config.mqttDiscoveryPrefix}/cover/warema_wms_${serial}/config`
    const payload = JSON.stringify({
      "~": config.mqttTopicPrefix,
      name: null,
      unique_id: `warema_wms_${serial}`,
      device_class: "shade",
      command_topic: `~/${serial}/command`,
      state_topic: `~/${serial}/status`,
      value_template: "{{ value_json.direction }}",
      state_opening: "opening",
      state_closing: "closing",
      state_stopped: "stopped",
      position_topic: `~/${serial}/status`,
      position_template: "{{ value_json.position }}",
      set_position_topic: `~/${serial}/set_position`,
      payload_open: "OPEN",
      payload_close: "CLOSE",
      payload_stop: "STOP",
      qos: 1,
      origin: {
        name: "wms-js",
        sw: "0.1.0",
        url: "https://github.com/giannello/wms-js",
      },
      device: {
        identifiers: [`warema_wms_${serial}`],
        name: `${deviceTypeName}`,
        manufacturer: "Warema",
        model: "WMS Plug receiver",
        serial_number: serial,
      },
    })
    mqttClient.publish(topic, payload, { qos: 1, retain: true })
    info("DISC", `Cover ${serial}`)
  }

  function publishWsDiscovery(serial: string): void {
    const topic = `${config.mqttDiscoveryPrefix}/sensor/warema_wms_ws_${serial}/config`
    const payload = JSON.stringify({
      "~": config.mqttTopicPrefix,
      name: "Wind Speed",
      unique_id: `warema_wms_ws_${serial}`,
      state_topic: `~/weather/${serial}`,
      unit_of_measurement: "km/h",
      value_template: "{{ value_json.wind_speed }}",
      device_class: "wind_speed",
      state_class: "measurement",
      qos: 0,
      origin: {
        name: "wms-js",
        sw: "0.1.0",
        url: "https://github.com/giannello/wms-js",
      },
      device: {
        identifiers: [`warema_wms_ws_${serial}`],
        name: "Weather Station",
        manufacturer: "Warema",
        model: "WMS Weather station",
        serial_number: serial,
      },
    })
    mqttClient.publish(topic, payload, { qos: 1, retain: true })
    info("DISC", `Weather station ${serial}`)
  }

  async function cleanup(): Promise<void> {
    if (cleaning) return
    cleaning = true
    info("BRDG", "Shutting down...")
    mqttClient.publish(`${config.mqttTopicPrefix}/status`, "offline", { qos: 1, retain: true })
    await manager.close()
    await new Promise<void>((resolve, reject) => mqttClient.end(false, {}, (err) => err ? reject(err) : resolve()))
  }

  function shutdown(): void {
    cleanup().catch(() => process.exit(1))
  }

  process.on("SIGINT", () => shutdown())
  process.on("SIGTERM", () => shutdown())

  // --- MQTT handlers ---
  mqttClient.on("connect", () => {
    info("MQTT", `Connected to ${config.mqttBrokerUrl}`)
    mqttConnected = true
    mqttClient.subscribe(`${config.mqttTopicPrefix}/+/command`)
    info("MQTT", `Subscribed to ${config.mqttTopicPrefix}/+/command`)
    mqttClient.subscribe(`${config.mqttTopicPrefix}/+/set_position`)
    info("MQTT", `Subscribed to ${config.mqttTopicPrefix}/+/set_position`)
    mqttClient.subscribe(`${config.mqttTopicPrefix}/scan`)
    info("MQTT", `Subscribed to ${config.mqttTopicPrefix}/scan`)
    mqttClient.subscribe(`${config.mqttDiscoveryPrefix}/status`)
    info("MQTT", `Subscribed to ${config.mqttDiscoveryPrefix}/status`)
    publishOnlineIfReady()
  })

  mqttClient.on("message", (topic, buf) => {
    const payload = buf.toString()

    if (topic === `${config.mqttDiscoveryPrefix}/status` && payload === "online") {
      info("BRDG", "HA birth — resending discovery")
      wsDiscoverySent.clear()
      for (const [serial, d] of coverDevices) {
        publishCoverDiscovery(serial, d.deviceTypeName)
        manager.queryStatus(serial)
      }
      for (const serial of allWsSerials) {
        publishWsDiscovery(serial)
        wsDiscoverySent.add(serial)
      }
      return
    }

    const prefix = config.mqttTopicPrefix
    if (!topic.startsWith(prefix + "/")) return
    const rest = topic.slice(prefix.length + 1)
    const parts = rest.split("/")

    if (parts.length === 1 && parts[0] === "scan") {
      const panId = payload.trim() || config.wmsPanId
      info("CMD", `Scan network PAN ID=${panId}`)
      manager.scanNetwork(panId)
      return
    }

    if (parts.length !== 2) return
    const [serial, action] = parts

    if (action === "command") {
      switch (payload) {
        case "OPEN":
          info("CMD", `${serial} → OPEN (pos=0)`)
          manager.moveToPosition(serial, 0)
          break
        case "CLOSE":
          info("CMD", `${serial} → CLOSE (pos=100)`)
          manager.moveToPosition(serial, 100)
          break
        case "STOP":
          info("CMD", `${serial} → STOP`)
          manager.stopDevice(serial)
          break
        default:
          debug("CMD", `${serial} unknown command: ${payload}`)
      }
    } else if (action === "set_position") {
      const pos = parseInt(payload, 10)
      if (isNaN(pos) || pos < 0 || pos > 100) {
        debug("CMD", `${serial} invalid set_position: ${payload}`)
        return
      }
      const wmsPos = 100 - pos
      info("CMD", `${serial} → set_position ${wmsPos} (HA ${pos})`)
      manager.moveToPosition(serial, wmsPos)
    }
  })

  mqttClient.on("error", (err) => {
    error("MQTT", err.message)
  })

  // --- WMS handlers ---
  manager.on("configured", () => {
    info("WMS", "Network configured — scanning...")
    wmsConfigured = true
    manager.scanNetwork(config.wmsPanId)
    publishOnlineIfReady()
  })

  manager.on("disconnected", () => {
    error("WMS", "Serial port disconnected")
    process.exit(1)
  })

  manager.on("error", (e) => {
    error("WMS", e.error.message)
  })

  manager.on("deviceDiscovered", ({ device }) => {
    if (config.wmsAllowedSerials && !config.wmsAllowedSerials.includes(device.serialNumber)) {
      debug("FILT", `${device.serialNumber} filtered out`)
      return
    }
    coverDevices.set(device.serialNumber, {
      serial: device.serialNumber,
      deviceTypeName: device.deviceTypeName,
    })
    publishCoverDiscovery(device.serialNumber, device.deviceTypeName)
    manager.queryStatus(device.serialNumber)
  })

  manager.on("deviceStatus", ({ serial, status }) => {
    const payload = JSON.stringify({
      position: status.position !== undefined ? 100 - status.position : undefined,
      moving: status.moving,
      inclination: status.inclination,
      direction: flipDirection(status.direction),
    })
    mqttClient.publish(`${config.mqttTopicPrefix}/${serial}/status`, payload, {
      qos: 0,
      retain: true,
    })
    debug("STAT", `${serial} → ${payload}`)
  })

  manager.on("weatherStation", ({ serial, windSpeed }) => {
    allWsSerials.add(serial)
    if (!wsDiscoverySent.has(serial)) {
      wsDiscoverySent.add(serial)
      publishWsDiscovery(serial)
    }
    mqttClient.publish(
      `${config.mqttTopicPrefix}/weather/${serial}`,
      JSON.stringify({ wind_speed: windSpeed }),
      { qos: 0, retain: true },
    )
    debug("WTHR", `${serial} wind=${windSpeed} km/h`)
  })

  // --- Open serial ---
  manager.open(config.wmsPort, {
    channel: config.wmsChannel,
    panId: config.wmsPanId,
    key: config.wmsKey,
  }).catch((err) => {
    error("WMS", `Failed: ${(err as Error).message}`)
    process.exit(1)
  })
}

main()
