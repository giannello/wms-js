export interface DeviceScanQuery {
  serialNumber: string
  panId: string
  raw: string
}

export function deviceScanMatcher(frame: string): DeviceScanQuery | null {
  if (frame.length < 17) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7020") return null

  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    raw: frame,
  }
}
