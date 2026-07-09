export interface Config {
  wmsPort: string
  wmsChannel: number
  wmsPanId: string
  wmsKey: string | undefined
  wmsAllowedSerials: string[] | undefined
  mqttBrokerUrl: string
  mqttUsername: string | undefined
  mqttPassword: string | undefined
  mqttTopicPrefix: string
  mqttDiscoveryPrefix: string
  mqttClientId: string
}

export function loadConfig(): Config {
  const wmsPort = process.env["WMS_PORT"]
  if (!wmsPort) {
    console.error("[CFG] WMS_PORT is required")
    process.exit(1)
  }

  const wmsChannel = Number(process.env["WMS_CHANNEL"])
  if (!Number.isInteger(wmsChannel) || wmsChannel < 11 || wmsChannel > 26) {
    console.error("[CFG] WMS_CHANNEL must be an integer between 11 and 26")
    process.exit(1)
  }

  const rawSerials = process.env["WMS_ALLOWED_SERIALS"] ?? ""
  const wmsAllowedSerials = rawSerials
    ? rawSerials.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined

  return {
    wmsPort,
    wmsChannel,
    wmsPanId: (process.env["WMS_PAN_ID"] ?? "FFFF").toUpperCase(),
    wmsKey: process.env["WMS_KEY"] || undefined,
    wmsAllowedSerials,
    mqttBrokerUrl: process.env["MQTT_BROKER_URL"] ?? "mqtt://localhost:1883",
    mqttUsername: process.env["MQTT_USERNAME"] || undefined,
    mqttPassword: process.env["MQTT_PASSWORD"] || undefined,
    mqttTopicPrefix: process.env["MQTT_TOPIC_PREFIX"] ?? "warema_wms",
    mqttDiscoveryPrefix: process.env["MQTT_DISCOVERY_PREFIX"] ?? "homeassistant",
    mqttClientId: process.env["MQTT_CLIENT_ID"] ?? "wms-js-mqtt-bridge",
  }
}
