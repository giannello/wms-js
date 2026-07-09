import React from "react"
import { createRoot } from "react-dom/client"
import { startMonitor, type DiscoveryEvent } from "./browser.js"
import type { NetworkManager, KnownDevice, LogLevel } from "@wms-js/lib"
import { setLogLevel, LogLevel as LV } from "@wms-js/lib"

const NETWORK_PARAMS_KEY = "wms-network-params"
const NAMES_KEY = "wms-device-names"
const HIDDEN_KEY = "wms-hidden-serials"
const LOG_LEVEL_KEY = "wms-log-level"

function loadLogLevel(): number {
  try {
    const v = localStorage.getItem(LOG_LEVEL_KEY)
    if (v === "debug") return LV.DEBUG
    if (v === "info") return LV.INFO
    if (v === "warn") return LV.WARN
    if (v === "error") return LV.ERROR
    if (v === "silent") return LV.SILENT
  } catch { /* ignore */ }
  return LV.INFO
}

function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) || "{}")
  } catch {
    return {}
  }
}

function saveNames(names: Record<string, string>) {
  localStorage.setItem(NAMES_KEY, JSON.stringify(names))
}

function loadHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"))
  } catch {
    return new Set()
  }
}

function saveHidden(hidden: Set<string>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
}

type WeatherStationEvent = { serialNumber: string; windSpeed: number; temperature: number | null; rain: boolean; illuminance: number | null; battery: number | null; temperatureIndoor: number | null; humidity: number | null }

