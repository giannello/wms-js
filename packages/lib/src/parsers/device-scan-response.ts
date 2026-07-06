const DEVICE_TYPE_NAMES: Record<string, string> = {
  "25": "Awning",
}

export function getDeviceTypeName(code: string): string {
  return DEVICE_TYPE_NAMES[code] ?? "Unknown"
}

export interface DeviceScanResponse {
  serialNumber: string
  panId: string
  deviceType: string
  deviceTypeName: string
  unknown: string
  raw: string
}

export function deviceScanResponseMatcher(frame: string): DeviceScanResponse | null {
  if (frame.length < 57) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7021") return null

  const deviceType = frame.slice(15, 17)
  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    deviceType,
    deviceTypeName: getDeviceTypeName(deviceType),
    unknown: frame.slice(17, 57),
    raw: frame,
  }
}
