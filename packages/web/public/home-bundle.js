// packages/web/src/home.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// packages/lib/src/frame/errors.ts
var MalformedFrameError = class extends Error {
  partial;
  constructor(partial) {
    super(`Malformed frame: no closing brace within timeout`);
    this.name = "MalformedFrameError";
    this.partial = partial;
  }
};

// packages/lib/src/frame/parser.ts
var decoder = new TextDecoder("utf-8", { fatal: false });
var FrameParser = class {
  buffer = "";
  malformedHandler = null;
  malformedTimer = null;
  partialTimeoutMs;
  constructor(partialTimeoutMs = 1e3) {
    this.partialTimeoutMs = partialTimeoutMs;
  }
  onMalformedFrame(handler) {
    this.malformedHandler = handler;
    return () => {
      this.malformedHandler = null;
    };
  }
  feed(data) {
    const text = decoder.decode(data, { stream: true });
    this.buffer += text;
    const frames = [];
    let startIdx = 0;
    while (startIdx < this.buffer.length) {
      const openIdx = this.buffer.indexOf("{", startIdx);
      if (openIdx === -1) {
        this.buffer = "";
        break;
      }
      const closeIdx = this.buffer.indexOf("}", openIdx + 1);
      if (closeIdx === -1) {
        const partial = this.buffer.slice(openIdx);
        this.buffer = partial;
        this.startMalformedTimer(partial);
        break;
      }
      this.clearMalformedTimer();
      const content = this.buffer.slice(openIdx + 1, closeIdx);
      frames.push(content);
      const nextStart = closeIdx + 1;
      if (nextStart >= this.buffer.length) {
        this.buffer = "";
        break;
      }
      startIdx = nextStart;
    }
    return frames;
  }
  reset() {
    this.clearMalformedTimer();
    this.buffer = "";
  }
  startMalformedTimer(partial) {
    this.clearMalformedTimer();
    this.malformedTimer = setTimeout(() => {
      const error = new MalformedFrameError(partial);
      if (this.malformedHandler) {
        this.malformedHandler(error);
      }
      this.buffer = this.buffer.replace(partial, "");
      this.malformedTimer = null;
    }, this.partialTimeoutMs);
  }
  clearMalformedTimer() {
    if (this.malformedTimer !== null) {
      clearTimeout(this.malformedTimer);
      this.malformedTimer = null;
    }
  }
};

// packages/lib/src/frame/serializer.ts
var encoder = new TextEncoder();
function serializeFrame(content) {
  return encoder.encode(`{${content}}`);
}

// packages/lib/src/command/ack-match.ts
var ackMatch = {
  exact(type) {
    return (frame) => frame === type ? "" : null;
  },
  prefix(prefix) {
    return (frame) => frame.startsWith(prefix) ? frame.slice(prefix.length) : null;
  }
};

// packages/lib/src/logging/logger.ts
var LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4
};
var levelNames = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  silent: LogLevel.SILENT
};
function parseLevel() {
  if (typeof process !== "undefined" && process.env?.WMS_LOG_LEVEL) {
    const n = levelNames[process.env.WMS_LOG_LEVEL.toLowerCase()];
    if (n !== void 0) return n;
  }
  return LogLevel.INFO;
}
var currentLevel = parseLevel();
function setLogLevel(level) {
  currentLevel = level;
}
var label = (level) => {
  switch (level) {
    case LogLevel.DEBUG:
      return "DBG";
    case LogLevel.INFO:
      return "INF";
    case LogLevel.WARN:
      return "WRN";
    case LogLevel.ERROR:
      return "ERR";
    default:
      return "???";
  }
};
var timestamp = () => (/* @__PURE__ */ new Date()).toISOString();
function log(level, tag, message, ...rest) {
  if (level < currentLevel) return;
  const fn = level >= LogLevel.ERROR ? console.error : level >= LogLevel.WARN ? console.warn : console.log;
  fn(`[${timestamp()}] [${label(level)}] [${tag}] ${message}`, ...rest);
}
function debug(tag, message, ...rest) {
  log(LogLevel.DEBUG, tag, message, ...rest);
}
function info(tag, message, ...rest) {
  log(LogLevel.INFO, tag, message, ...rest);
}

