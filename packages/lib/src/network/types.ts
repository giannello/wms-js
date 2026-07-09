import type { DeviceScanResponse } from "../parsers/device-scan-response.js"
import type { DeviceStatus } from "../parsers/device-status.js"

export type ConnectionState = "disconnected" | "connecting" | "configured"

export interface KnownDevice {
  serialNumber: string
  deviceType: string
  deviceTypeName: string
  name?: string
  status?: DeviceStatus
}

export interface NetworkEventMap {
  connected: { stickName: string }
  disconnected: {}
  configured: {}
  error: { error: Error }
  weatherStation: { serial: string; windSpeed: number; temperature: number | null; rain: boolean; illuminance: number | null }
  deviceDiscovered: { device: DeviceScanResponse }
  deviceStatus: { serial: string; status: DeviceStatus }
  waveResult: { serial: string; code?: string }
}
