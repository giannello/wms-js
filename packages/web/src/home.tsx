import React from "react"
import { createRoot } from "react-dom/client"
import { startMonitor, type DiscoveryEvent } from "./browser.js"
import type { DeviceScanResponse } from "@warema/lib"

type StationData = { serialNumber: string; windSpeed: number }

function App() {
  const [stations, setStations] = React.useState<Map<string, StationData>>(new Map())
  const [status, setStatus] = React.useState<"connect" | "connecting" | "monitoring" | "error">("connect")
  const [error, setError] = React.useState("")
  const commandsRef = React.useRef<{ scanNetwork: (panId: string) => Promise<DeviceScanResponse[]> } | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [scanDevices, setScanDevices] = React.useState<DeviceScanResponse[]>([])
  const [scanError, setScanError] = React.useState("")

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
      setScanDevices(results)
    } catch (e) {
      setScanError((e as Error).message)
    }
    setScanning(false)
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

          {scanDevices.map((d) => (
            <div key={d.serialNumber} className="bg-gray-900 border border-violet-700 rounded-lg p-4">
              <div className="text-gray-400 text-xs uppercase tracking-wide">Serial</div>
              <div className="text-white font-semibold mt-1">{d.serialNumber}</div>
              <div className="text-gray-400 text-xs uppercase tracking-wide mt-3">Device Type</div>
              <div className="text-violet-400 font-bold text-2xl mt-1">{d.deviceType}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
