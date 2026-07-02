export interface WeatherStationMessage {
  serialNumber: string
  windSpeed: number
  raw: string
}

export function weatherStationMatcher(frame: string): WeatherStationMessage | null {
  if (frame.length < 31) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7080") return null

  return {
    serialNumber: frame.slice(1, 7),
    windSpeed: parseInt(frame.slice(13, 15), 16),
    raw: frame,
  }
}
