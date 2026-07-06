import React from "react"
import { createRoot } from "react-dom/client"
import { startMonitor, type DiscoveryEvent } from "./browser.js"
import type { DeviceScanResponse, DeviceStatus } from "@warema/lib"

type StationData = { serialNumber: string; windSpeed: number }

const NAMES_KEY = "wms-device-names"
const HIDDEN_KEY = "wms-hidden-serials"

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

function App() {
  const [stations, setStations] = React.useState<Map<string, StationData>>(new Map())
  const [status, setStatus] = React.useState<"connect" | "connecting" | "monitoring" | "error">("connect")
  const [error, setError] = React.useState("")
  const commandsRef = React.useRef<{
    scanNetwork: (panId: string) => Promise<DeviceScanResponse[]>
    getDeviceStatus: (serialNumber: string) => Promise<DeviceStatus>
    waveDevice: (serialNumber: string) => Promise<{ serialNumber: string; code?: string }>
    stopDevice: (serialNumber: string) => Promise<void>
    moveToPosition: (serialNumber: string, position: number, inclination?: number) => Promise<void>
  } | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [scanDevices, setScanDevices] = React.useState<DeviceScanResponse[]>([])
  const [scanError, setScanError] = React.useState("")
  const [deviceStatuses, setDeviceStatuses] = React.useState<Map<string, DeviceStatus>>(new Map())
  const [statusErrors, setStatusErrors] = React.useState<Map<string, string>>(new Map())
  const [queryingSerial, setQueryingSerial] = React.useState("")
  const [refreshing, setRefreshing] = React.useState(false)
  const [refreshSummary, setRefreshSummary] = React.useState("")
  const [deviceNames, setDeviceNames] = React.useState<Record<string, string>>(loadNames)
  const [hiddenSerials, setHiddenSerials] = React.useState<Set<string>>(loadHidden)
  const [wavingSerial, setWavingSerial] = React.useState("")
  const [waveMessages, setWaveMessages] = React.useState<Map<string, string>>(new Map())
  const [moveMessages, setMoveMessages] = React.useState<Map<string, string>>(new Map())

  const handleConnect = async () => {
    try {
      const p = await (navigator as any).serial.requestPort({
        filters: [{ usbVendorId: 0x0403, usbProductId: 0x6001 }],
      })

      const stored = localStorage.getItem("wms-network-params")
      if (!stored) {
        setStatus("error")
        setError('No network parameters found. Go to <a href="/discovery.html" class="underline text-emerald-400">the discovery page</a> to find them first.')
        return
      }

      const params = JSON.parse(stored)
      setStatus("connecting")

      const { commands } = await startMonitor(p, params, (evt) => {
        if (evt.type === "connected") {
          setStatus("monitoring")
        }
        if (evt.type === "weather-station") {
          const serial = evt.serialNumber as string
          setStations((prev) => {
            const next = new Map(prev)
            next.set(serial, { serialNumber: serial, windSpeed: evt.windSpeed as number })
            return next
          })
        }
        if (evt.type === "error") {
          setError((evt as any).message || "")
          setStatus("error")
        }
      })
      commandsRef.current = commands
    } catch {
      // user cancelled port picker
    }
  }

  const handleScan = async () => {
    if (!commandsRef.current) return
    const stored = localStorage.getItem("wms-network-params")
    if (!stored) {
      setScanError("No network parameters found")
      return
    }
    const params = JSON.parse(stored) as { panId: string }
    setScanning(true)
    setScanError("")
    try {
      const results = await commandsRef.current.scanNetwork(params.panId)
      setScanDevices((prev) => {
        const map = new Map(prev.map((d) => [d.serialNumber, d]))
        for (const d of results) map.set(d.serialNumber, d)
        return [...map.values()]
      })
    } catch (e) {
      setScanError((e as Error).message)
    }
    setScanning(false)
  }

  const handleQueryStatus = async (serialNumber: string) => {
    if (!commandsRef.current) return
    setQueryingSerial(serialNumber)
    setStatusErrors((prev) => {
      const next = new Map(prev)
      next.delete(serialNumber)
      return next
    })
    try {
      const status = await commandsRef.current.getDeviceStatus(serialNumber)
      setDeviceStatuses((prev) => {
        const next = new Map(prev)
        next.set(serialNumber, status)
        return next
      })
    } catch (e) {
      setStatusErrors((prev) => {
        const next = new Map(prev)
        next.set(serialNumber, (e as Error).message)
        return next
      })
    }
    setQueryingSerial("")
  }

  const handleRefreshAll = async () => {
    if (!commandsRef.current || scanDevices.length === 0) return
    setRefreshing(true)
    setRefreshSummary("")
    const results = await Promise.all(
      scanDevices.map(async (d) => {
        try {
          const status = await commandsRef.current!.getDeviceStatus(d.serialNumber)
          return { serial: d.serialNumber, status }
        } catch (err) {
          return { serial: d.serialNumber, error: (err as Error).message }
        }
      }),
    )
    let ok = 0
    let fail = 0
    const newStatuses = new Map<string, DeviceStatus>()
    const newErrors = new Map<string, string>()
    for (const r of results) {
      if ("status" in r) {
        ok++
        if (r.status) newStatuses.set(r.serial, r.status)
      } else {
        fail++
        newErrors.set(r.serial, r.error)
      }
    }
    setRefreshSummary(
      ok > 0
        ? `Updated ${ok} device${ok > 1 ? "s" : ""}${fail > 0 ? ` (${fail} failed)` : ""}`
        : `No devices responded (${fail} failed)`,
    )
    setDeviceStatuses((prev) => {
      const next = new Map(prev)
      for (const [k, v] of newStatuses) next.set(k, v)
      return next
    })
    setStatusErrors((prev) => {
      const next = new Map(prev)
      for (const [k, v] of newErrors) next.set(k, v)
      return next
    })
    setRefreshing(false)
  }

  const handleDeleteDevice = (serial: string) => {
    setScanDevices((prev) => prev.filter((d) => d.serialNumber !== serial))
    setDeviceStatuses((prev) => {
      const next = new Map(prev)
      next.delete(serial)
      return next
    })
    setStatusErrors((prev) => {
      const next = new Map(prev)
      next.delete(serial)
      return next
    })
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

  const handleWaveDevice = async (serial: string) => {
    if (!commandsRef.current) return
    setWavingSerial(serial)
    setWaveMessages((prev) => {
      const next = new Map(prev)
      next.delete(serial)
      return next
    })
    try {
      const result = await commandsRef.current.waveDevice(serial)
      const msg = result.code ? `Waved! code=${result.code}` : "Waved!"
      setWaveMessages((prev) => new Map(prev).set(serial, msg))
    } catch (err) {
      setWaveMessages((prev) => new Map(prev).set(serial, `Wave failed: ${(err as Error).message}`))
    }
    setWavingSerial("")
  }

  const handleMove = async (serial: string, direction: "up" | "down" | "stop") => {
    if (!commandsRef.current) return
    try {
      if (direction === "stop") {
        await commandsRef.current.stopDevice(serial)
        setMoveMessages((prev) => new Map(prev).set(serial, "Stopped"))
      } else {
        const position = direction === "up" ? 0 : 100
        await commandsRef.current.moveToPosition(serial, position)
        setMoveMessages((prev) => new Map(prev).set(serial, `Moving ${direction}...`))
      }
      commandsRef.current.getDeviceStatus(serial).then((status) => {
        setDeviceStatuses((prev) => new Map(prev).set(serial, status))
        setStatusErrors((prev) => {
          const next = new Map(prev)
          next.delete(serial)
          return next
        })
      }).catch(() => {})
    } catch (err) {
      setMoveMessages((prev) => new Map(prev).set(serial, `Move failed: ${(err as Error).message}`))
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold text-emerald-400">WMS Network Monitor</h1>

      {status === "connect" && (
        <button
          onClick={handleConnect}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors"
        >
          Connect USB Stick
        </button>
      )}

      {status === "connecting" && (
        <div className="flex items-center gap-2 text-gray-400">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
          Configuring network...
        </div>
      )}

      {status === "error" && (
        <div
          className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400"
          dangerouslySetInnerHTML={{ __html: error }}
        />
      )}

      {status === "monitoring" && stations.size === 0 && (
        <div className="text-gray-500">Waiting for weather station broadcasts...</div>
      )}

      {status === "monitoring" && [...stations.values()].map((s) => (
        <div key={s.serialNumber} className="bg-gray-900 border border-emerald-700 rounded-lg p-4">
          <div className="text-gray-400 text-xs uppercase tracking-wide">Serial</div>
          <div className="text-white font-semibold mt-1">{s.serialNumber}</div>
          <div className="text-gray-400 text-xs uppercase tracking-wide mt-3">Wind Speed</div>
          <div className="text-emerald-400 font-bold text-2xl mt-1">{s.windSpeed} km/h</div>
        </div>
      ))}

      {status === "monitoring" && (
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

          {scanDevices.length > 0 && (
            <button
              onClick={handleRefreshAll}
              disabled={refreshing}
              className="ml-2 px-6 py-3 bg-violet-700 hover:bg-violet-600 disabled:bg-violet-800 disabled:cursor-wait text-white rounded-lg font-semibold text-sm transition-colors"
            >
              {refreshing ? "Refreshing..." : "Refresh All"}
            </button>
          )}

          {refreshSummary && (
            <div className="text-sm text-gray-500">{refreshSummary}</div>
          )}

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

          {scanDevices.filter((d) => !hiddenSerials.has(d.serialNumber)).map((d) => {
            const ds = deviceStatuses.get(d.serialNumber)
            const err = statusErrors.get(d.serialNumber)
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
                    disabled={queryingSerial === d.serialNumber}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-wait text-white rounded text-xs font-semibold transition-colors shrink-0"
                  >
                    {queryingSerial === d.serialNumber ? "..." : "Status"}
                  </button>
                  <button
                    onClick={() => handleWaveDevice(d.serialNumber)}
                    disabled={wavingSerial === d.serialNumber}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-800 disabled:cursor-wait text-white rounded text-xs font-semibold transition-colors shrink-0"
                  >
                    {wavingSerial === d.serialNumber ? "..." : "Wave"}
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
                {err && (
                  <div className="mt-2 text-xs text-red-400">{err}</div>
                )}
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
                        {ds.moving ? "Yes" : "No"}
                      </span>
                    </div>
                  </div>
                )}
                {(() => {
                  const mm = moveMessages.get(d.serialNumber)
                  if (!mm) return null
                  const ok = !mm.startsWith("Move failed")
                  return (
                    <div className={`mt-2 text-xs ${ok ? "text-emerald-400" : "text-red-400"}`}>
                      {mm}
                    </div>
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
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