// packages/lib/src/parsers/device-scan-response.ts
var DEVICE_TYPE_NAMES = {
  "25": "Shade"
};
function getDeviceTypeName(code) {
  return DEVICE_TYPE_NAMES[code] ?? "Unknown";
}
function deviceScanResponseMatcher(frame) {
  if (frame.length < 57) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "7021") return null;
  const deviceType = frame.slice(15, 17);
  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    deviceType,
    deviceTypeName: getDeviceTypeName(deviceType),
    unknown: frame.slice(17, 57),
    raw: frame
  };
}

// packages/lib/src/parsers/device-status.ts
function deviceStatusMatcher(frame) {
  if (frame.length < 29) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "8011") return null;
  const deviceType = frame.slice(17, 19);
  return {
    serialNumber: frame.slice(1, 7),
    deviceType,
    deviceTypeName: getDeviceTypeName(deviceType),
    position: Math.round(parseInt(frame.slice(19, 21), 16) / 2),
    inclination: parseInt(frame.slice(21, 23), 16) - 127,
    valance1: parseInt(frame.slice(23, 25), 16),
    valance2: parseInt(frame.slice(25, 27), 16),
    moving: frame.slice(27, 29) === "01",
    raw: frame
  };
}

// packages/lib/src/parsers/wave-response.ts
function waveResponseMatcher(frame) {
  if (frame.length < 15) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "50AC") return null;
  return {
    serialNumber: frame.slice(1, 7),
    code: frame.slice(11, 15),
    raw: frame
  };
}

// packages/lib/src/parsers/wave-request.ts
function waveRequestMatcher(frame) {
  if (frame.length < 11) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "7050") return null;
  return {
    serialNumber: frame.slice(1, 7),
    raw: frame
  };
}

// packages/lib/src/parsers/weather-station.ts
function weatherStationMatcher(frame) {
  if (frame.length < 31) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "7080") return null;
  return {
    serialNumber: frame.slice(1, 7),
    windSpeed: parseInt(frame.slice(13, 15), 16),
    raw: frame
  };
}

// packages/lib/src/parsers/move-response.ts
function moveResponseMatcher(frame) {
  if (frame.length < 25) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "7071") return null;
  return {
    serialNumber: frame.slice(1, 7),
    subCommand: parseInt(frame.slice(17, 19), 16) & 3,
    previousPosition: Math.round(parseInt(frame.slice(21, 23), 16) / 2),
    previousInclination: parseInt(frame.slice(23, 25), 16) - 127,
    raw: frame
  };
}

