export interface WeatherStationMessage {
  serialNumber: string
  windSpeed: number
  temperature: number | null
  rain: boolean
  illuminance: number | null
  battery: number | null
  temperatureIndoor: number | null
  humidity: number | null
  raw: string
}

export function weatherStationMatcher(frame: string): WeatherStationMessage | null {
  if (frame.length < 31) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7080") return null

  const ww = parseInt(frame.slice(13, 15), 16)
  const windSpeed = Number.isFinite(ww) ? +(ww / 2).toFixed(1) : 0

  const l1 = parseInt(frame.slice(15, 17), 16)
  const l2 = parseInt(frame.slice(23, 25), 16)
  const illuminance = (() => {
    if (!Number.isFinite(l1) || !Number.isFinite(l2)) return null
    if (l1 === 0) return l2 * 2
    return l1 * l2 * 2
  })()

  const rain = frame.slice(27, 29) === "C8"

  const tRaw = parseInt(frame.slice(29, 31), 16)
  const temperature = Number.isFinite(tRaw) ? +(tRaw / 2 - 40).toFixed(1) : null

  const bRaw = parseInt(frame.slice(25, 27), 16)
  const battery = Number.isFinite(bRaw) ? +(bRaw / 2).toFixed(1) : null

  let temperatureIndoor: number | null = null
  if (frame.length >= 33) {
    const tiRaw = parseInt(frame.slice(31, 33), 16)
    temperatureIndoor = Number.isFinite(tiRaw) ? +(tiRaw / 2 - 40).toFixed(1) : null
  }

  let humidity: number | null = null
  if (frame.length >= 39) {
    const hRaw = parseInt(frame.slice(37, 39), 16)
    humidity = Number.isFinite(hRaw) ? +(hRaw / 2).toFixed(1) : null
  }

  return {
    serialNumber: frame.slice(1, 7),
    windSpeed,
    temperature,
    rain,
    illuminance,
    battery,
    temperatureIndoor,
    humidity,
    raw: frame,
  }
}
