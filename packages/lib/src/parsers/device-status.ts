import { getDeviceTypeName } from "./device-scan-response.js"

export type DeviceDirection = "opening" | "closing" | "stopped"

export interface DeviceStatus {
  serialNumber: string
  deviceType: string
  deviceTypeName: string
  position: number
  inclination: number
  valance1: number
  valance2: number
  moving: boolean
  direction: DeviceDirection
  raw: string
}

export function deviceStatusMatcher(frame: string): DeviceStatus | null {
  if (frame.length < 29) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "8011") return null

  const deviceType = frame.slice(17, 19)
  return {
    serialNumber: frame.slice(1, 7),
    deviceType,
    deviceTypeName: getDeviceTypeName(deviceType),
    position: Math.round(parseInt(frame.slice(19, 21), 16) / 2),
    inclination: parseInt(frame.slice(21, 23), 16) - 127,
    valance1: parseInt(frame.slice(23, 25), 16),
    valance2: parseInt(frame.slice(25, 27), 16),
    moving: frame.slice(27, 29) === "01",
    direction: "stopped",
    raw: frame,
  }
}