// packages/lib/src/network/events.ts
var TypedEventEmitter = class {
  listeners = /* @__PURE__ */ new Map();
  on(type, fn) {
    let set = this.listeners.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
  emit(type, event) {
    this.listeners.get(type)?.forEach((fn) => {
      ;
      fn(event);
    });
  }
  removeAllListeners() {
    this.listeners.clear();
  }
};

// packages/lib/src/network/manager.ts
var NetworkManager = class {
  driver;
  parser = new FrameParser();
  emitter = new TypedEventEmitter();
  writeQueue = Promise.resolve();
  _state = "disconnected";
  devices = /* @__PURE__ */ new Map();
  stickName = "";
  movingTimer = null;
  constructor(driver) {
    this.driver = driver;
  }
  get state() {
    return this._state;
  }
  get knownDevices() {
    return [...this.devices.values()];
  }
  on(type, fn) {
    return this.emitter.on(type, fn);
  }
  async open(path, params) {
    this._state = "connecting";
    await this.driver.open(path);
    const setupParser = new FrameParser();
    const send = (cmd) => this.driver.write(serializeFrame(cmd));
    const sendAndWait = (cmd, matcher, timeoutMs = 1e3) => {
      return new Promise((resolve, reject) => {
        let timer = null;
        const cleanup = () => {
          if (timer !== null) clearTimeout(timer);
          unsub();
        };
        const unsub = this.driver.onData((data) => {
          const frames = setupParser.feed(data);
          for (const frame of frames) {
            if (frame === "f") {
              cleanup();
              reject(new Error(`Command rejected: ${cmd}`));
              return;
            }
            const result = matcher(frame);
            if (result !== null) {
              cleanup();
              resolve(result);
              return;
            }
          }
        });
        send(cmd);
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timeout waiting for response to: ${cmd}`));
        }, timeoutMs);
      });
    };
    try {
      const name = await sendAndWait("G", ackMatch.prefix("g"));
      this.stickName = name.trim();
      const modeChar = "%";
      const panId = params.panId.toUpperCase();
      await sendAndWait(
        `M ${modeChar} ${params.channel} ${panId}`,
        ackMatch.exact("a")
      );
      if (params.key) {
        await sendAndWait(
          `K 401 ${params.key.toUpperCase()}`,
          ackMatch.exact("a")
        );
      }
    } catch (err) {
      await this.driver.close().catch(() => {
      });
      this._state = "disconnected";
      throw err;
    }
    this.parser.reset();
    const unsubData = this.driver.onData((data) => this.onSerialData(data));
    const unsubError = this.driver.onError((error) => this.emitError(error));
    const unsubClose = this.driver.onClose(() => this.onClose());
    this._state = "configured";
    this.emitter.emit("connected", { stickName: this.stickName });
    this.emitter.emit("configured", {});
  }
  async close() {
    this.parser.reset();
    if (this.movingTimer) {
      clearInterval(this.movingTimer);
      this.movingTimer = null;
    }
    await this.driver.close().catch(() => {
    });
    this._state = "disconnected";
    this.devices.clear();
    this.emitter.emit("disconnected", {});
  }
  scanNetwork(panId) {
    this.sendCommand(`R04FFFFFF7020${panId.toUpperCase()}02`);
  }
  queryStatus(serialNumber) {
    this.sendCommand(`R06${serialNumber.toUpperCase()}801001000005`);
  }
  waveDevice(serialNumber) {
    this.sendCommand(`R06${serialNumber.toUpperCase()}7050`);
  }
  moveToPosition(serialNumber, position, inclination = 0) {
    const upper = serialNumber.toUpperCase();
    const pp = Math.round(position * 2).toString(16).toUpperCase().padStart(2, "0");
    const ww = Math.round(inclination + 127).toString(16).toUpperCase().padStart(2, "0");
    this.sendCommand(`R06${upper}707003${pp}${ww}FFFF`);
    const device = this.devices.get(upper);
    if (device) {
      const prev = device.status;
      device.status = {
        serialNumber: upper,
        deviceType: device.deviceType,
        deviceTypeName: device.deviceTypeName,
        position: prev?.position ?? 0,
        inclination: prev?.inclination ?? 0,
        valance1: prev?.valance1 ?? 0,
        valance2: prev?.valance2 ?? 0,
        moving: true,
        raw: ""
      };
      this.devices.set(upper, device);
      this.emitter.emit("deviceStatus", { serial: upper, status: device.status });
      info("MOVE", `${upper} moving=true (from moveToPosition)`);
    }
    this.startMovingPoll();
    this.queryStatus(upper);
  }
  stopDevice(serialNumber) {
    const upper = serialNumber.toUpperCase();
    this.sendCommand(`R06${upper}707001`);
    const device = this.devices.get(upper);
    if (device?.status) {
      device.status = { ...device.status, moving: false };
      this.devices.set(upper, device);
      this.emitter.emit("deviceStatus", { serial: upper, status: device.status });
      this.stopMovingPoll();
      info("STOP", `${upper} moving=false (from stopDevice)`);
    }
    this.queryStatus(upper);
  }
  startMovingPoll() {
    if (this.movingTimer) return;
    this.movingTimer = setInterval(() => {
      for (const [serial, device] of this.devices) {
        if (device.status?.moving) {
          this.queryStatus(serial);
        }
      }
    }, 2e3);
  }
  stopMovingPoll() {
    const hasMoving = [...this.devices.values()].some((d) => d.status?.moving);
    if (!hasMoving && this.movingTimer) {
      clearInterval(this.movingTimer);
      this.movingTimer = null;
    }
  }
  sendCommand(frame) {
    this.writeQueue = this.writeQueue.then(() => this.driver.write(serializeFrame(frame))).catch(() => {
    });
  }
  onSerialData(data) {
    const frames = this.parser.feed(data);
    for (const frame of frames) {
      this.processFrame(frame);
    }
  }
  processFrame(frame) {
    const ws = weatherStationMatcher(frame);
    if (ws) {
      this.emitter.emit("weatherStation", {
        serial: ws.serialNumber,
        windSpeed: ws.windSpeed
      });
      return;
    }
    const ds = deviceScanResponseMatcher(frame);
    if (ds) {
      if (!this.devices.has(ds.serialNumber)) {
        this.devices.set(ds.serialNumber, {
          serialNumber: ds.serialNumber,
          deviceType: ds.deviceType,
          deviceTypeName: ds.deviceTypeName
        });
        this.emitter.emit("deviceDiscovered", { device: ds });
      }
      return;
    }
    const st = deviceStatusMatcher(frame);
    if (st) {
      const prev = this.devices.get(st.serialNumber)?.status;
      const wouldOverride = !!(prev && !prev.moving && st.moving);
      if (wouldOverride) {
        debug("8011", `${st.serialNumber} override prev=${prev.moving} raw=${st.moving} \u2192 false`);
        st.moving = false;
      }
      if (!prev || this.hasStatusChanged(prev, st)) {
        const device = this.devices.get(st.serialNumber) ?? {
          serialNumber: st.serialNumber,
          deviceType: st.deviceType,
          deviceTypeName: st.deviceTypeName
        };
        device.status = st;
        this.devices.set(st.serialNumber, device);
        this.emitter.emit("deviceStatus", { serial: st.serialNumber, status: st });
      }
      if (st.moving) {
        this.startMovingPoll();
      }
      this.stopMovingPoll();
      return;
    }
    const mv = moveResponseMatcher(frame);
    if (mv) {
      debug(
        "7071",
        `${frame}  serial=${mv.serialNumber} cmd=${mv.subCommand} pp=${mv.previousPosition}% ww=${mv.previousInclination}\xB0`
      );
      return;
    }
    const wr = waveResponseMatcher(frame);
    if (wr) {
      this.emitter.emit("waveResult", {
        serial: wr.serialNumber,
        code: wr.code
      });
      return;
    }
    const wq = waveRequestMatcher(frame);
    if (wq) {
      this.emitter.emit("waveResult", { serial: wq.serialNumber });
      return;
    }
  }
  hasStatusChanged(a, b) {
    return a.position !== b.position || a.inclination !== b.inclination || a.moving !== b.moving || a.valance1 !== b.valance1 || a.valance2 !== b.valance2;
  }
  emitError(error) {
    this.emitter.emit("error", { error });
  }
  onClose() {
    this.close();
  }
};

// packages/web/src/drivers/web-serial.ts
var WebSerialDriver = class {
  constructor(port) {
    this.port = port;
  }
  port;
  reader = null;
  reading = false;
  dataHandlers = /* @__PURE__ */ new Set();
  errorHandlers = /* @__PURE__ */ new Set();
  closeHandlers = /* @__PURE__ */ new Set();
  async open(_path) {
    await this.port.open({ baudRate: 128e3 });
    this.startReading();
  }
  async close() {
    this.reading = false;
    try {
      this.reader?.cancel();
    } catch {
    }
    this.reader = null;
    await this.port.close();
    for (const handler of this.closeHandlers) {
      handler();
    }
  }
  async write(data) {
    if (!this.port.writable) {
      throw new Error("Serial port not writable");
    }
    const writer = this.port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }
  onData(handler) {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }
  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  async startReading() {
    this.reading = true;
    while (this.reading) {
      try {
        const readable = this.port.readable;
        if (!readable) {
          throw new Error("Serial port not readable");
        }
        this.reader = readable.getReader();
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            for (const handler of this.dataHandlers) {
              handler(value);
            }
          }
        }
      } catch (err) {
        if (this.reading) {
          for (const handler of this.errorHandlers) {
            handler(err instanceof Error ? err : new Error(String(err)));
          }
        }
      } finally {
        try {
          this.reader?.releaseLock();
        } catch {
        }
        this.reader = null;
      }
    }
  }
};

// packages/web/src/browser.ts
function ts() {
  const d = /* @__PURE__ */ new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
}
async function startMonitor(port, params, onEvent) {
  const driver = new WebSerialDriver(port);
  const manager = new NetworkManager(driver);
  manager.on("error", (e) => {
    onEvent({ type: "error", timestamp: ts(), message: e.error.message });
  });
  manager.on("connected", () => {
    onEvent({ type: "connected", timestamp: ts() });
  });
  manager.on("weatherStation", (e) => {
    onEvent({
      type: "weather-station",
      timestamp: ts(),
      serialNumber: e.serial,
      windSpeed: e.windSpeed
    });
  });
  onEvent({ type: "log", timestamp: ts(), message: "Opening serial port..." });
  try {
    await manager.open("web-serial", {
      channel: params.channel,
      panId: params.panId,
      key: params.key || void 0
    });
    onEvent({
      type: "log",
      timestamp: ts(),
      message: `Network configured: channel ${params.channel}, PAN ID ${params.panId}`
    });
  } catch (e) {
    onEvent({
      type: "error",
      timestamp: ts(),
      message: `Failed to configure network: ${e.message}`
    });
    throw e;
  }
  window.addEventListener("beforeunload", () => {
    manager.close();
  });
  return manager;
}

// packages/web/src/home.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var NAMES_KEY = "wms-device-names";
var HIDDEN_KEY = "wms-hidden-serials";
var LOG_LEVEL_KEY = "wms-log-level";
function loadLogLevel() {
  try {
    const v = localStorage.getItem(LOG_LEVEL_KEY);
    if (v === "debug") return LogLevel.DEBUG;
    if (v === "info") return LogLevel.INFO;
    if (v === "warn") return LogLevel.WARN;
    if (v === "error") return LogLevel.ERROR;
    if (v === "silent") return LogLevel.SILENT;
  } catch {
  }
  return LogLevel.INFO;
}
function loadNames() {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveNames(names) {
  localStorage.setItem(NAMES_KEY, JSON.stringify(names));
}
function loadHidden() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function saveHidden(hidden) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}
function App() {
  const managerRef = React.useRef(null);
  const [connectionState, setConnectionState] = React.useState("connect");
  const [connectionError, setConnectionError] = React.useState("");
  const [stations, setStations] = React.useState(/* @__PURE__ */ new Map());
  const [deviceNames, setDeviceNames] = React.useState(loadNames);
  const [hiddenSerials, setHiddenSerials] = React.useState(loadHidden);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState("");
  const [waveMessages, setWaveMessages] = React.useState(/* @__PURE__ */ new Map());
  const [moveMessages, setMoveMessages] = React.useState(/* @__PURE__ */ new Map());
  const [logLevel, setLogLevelState] = React.useState(loadLogLevel);
  React.useEffect(() => setLogLevel(logLevel), [logLevel]);
  const [, forceRender] = React.useReducer((x) => x + 1, 0);
  const devices = managerRef.current?.knownDevices ?? [];
  const visibleDevices = devices.filter((d) => !hiddenSerials.has(d.serialNumber));
  const handleConnect = async () => {
    try {
      const p = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 1027, usbProductId: 24577 }]
      });
      const stored = localStorage.getItem("wms-network-params");
      if (!stored) {
        setConnectionState("error");
        setConnectionError(
          'No network parameters found. Go to <a href="/discovery.html" class="underline text-emerald-400">the discovery page</a> to find them first.'
        );
        return;
      }
      const params = JSON.parse(stored);
      setConnectionState("connecting");
      const manager = await startMonitor(p, params, (evt) => {
        if (evt.type === "connected") {
          setConnectionState("monitoring");
        }
        if (evt.type === "weather-station") {
          const serial = evt.serialNumber;
          setStations((prev) => {
            const next = new Map(prev);
            next.set(serial, {
              serialNumber: serial,
              windSpeed: evt.windSpeed
            });
            return next;
          });
        }
        if (evt.type === "error") {
          setConnectionError(evt.message || "");
          setConnectionState("error");
        }
      });
      managerRef.current = manager;
      manager.on("deviceDiscovered", () => forceRender());
      manager.on("deviceStatus", () => forceRender());
      manager.on("waveResult", (e) => {
        const msg = e.code ? `Waved! code=${e.code}` : "Waved!";
        setWaveMessages((prev) => new Map(prev).set(e.serial, msg));
      });
    } catch {
      if (connectionState === "connecting") {
        setConnectionState("connect");
      }
    }
  };
  const handleScan = async () => {
    const manager = managerRef.current;
    if (!manager) return;
    const stored = localStorage.getItem("wms-network-params");
    if (!stored) {
      setScanError("No network parameters found");
      return;
    }
    const params = JSON.parse(stored);
    setScanning(true);
    setScanError("");
    manager.scanNetwork(params.panId);
    setTimeout(() => setScanning(false), 3e3);
  };
  const handleQueryStatus = (serialNumber) => {
    managerRef.current?.queryStatus(serialNumber);
  };
  const handleRefreshAll = () => {
    const manager = managerRef.current;
    if (!manager || visibleDevices.length === 0) return;
    for (const d of visibleDevices) {
      manager.queryStatus(d.serialNumber);
    }
  };
  const handleDeleteDevice = (serial) => {
    setDeviceNames((prev) => {
      const next = { ...prev };
      delete next[serial];
      saveNames(next);
      return next;
    });
    setHiddenSerials((prev) => {
      const next = new Set(prev);
      next.add(serial);
      saveHidden(next);
      return next;
    });
  };
  const handleNameChange = (serial, name) => {
    setDeviceNames((prev) => {
      const next = { ...prev, [serial]: name };
      saveNames(next);
      return next;
    });
  };
  const handleWaveDevice = (serial) => {
    managerRef.current?.waveDevice(serial);
  };
  const handleMove = async (serial, direction) => {
    const manager = managerRef.current;
    if (!manager) return;
    try {
      if (direction === "stop") {
        manager.stopDevice(serial);
      } else {
        const position = direction === "up" ? 0 : 100;
        manager.moveToPosition(serial, position);
      }
    } catch {
      setMoveMessages((prev) => new Map(prev).set(serial, `Move failed`));
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "max-w-3xl mx-auto p-4 space-y-4", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-2xl font-bold text-emerald-400", children: "WMS Network Monitor" }),
    connectionState === "connect" && /* @__PURE__ */ jsx(
      "button",
      {
        onClick: handleConnect,
        className: "px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors",
        children: "Connect USB Stick"
      }
    ),
    connectionState === "connecting" && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-gray-400", children: [
      /* @__PURE__ */ jsx("span", { className: "w-2 h-2 bg-emerald-400 rounded-full animate-pulse" }),
      "Configuring network..."
    ] }),
    connectionState === "error" && /* @__PURE__ */ jsx(
      "div",
      {
        className: "bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400",
        dangerouslySetInnerHTML: { __html: connectionError }
      }
    ),
    connectionState === "monitoring" && stations.size === 0 && /* @__PURE__ */ jsx("div", { className: "text-gray-500", children: "Waiting for weather station broadcasts..." }),
    connectionState === "monitoring" && [...stations.values()].map((s) => /* @__PURE__ */ jsxs("div", { className: "bg-gray-900 border border-emerald-700 rounded-lg p-4", children: [
      /* @__PURE__ */ jsx("div", { className: "text-gray-400 text-xs uppercase tracking-wide", children: "Serial" }),
      /* @__PURE__ */ jsx("div", { className: "text-white font-semibold mt-1", children: s.serialNumber }),
      /* @__PURE__ */ jsx("div", { className: "text-gray-400 text-xs uppercase tracking-wide mt-3", children: "Wind Speed" }),
      /* @__PURE__ */ jsxs("div", { className: "text-emerald-400 font-bold text-2xl mt-1", children: [
        s.windSpeed,
        " km/h"
      ] })
    ] }, s.serialNumber)),
    connectionState === "monitoring" && /* @__PURE__ */ jsxs("div", { className: "space-y-3 pt-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-xs text-gray-500", children: [
        /* @__PURE__ */ jsx("span", { children: "Log level:" }),
        /* @__PURE__ */ jsxs(
          "select",
          {
            value: logLevel === LogLevel.DEBUG ? "debug" : logLevel === LogLevel.INFO ? "info" : logLevel === LogLevel.WARN ? "warn" : logLevel === LogLevel.ERROR ? "error" : "silent",
            onChange: (e) => {
              const v = e.target.value;
              const level = v === "debug" ? LogLevel.DEBUG : v === "info" ? LogLevel.INFO : v === "warn" ? LogLevel.WARN : v === "error" ? LogLevel.ERROR : LogLevel.SILENT;
              localStorage.setItem(LOG_LEVEL_KEY, v);
              setLogLevelState(level);
            },
            className: "bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-violet-500",
            children: [
              /* @__PURE__ */ jsx("option", { value: "debug", children: "Debug" }),
              /* @__PURE__ */ jsx("option", { value: "info", children: "Info" }),
              /* @__PURE__ */ jsx("option", { value: "warn", children: "Warn" }),
              /* @__PURE__ */ jsx("option", { value: "error", children: "Error" }),
              /* @__PURE__ */ jsx("option", { value: "silent", children: "Silent" })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          onClick: handleScan,
          disabled: scanning,
          className: "px-6 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-wait text-white rounded-lg font-semibold text-sm transition-colors",
          children: scanning ? "Scanning..." : "Scan Network"
        }
      ),
      scanError && /* @__PURE__ */ jsx("div", { className: "bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400", children: scanError }),
      visibleDevices.length > 0 && /* @__PURE__ */ jsx(
        "button",
        {
          onClick: handleRefreshAll,
          className: "ml-2 px-6 py-3 bg-violet-700 hover:bg-violet-600 text-white rounded-lg font-semibold text-sm transition-colors",
          children: "Refresh All"
        }
      ),
      hiddenSerials.size > 0 && /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: () => {
            setHiddenSerials(/* @__PURE__ */ new Set());
            localStorage.removeItem(HIDDEN_KEY);
          },
          className: "text-xs text-gray-600 hover:text-gray-400 transition-colors",
          children: [
            "Restore ",
            hiddenSerials.size,
            " hidden device",
            hiddenSerials.size > 1 ? "s" : ""
          ]
        }
      ),
      visibleDevices.map((d) => {
        const ds = d.status;
        const name = deviceNames[d.serialNumber] || "";
        return /* @__PURE__ */ jsxs("div", { className: "bg-gray-900 border border-violet-700 rounded-lg p-4", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-start justify-between gap-2", children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "text",
                value: name,
                onChange: (e) => handleNameChange(d.serialNumber, e.target.value),
                placeholder: "Name this device",
                className: "flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleQueryStatus(d.serialNumber),
                className: "px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded text-xs font-semibold transition-colors shrink-0",
                children: "Status"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleWaveDevice(d.serialNumber),
                className: "px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors shrink-0",
                children: "Wave"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleDeleteDevice(d.serialNumber),
                className: "px-2 py-1.5 bg-red-900/50 hover:bg-red-700 text-red-400 hover:text-white rounded text-xs font-semibold transition-colors shrink-0",
                title: "Remove device",
                children: "\xD7"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "mt-2 flex items-center gap-2 text-xs text-gray-500", children: [
            /* @__PURE__ */ jsx("span", { children: d.serialNumber }),
            /* @__PURE__ */ jsx("span", { children: "\xB7" }),
            /* @__PURE__ */ jsx("span", { className: "text-violet-400 font-semibold", children: d.deviceTypeName })
          ] }),
          (() => {
            const wm = waveMessages.get(d.serialNumber);
            if (!wm) return null;
            const ok = !wm.startsWith("Wave failed");
            return /* @__PURE__ */ jsx("div", { className: `mt-2 text-xs ${ok ? "text-emerald-400" : "text-red-400"}`, children: wm });
          })(),
          ds && /* @__PURE__ */ jsxs("div", { className: "mt-3 pt-3 border-t border-gray-700 space-y-1", children: [
            /* @__PURE__ */ jsxs("div", { className: "flex justify-between text-sm", children: [
              /* @__PURE__ */ jsx("span", { className: "text-gray-400", children: "Position" }),
              /* @__PURE__ */ jsxs("span", { className: "text-violet-300 font-semibold", children: [
                ds.position,
                "%"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "flex justify-between text-sm", children: [
              /* @__PURE__ */ jsx("span", { className: "text-gray-400", children: "Moving" }),
              /* @__PURE__ */ jsx("span", { className: ds.moving ? "text-yellow-400 font-semibold" : "text-gray-500", children: ds.moving ? "Yes" : "No" })
            ] })
          ] }),
          (() => {
            const mm = moveMessages.get(d.serialNumber);
            if (!mm || !mm.startsWith("Move failed")) return null;
            return /* @__PURE__ */ jsx("div", { className: "mt-2 text-xs text-red-400", children: mm });
          })(),
          /* @__PURE__ */ jsxs("div", { className: "mt-3 pt-3 border-t border-gray-700 flex gap-2", children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleMove(d.serialNumber, "up"),
                className: "flex-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors",
                children: "\u25B2 Up"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleMove(d.serialNumber, "down"),
                className: "flex-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors",
                children: "\u25BC Down"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleMove(d.serialNumber, "stop"),
                className: "flex-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-xs font-semibold transition-colors",
                children: "\u25A0 Stop"
              }
            )
          ] })
        ] }, d.serialNumber);
      })
    ] })
  ] });
}
var root = document.getElementById("root");
if (root) createRoot(root).render(/* @__PURE__ */ jsx(App, {}));