function App() {
  const managerRef = React.useRef<NetworkManager | null>(null)
  const [connectionState, setConnectionState] = React.useState<
    "connect" | "connecting" | "monitoring" | "error"
  >("connect")
  const [connectionError, setConnectionError] = React.useState("")

  const hasNetworkParams = (() => {
    try {
      return !!localStorage.getItem(NETWORK_PARAMS_KEY)
    } catch {
      return false
    }
  })()
  const [stations, setStations] = React.useState<Map<string, WeatherStationEvent>>(new Map())
  const [deviceNames, setDeviceNames] = React.useState<Record<string, string>>(loadNames)
  const [hiddenSerials, setHiddenSerials] = React.useState<Set<string>>(loadHidden)
  const [scanning, setScanning] = React.useState(false)
  const [scanError, setScanError] = React.useState("")
  const [waveMessages, setWaveMessages] = React.useState<Map<string, string>>(new Map())
  const [moveMessages, setMoveMessages] = React.useState<Map<string, string>>(new Map())

  const [logLevel, setLogLevelState] = React.useState<number>(loadLogLevel)
  React.useEffect(() => setLogLevel(logLevel as LogLevel), [logLevel])

  const [, forceRender] = React.useReducer((x: number) => x + 1, 0)

  const devices: KnownDevice[] = managerRef.current?.knownDevices ?? []
  const visibleDevices = devices.filter((d) => !hiddenSerials.has(d.serialNumber))

  const handleConnect = async () => {
    try {
      const p = await (navigator as any).serial.requestPort({
        filters: [{ usbVendorId: 0x0403, usbProductId: 0x6001 }],
      })

      const stored = localStorage.getItem("wms-network-params")
      if (!stored) {
        setConnectionState("error")
        setConnectionError(
          'No network parameters found. Go to <a href="/discovery.html" class="underline text-emerald-400">the discovery page</a> to find them first.',
        )
        return
      }

      const params = JSON.parse(stored)
      setConnectionState("connecting")

      const manager = await startMonitor(p, params, (evt) => {
        if (evt.type === "connected") {
          setConnectionState("monitoring")
        }
        if (evt.type === "weather-station") {
          const serial = evt.serialNumber as string
          setStations((prev) => {
            const next = new Map(prev)
            next.set(serial, {
              serialNumber: serial,
              windSpeed: evt.windSpeed as number,
              temperature: evt.temperature as number | null,
              rain: evt.rain as boolean,
              illuminance: evt.illuminance as number | null,
              battery: evt.battery as number | null,
              temperatureIndoor: evt.temperatureIndoor as number | null,
              humidity: evt.humidity as number | null,
            })
            return next
          })
        }
        if (evt.type === "error") {
          setConnectionError((evt as any).message || "")
          setConnectionState("error")
        }
      })

      managerRef.current = manager

      manager.on("deviceDiscovered", () => forceRender())
      manager.on("deviceStatus", () => forceRender())
      manager.on("waveResult", (e) => {
        const msg = e.code ? `Waved! code=${e.code}` : "Waved!"
        setWaveMessages((prev) => new Map(prev).set(e.serial, msg))
      })
    } catch {
      if (connectionState === "connecting") {
        setConnectionState("connect")
      }
    }
  }

  const handleScan = async () => {
    const manager = managerRef.current
    if (!manager) return
    const stored = localStorage.getItem("wms-network-params")
    if (!stored) {
      setScanError("No network parameters found")
      return
    }
    const params = JSON.parse(stored) as { panId: string }
    setScanning(true)
    setScanError("")
    manager.scanNetwork(params.panId)
    setTimeout(() => setScanning(false), 3000)
  }

  const handleQueryStatus = (serialNumber: string) => {
    managerRef.current?.queryStatus(serialNumber)
  }

  const handleRefreshAll = () => {
    const manager = managerRef.current
    if (!manager || visibleDevices.length === 0) return
    for (const d of visibleDevices) {
      manager.queryStatus(d.serialNumber)
    }
  }

  const handleDeleteDevice = (serial: string) => {
    setDeviceNames((prev) => {
      const next = { ...prev }
      delete next[serial]
      saveNames(next)
      return next
    })
    setHiddenSerials((prev) => {
      const next = new Set(prev)
      next.add(serial)
      saveHidden(next)
      return next
    })
  }

  const handleNameChange = (serial: string, name: string) => {
    setDeviceNames((prev) => {
      const next = { ...prev, [serial]: name }
      saveNames(next)
      return next
    })
  }

  const handleWaveDevice = (serial: string) => {
    managerRef.current?.waveDevice(serial)
  }

  const handleMove = async (serial: string, direction: "up" | "down" | "stop") => {
    const manager = managerRef.current
    if (!manager) return
    try {
      if (direction === "stop") {
        manager.stopDevice(serial)
      } else {
        const position = direction === "up" ? 0 : 100
        manager.moveToPosition(serial, position)
      }
    } catch {
      setMoveMessages((prev) => new Map(prev).set(serial, `Move failed`))
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-emerald-400">WMS Network Monitor</h1>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Log level:</span>
            <select
              value={
                logLevel === LV.DEBUG ? "debug"
                : logLevel === LV.INFO ? "info"
                : logLevel === LV.WARN ? "warn"
                : logLevel === LV.ERROR ? "error"
                : "silent"
              }
              onChange={(e) => {
                const v = e.target.value
                const level = v === "debug" ? LV.DEBUG : v === "info" ? LV.INFO : v === "warn" ? LV.WARN : v === "error" ? LV.ERROR : LV.SILENT
                localStorage.setItem(LOG_LEVEL_KEY, v)
                setLogLevelState(level)
              }}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-violet-500"
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="silent">Silent</option>
            </select>
          </div>
          {hiddenSerials.size > 0 && (
            <button
              onClick={() => {
                setHiddenSerials(new Set())
                localStorage.removeItem(HIDDEN_KEY)
              }}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Restore {hiddenSerials.size} hidden device{hiddenSerials.size > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {connectionState === "connect" && hasNetworkParams && (
        <button
          onClick={handleConnect}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors"
        >
          Connect USB Stick
        </button>
      )}

      {connectionState === "connect" && !hasNetworkParams && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400">
          No network parameters found. Go to{" "}
          <a href="/discovery.html" className="underline text-emerald-400">
            the discovery page
          </a>{" "}
          to discover them first.
        </div>
      )}

      {connectionState === "connecting" && (
        <div className="flex items-center gap-2 text-gray-400">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
          Configuring network...
        </div>
      )}

      {connectionState === "error" && (
        <div
          className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400"
          dangerouslySetInnerHTML={{ __html: connectionError }}
        />
      )}

      {connectionState === "monitoring" && (
        <div className="space-y-3 pt-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-6 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-wait text-white rounded-lg font-semibold text-sm transition-colors"
          >
            {scanning ? "Scanning..." : "Scan Network"}
          </button>

          {scanError && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400">{scanError}</div>
          )}

          {visibleDevices.length > 0 && (
            <button
              onClick={handleRefreshAll}
              className="ml-2 px-6 py-3 bg-violet-700 hover:bg-violet-600 text-white rounded-lg font-semibold text-sm transition-colors"
            >
              Refresh All
            </button>
          )}

          {visibleDevices.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visibleDevices.map((d) => {
                const ds = d.status
                const name = deviceNames[d.serialNumber] || ""
                return (
                  <div key={d.serialNumber} className="bg-gray-900 border border-violet-700 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-2">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => handleNameChange(d.serialNumber, e.target.value)}
                        placeholder="Name this device"
                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                      />
                      <button
                        onClick={() => handleQueryStatus(d.serialNumber)}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded text-xs font-semibold transition-colors shrink-0"
                      >
                        Status
                      </button>
                      <button
                        onClick={() => handleWaveDevice(d.serialNumber)}
                        className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors shrink-0"
                      >
                        Wave
                      </button>
                      <button
                        onClick={() => handleDeleteDevice(d.serialNumber)}
                        className="px-2 py-1.5 bg-red-900/50 hover:bg-red-700 text-red-400 hover:text-white rounded text-xs font-semibold transition-colors shrink-0"
                        title="Remove device"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <span>{d.serialNumber}</span>
                      <span>·</span>
                      <span className="text-violet-400 font-semibold">{d.deviceTypeName}</span>
                    </div>
                    {(() => {
                      const wm = waveMessages.get(d.serialNumber)
                      if (!wm) return null
                      const ok = !wm.startsWith("Wave failed")
                      return (
                        <div className={`mt-2 text-xs ${ok ? "text-emerald-400" : "text-red-400"}`}>
                          {wm}
                        </div>
                      )
                    })()}
                    {ds && (
                      <div className="mt-3 pt-3 border-t border-gray-700 space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Position</span>
                          <span className="text-violet-300 font-semibold">{ds.position}%</span>
                        </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Moving</span>
                      <span className={ds.moving ? "text-yellow-400 font-semibold" : "text-gray-500"}>
                        {ds.moving ? (ds.direction === "opening" ? "▲ Up" : "▼ Down") : "—"}
                      </span>
                    </div>
                      </div>
                    )}
                    {(() => {
                      const mm = moveMessages.get(d.serialNumber)
                      if (!mm || !mm.startsWith("Move failed")) return null
                      return (
                        <div className="mt-2 text-xs text-red-400">{mm}</div>
                      )
                    })()}
                    <div className="mt-3 pt-3 border-t border-gray-700 flex gap-2">
                      <button
                        onClick={() => handleMove(d.serialNumber, "up")}
                        className="flex-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors"
                      >
                        ▲ Up
                      </button>
                      <button
                        onClick={() => handleMove(d.serialNumber, "down")}
                        className="flex-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors"
                      >
                        ▼ Down
                      </button>
                      <button
                        onClick={() => handleMove(d.serialNumber, "stop")}
                        className="flex-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-xs font-semibold transition-colors"
                      >
                        ■ Stop
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Weather Stations</h2>
            {stations.size === 0 ? (
              <div className="text-gray-500 mt-2">Waiting for weather station broadcasts...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                {[...stations.values()].map((s) => (
                  <div key={s.serialNumber} className="bg-gray-900 border border-emerald-700 rounded-lg p-4">
                    <div className="text-gray-400 text-xs uppercase tracking-wide">Serial</div>
                    <div className="text-white font-semibold mt-1">{s.serialNumber}</div>
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <div className="text-gray-400 text-xs uppercase tracking-wide">Wind</div>
                        <div className="text-emerald-400 font-bold text-xl mt-1">{s.windSpeed} km/h</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs uppercase tracking-wide">Light</div>
                        <div className="text-yellow-300 font-semibold text-sm mt-1">
                          {s.illuminance !== null ? `${s.illuminance.toLocaleString()} lx` : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)