import React from "react"
import { createRoot } from "react-dom/client"
import { startDiscovery, type DiscoveryEvent } from "./browser.js"

type Step = "connect" | "paired" | "press-a" | "press-stop" | "complete"

function App() {
  const [port, setPort] = React.useState<SerialPort | null>(null)
  const [running, setRunning] = React.useState(false)
  const [step, setStep] = React.useState<Step>("connect")
  const [events, setEvents] = React.useState<DiscoveryEvent[]>([])
  const [result, setResult] = React.useState<DiscoveryEvent | null>(null)
  const [error, setError] = React.useState("")
  const eventsRef = React.useRef<DiscoveryEvent[]>([])
  const [storedParams, setStoredParams] = React.useState<{
    panId: string
    channel: number
    key: string
  } | null>(() => {
    try {
      const raw = localStorage.getItem("wms-network-params")
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  const handleClear = () => {
    localStorage.removeItem("wms-network-params")
    setStoredParams(null)
  }
  const logEndRef = React.useRef<HTMLDivElement | null>(null)

  const addEvent = React.useCallback((evt: DiscoveryEvent) => {
    eventsRef.current = [...eventsRef.current, evt]
    setEvents(eventsRef.current)
  }, [])

  const handleConnect = async () => {
    try {
      const p = await (navigator as any).serial.requestPort({
        filters: [{ usbVendorId: 0x0403, usbProductId: 0x6001 }],
      })
      setPort(p)
      setRunning(true)
      setResult(null)
      setError("")
      eventsRef.current = []
      setEvents([])
      try {
        await startDiscovery(p, (evt) => {
          if (evt.type === "connected") {
            setStep("paired")
          }
          if (evt.type === "device-scan") {
            setStep((prev) => prev === "paired" ? "press-a" : prev)
          }
          if (evt.type === "wave-request") {
            setStep((prev) => prev === "press-a" ? "press-stop" : prev)
          }
          if (evt.type === "network-join") {
            setResult(evt)
            setStep("complete")
            try {
              localStorage.setItem("wms-network-params", JSON.stringify({
                panId: evt.panId,
                channel: evt.channel,
                key: evt.key,
              }))
            } catch { /* localStorage unavailable or full */ }
          }
          if (evt.type === "error") {
            setError((evt as any).message || "")
          }
          addEvent(evt)
        })
      } catch (e) {
        addEvent({ type: "error", timestamp: "", message: (e as Error).message })
        setError((e as Error).message)
      }
      setRunning(false)
    } catch {
      // user cancelled port picker
    }
  }

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events])

  const stepStatus = (s: Step) => {
    const order: Step[] = ["connect", "paired", "press-a", "press-stop", "complete"]
    const idx = order.indexOf(step)
    const sIdx = order.indexOf(s)
    if (sIdx < idx) return "done"
    if (sIdx === idx) return "active"
    return "pending"
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold text-emerald-400">WMS Network Parameters Discovery</h1>

      {storedParams ? (
        <div className="border-2 border-emerald-500 rounded-lg p-4 bg-emerald-500/10 space-y-3">
          <div className="text-emerald-400 font-bold text-lg">Network Parameters Configured</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-400">PAN ID:</span>
            <span className="font-semibold">{storedParams.panId}</span>
            <span className="text-gray-400">Channel:</span>
            <span className="font-semibold">{storedParams.channel}</span>
            <span className="text-gray-400">Key:</span>
            <span className="font-mono text-emerald-300 break-all">{storedParams.key}</span>
          </div>
          <button onClick={handleClear}
            className="px-4 py-3 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors">
            Clear and restart discovery
          </button>
          <div className="bg-gray-800/60 border border-gray-700 rounded p-3 text-sm text-gray-400">
            Go back to the <a href="/" className="text-emerald-400 hover:text-emerald-300 underline">home page</a> to use these settings.
          </div>
        </div>
      ) : (
        <>
          <StepCard number={1} title="Connect the USB stick" status={stepStatus("connect")}>
            {step === "connect" ? (
              <button
                onClick={handleConnect}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors"
              >
                Connect USB Stick
              </button>
            ) : (
              <div className="text-emerald-400 flex items-center gap-2">
                <span>✓</span>
                <span>Stick connected</span>
              </div>
            )}
          </StepCard>

          {stepStatus("paired") !== "pending" && (
            <StepCard number={2} title="Enable discovery mode on the remote" status={stepStatus("paired")}>
              {step === "paired" ? (
                <div className="space-y-2">
                  <p>Long-press the <strong>L</strong> button on your remote until the LED blinks.</p>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                    Listening for remote...
                  </div>
                </div>
              ) : (
                <div className="text-emerald-400 flex items-center gap-2">
                  <span>✓</span>
                  <span>Remote detected</span>
                </div>
              )}
            </StepCard>
          )}

          {stepStatus("press-a") !== "pending" && (
            <StepCard number={3} title="Connect the remote to the USB stick" status={stepStatus("press-a")}>
              {step === "press-a" ? (
                <div className="space-y-2">
                  <p>Wait for the <strong>wifi</strong> LED on your remote to turn solid red, then press the <strong>A</strong> button.</p>
                  <div className="bg-gray-800 rounded p-3 text-sm text-gray-400 border border-gray-700">
                    <strong className="text-yellow-400">Tip:</strong> If nothing happens, press{" "}
                    <strong>C</strong>, wait for the LED to stop blinking, then press{" "}
                    <strong>A</strong> again. Repeat until the next step appears.
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                    Waiting for wave request...
                  </div>
                </div>
              ) : (
                <div className="text-emerald-400 flex items-center gap-2">
                  <span>✓</span>
                  <span>Wave request received</span>
                </div>
              )}
            </StepCard>
          )}

          {stepStatus("press-stop") !== "pending" && (
            <StepCard number={4} title="Extract network parameters" status={stepStatus("press-stop")}>
              {step === "press-stop" ? (
                <div className="space-y-2">
                  <p>Press the <strong>STOP</strong> button on your remote.</p>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                    Waiting for key exchange...
                  </div>
                </div>
              ) : (
                <div className="text-emerald-400 flex items-center gap-2">
                  <span>✓</span>
                  <span>Pairing complete</span>
                </div>
              )}
            </StepCard>
          )}

          {result && (
            <div className="border-2 border-yellow-500 rounded-lg p-4 bg-yellow-500/10 space-y-3">
              <div className="text-yellow-400 font-bold text-lg">Network Parameters Discovered!</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-400">PAN ID:</span>
                <span className="font-semibold">{result.panId as string}</span>
                <span className="text-gray-400">Channel:</span>
                <span className="font-semibold">{result.channel as number}</span>
                <span className="text-gray-400">Key:</span>
                <span className="font-mono text-yellow-300 break-all">{result.key as string}</span>
              </div>
              <div className="bg-emerald-900/40 border border-emerald-700 rounded p-3 text-sm text-emerald-300">
                Short-press the <strong>L</strong> button on your remote to return it to normal operation.
              </div>
            </div>
          )}

          {error && step !== "complete" && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </>
      )}

      <details className="text-sm">
        <summary className="text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
          Technical Details
        </summary>
        <div className="bg-gray-900 rounded-lg p-3 mt-2 h-64 overflow-y-auto leading-relaxed">
          {events.length === 0 && (
            <div className="text-gray-600 italic">No events yet...</div>
          )}
          {events.map((e, i) => (
            <div key={i} className={
              e.type === "error" ? "text-red-400" :
              e.type === "network-join" ? "text-yellow-300" :
              e.type === "weather-station" ? "text-green-400" :
              e.type === "network-params" ? "text-cyan-300" :
              e.type === "device-scan" ? "text-purple-300" :
              e.type === "wave-request" ? "text-orange-300" :
              "text-gray-300"
            }>
              {e.timestamp && <span className="text-gray-600">[{e.timestamp}] </span>}
              {(e as any).message as string}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </details>
    </div>
  )
}

function StepCard({ number, title, status, children }: {
  number: number
  title: string
  status: "done" | "active" | "pending"
  children: React.ReactNode
}) {
  const border = status === "done" ? "border-emerald-700" :
    status === "active" ? "border-emerald-500" : "border-gray-700"
  const bg = status === "pending" ? "bg-gray-900/50" : "bg-gray-900"

  return (
    <div className={`rounded-lg p-4 ${bg} border ${border} space-y-2`}>
      <div className="flex items-center gap-3">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
          status === "done" ? "bg-emerald-600 text-white" :
          status === "active" ? "bg-emerald-500 text-white" :
          "bg-gray-700 text-gray-400"
        }`}>
          {status === "done" ? "✓" : number}
        </span>
        <h2 className={`font-semibold ${status === "pending" ? "text-gray-500" : "text-gray-200"}`}>
          {title}
        </h2>
      </div>
      {status !== "pending" && (
        <div className="ml-10">
          {children}
        </div>
      )}
    </div>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
