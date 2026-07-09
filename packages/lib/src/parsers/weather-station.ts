export interface WeatherStationMessage {
  serialNumber: string
  windSpeed: number
  temperature: number | null
  rain: boolean
  illuminance: number | null
  raw: string
}

export function weatherStationMatcher(frame: string): WeatherStationMessage | null {
  if (frame.length < 31) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7080") return null

  const ww = parseInt(frame.slice(13, 15), 16)
  const l1 = parseInt(frame.slice(15, 17), 16)
  const l2 = parseInt(frame.slice(23, 25), 16)
  const rain = frame.slice(25, 27) === "C8"
  const tRaw = parseInt(frame.slice(29, 31), 16)
  const temperature = Number.isFinite(tRaw) ? +(tRaw / 2 - 35).toFixed(1) : null
  const illuminance = (() => {
    if (!Number.isFinite(l1) || !Number.isFinite(l2)) return null
    if (l1 === 0) return l2 * 2
    return l1 * l2 * 2
  })()

  return {
    serialNumber: frame.slice(1, 7),
    windSpeed: ww,
    temperature,
    rain,
    illuminance,
    raw: frame,
  }
}
