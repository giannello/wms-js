export interface DeviceScanResponse {
  serialNumber: string
  panId: string
  deviceType: string
  unknown: string
  raw: string
}

export function deviceScanResponseMatcher(frame: string): DeviceScanResponse | null {
  if (frame.length < 57) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7021") return null

  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    deviceType: frame.slice(15, 17),
    unknown: frame.slice(17, 57),
    raw: frame,
  }
}
