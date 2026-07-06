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

// packages/lib/src/command/session.ts
var CommandSession = class {
  command;
  ack;
  promise;
  /** @internal called by RadioController when session completes */
  _onDone = null;
  resolveAck = null;
  responseHandlers = /* @__PURE__ */ new Set();
  responseWindow = false;
  responseWindowTimer = null;
  cancelled = false;
  resolveDone = null;
  options;
  constructor(command, options) {
    this.command = command;
    this.options = {
      ackTimeoutMs: 100,
      responseWindowMs: 500,
      ...options
    };
    this.ack = new Promise((resolve) => {
      this.resolveAck = resolve;
    });
    this.promise = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    this.promise.then(() => this._onDone?.());
  }
  /** @internal called by RadioController when session becomes active */
  _startAckTimer() {
    setTimeout(() => {
      if (this.cancelled || this.responseWindow) return;
      this.resolveAck?.({ kind: "timeout" });
      this.cancel();
    }, this.options.ackTimeoutMs);
  }
  onResponse(handler) {
    this.responseHandlers.add(handler);
    return () => {
      this.responseHandlers.delete(handler);
    };
  }
  feedFrame(frame) {
    if (this.cancelled) return false;
    if (frame === "f") {
      this.resolveAck?.({ kind: "fail" });
      this.cancel();
      return true;
    }
    if (!this.responseWindow) {
      const stripped = this.options.ackMatcher(frame);
      if (stripped !== null) {
        if (this.options.responseWindowMs !== void 0 && this.options.responseWindowMs > 0) {
          this.responseWindow = true;
          this.resolveAck?.({ kind: "ack", frame: stripped });
          this.responseWindowTimer = setTimeout(() => {
            this.closeResponseWindow();
          }, this.options.responseWindowMs);
        } else {
          this.resolveAck?.({ kind: "ack", frame: stripped });
          this.cancel();
        }
        return true;
      }
      return false;
    }
    for (const handler of this.responseHandlers) {
      handler(frame);
    }
    return true;
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.responseHandlers.clear();
    if (this.responseWindowTimer !== null) {
      clearTimeout(this.responseWindowTimer);
      this.responseWindowTimer = null;
    }
    if (!this.responseWindow) {
      this.resolveAck?.({ kind: "timeout" });
    }
    this.finish();
  }
  closeResponseWindow() {
    this.responseWindow = false;
    this.finish();
  }
  finish() {
    this.resolveDone?.();
    this.resolveDone = null;
  }
};

// packages/lib/src/command/ack-match.ts
var ackMatch = {
  exact(type) {
    return (frame) => frame === type ? "" : null;
  },
  prefix(prefix) {
    return (frame) => frame.startsWith(prefix) ? frame.slice(prefix.length) : null;
  }
};

// packages/lib/src/controller.ts
var RadioController = class {
  driver;
  parser = new FrameParser();
  queue = [];
  activeOp = null;
  broadcastHandlers = /* @__PURE__ */ new Set();
  errorHandlers = /* @__PURE__ */ new Set();
  unsubs = [];
  _isOpen = false;
  constructor(driver) {
    this.driver = driver;
    this.parser.onMalformedFrame((error) => {
      this.emitError(error);
    });
  }
  get isOpen() {
    return this._isOpen;
  }
  async open(path) {
    await this.driver.open(path);
    this._isOpen = true;
    this.unsubs.push(
      this.driver.onData((data) => this.onSerialData(data))
    );
    this.unsubs.push(
      this.driver.onError((error) => this.emitError(error))
    );
    this.unsubs.push(
      this.driver.onClose(() => this.onSerialClose())
    );
  }
  async close() {
    this.cancelActiveOp();
    for (const op of this.queue) {
      op.cancel();
    }
    this.queue = [];
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this._isOpen = false;
    await this.driver.close();
  }
  send(command, options) {
    const session = new CommandSession(command, options);
    session._onDone = () => {
      if (this.activeOp === session) {
        this.activeOp = null;
        this.processQueue();
      }
    };
    this.queue.push(session);
    this.processQueue();
    return session;
  }
  onBroadcast(handler) {
    this.broadcastHandlers.add(handler);
    return () => {
      this.broadcastHandlers.delete(handler);
    };
  }
  onError(handler) {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }
  processQueue() {
    if (this.activeOp !== null || this.queue.length === 0) return;
    const op = this.queue.shift();
    this.activeOp = op;
    op._startAckTimer();
    const raw = serializeFrame(op.command);
    console.error(`[${(/* @__PURE__ */ new Date()).toISOString()}] [>>] ${op.command}`);
    this.driver.write(raw);
  }
  onSerialData(data) {
    const frames = this.parser.feed(data);
    for (const frame of frames) {
      this.routeFrame(frame);
    }
  }
  routeFrame(frame) {
    if (this.activeOp !== null) {
      const consumed = this.activeOp.feedFrame(frame);
      if (consumed) {
        console.error(`[${(/* @__PURE__ */ new Date()).toISOString()}] [<<] ${frame}  (session: ${this.activeOp.command})`);
        return;
      }
    }
    console.error(`[${(/* @__PURE__ */ new Date()).toISOString()}] [<<] ${frame}  (broadcast)`);
    for (const handler of this.broadcastHandlers) {
      handler(frame);
    }
  }
  cancelActiveOp() {
    if (this.activeOp !== null) {
      this.activeOp.cancel();
      this.activeOp = null;
    }
  }
  emitError(error) {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
  onSerialClose() {
    this.cancelActiveOp();
    this._isOpen = false;
  }
};

// packages/lib/src/parsers/device-scan-response.ts
var DEVICE_TYPE_NAMES = {
  "25": "Awning"
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

// packages/lib/src/commands/name.ts
var Commands = class {
  constructor(radio) {
    this.radio = radio;
  }
  radio;
  async getName() {
    const session = this.radio.send("G", {
      ackMatcher: ackMatch.prefix("g"),
      responseWindowMs: 0
    });
    const ack = await session.ack;
    if (ack.kind === "timeout") {
      throw new Error("getName: ack timeout");
    }
    if (ack.kind === "fail") {
      throw new Error("getName: command rejected");
    }
    return ack.frame;
  }
  async getVersion() {
    const session = this.radio.send("V", {
      ackMatcher: ackMatch.prefix("v"),
      responseWindowMs: 0
    });
    const ack = await session.ack;
    if (ack.kind === "timeout") {
      throw new Error("getVersion: ack timeout");
    }
    if (ack.kind === "fail") {
      throw new Error("getVersion: command rejected");
    }
    return ack.frame.trim();
  }
  async setNetworkParameters(params) {
    if (params.channel < 11 || params.channel > 26) {
      throw new Error("setNetworkParameters: invalid channel");
    }
    if (!/^[0-9A-Fa-f]{4}$/.test(params.panId)) {
      throw new Error("setNetworkParameters: invalid PAN ID");
    }
    const modeChar = params.receiveBroadcasts ? "%" : "#";
    const panId = params.panId.toUpperCase();
    const frame = `M ${modeChar} ${params.channel} ${panId}`;
    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: 0
    });
    const ack = await session.ack;
    if (ack.kind === "fail") {
      throw new Error("setNetworkParameters: command rejected");
    }
    if (ack.kind === "timeout") {
      throw new Error("setNetworkParameters: ack timeout");
    }
  }
  async setEncryptionKey(key) {
    if (!/^[0-9A-Fa-f]{32}$/.test(key)) {
      throw new Error("setEncryptionKey: invalid key");
    }
    const frame = `K 401 ${key.toUpperCase()}`;
    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: 0
    });
    const ack = await session.ack;
    if (ack.kind === "fail") {
      throw new Error("setEncryptionKey: command rejected");
    }
    if (ack.kind === "timeout") {
      throw new Error("setEncryptionKey: ack timeout");
    }
  }
  // NOTE: responseWindowMs consumes ALL serial frames during the scan window,
  // suppressing broadcast handlers (weather station, pairing, etc.). This is
  // acceptable because scanning is infrequent and short-lived (~3s).
  async scanNetwork(panId, timeoutMs = 3e3) {
    if (!/^[0-9A-Fa-f]{4}$/.test(panId)) {
      throw new Error("scanNetwork: invalid PAN ID");
    }
    const seen = /* @__PURE__ */ new Map();
    const frame = `R04FFFFFF7020${panId.toUpperCase()}02`;
    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: timeoutMs
    });
    session.onResponse((content) => {
      const parsed = deviceScanResponseMatcher(content);
      if (parsed && !seen.has(parsed.serialNumber)) {
        seen.set(parsed.serialNumber, parsed);
      }
    });
    const ack = await session.ack;
    if (ack.kind === "fail") {
      throw new Error("scanNetwork: command rejected");
    }
    if (ack.kind === "timeout") {
      throw new Error("scanNetwork: ack timeout");
    }
    await session.promise;
    return [...seen.values()];
  }
  async getDeviceStatus(serialNumber, timeoutMs = 2e3) {
    if (!/^[0-9A-Fa-f]{6}$/.test(serialNumber)) {
      throw new Error("getDeviceStatus: invalid serial number");
    }
    const frame = `R06${serialNumber.toUpperCase()}801001000005`;
    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: timeoutMs
    });
    let result = null;
    session.onResponse((content) => {
      const parsed = deviceStatusMatcher(content);
      if (parsed && !result) {
        result = parsed;
        session.cancel();
      }
    });
    const ack = await session.ack;
    if (ack.kind === "fail") {
      throw new Error("getDeviceStatus: command rejected");
    }
    if (ack.kind === "timeout") {
      throw new Error("getDeviceStatus: ack timeout");
    }
    await session.promise;
    if (!result) {
      throw new Error("getDeviceStatus: no response from device");
    }
    return result;
  }
  async waveDevice(serialNumber, timeoutMs = 2e3) {
    if (!/^[0-9A-Fa-f]{6}$/.test(serialNumber)) {
      throw new Error("waveDevice: invalid serial number");
    }
    const serial = serialNumber.toUpperCase();
    const frame = `R06${serial}7050`;
    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: timeoutMs
    });
    let result = null;
    session.onResponse((content) => {
      if (result) return;
      const wr = waveResponseMatcher(content);
      if (wr && wr.serialNumber === serial) {
        result = { serialNumber: wr.serialNumber, code: wr.code };
        session.cancel();
        return;
      }
      const wr2 = waveRequestMatcher(content);
      if (wr2 && wr2.serialNumber === serial) {
        result = { serialNumber: wr2.serialNumber };
        session.cancel();
      }
    });
    const ack = await session.ack;
    if (ack.kind === "fail") {
      throw new Error("waveDevice: command rejected");
    }
    if (ack.kind === "timeout") {
      throw new Error("waveDevice: ack timeout");
    }
    await session.promise;
    if (!result) {
      throw new Error("waveDevice: no response from device");
    }
    return result;
  }
  async stopDevice(serialNumber, timeoutMs = 2e3) {
    if (!/^[0-9A-Fa-f]{6}$/.test(serialNumber)) {
      throw new Error("stopDevice: invalid serial number");
    }
    const cmd = `R06${serialNumber.toUpperCase()}707001`;
    return this.sendMoveCommand(cmd, timeoutMs);
  }
  async moveToPosition(serialNumber, position, inclination = 0, timeoutMs = 2e3) {
    if (!/^[0-9A-Fa-f]{6}$/.test(serialNumber)) {
      throw new Error("moveToPosition: invalid serial number");
    }
    if (position < 0 || position > 100) {
      throw new Error("moveToPosition: position must be 0-100");
    }
    const pp = Math.round(position * 2).toString(16).toUpperCase().padStart(2, "0");
    const ww = Math.round(inclination + 127).toString(16).toUpperCase().padStart(2, "0");
    const cmd = `R06${serialNumber.toUpperCase()}707003${pp}${ww}0000`;
    return this.sendMoveCommand(cmd, timeoutMs);
  }
  async sendMoveCommand(rawCommand, timeoutMs) {
    const session = this.radio.send(rawCommand, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: 0
    });
    const ack = await session.ack;
    if (ack.kind === "fail") {
      throw new Error(`${rawCommand.startsWith("R06") && rawCommand.includes("707001") ? "stopDevice" : "moveToPosition"}: command rejected`);
    }
    if (ack.kind === "timeout") {
      throw new Error(`${rawCommand.startsWith("R06") && rawCommand.includes("707001") ? "stopDevice" : "moveToPosition"}: ack timeout`);
    }
  }
};

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
  const radio = new RadioController(driver);
  const commands = new Commands(radio);
  radio.onError((error) => {
    onEvent({ type: "error", timestamp: ts(), message: error.message });
  });
  onEvent({ type: "log", timestamp: ts(), message: "Opening serial port..." });
  await radio.open("web-serial");
  try {
    await commands.setNetworkParameters({
      receiveBroadcasts: true,
      channel: params.channel,
      panId: params.panId
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
    await radio.close();
    throw new Error("Failed to configure network");
  }
  try {
    await commands.setEncryptionKey(params.key);
    onEvent({ type: "log", timestamp: ts(), message: "Encryption key set" });
  } catch (e) {
    onEvent({
      type: "error",
      timestamp: ts(),
      message: `Failed to set encryption key: ${e.message}`
    });
    await radio.close();
    throw new Error("Failed to set encryption key");
  }
  onEvent({ type: "connected", timestamp: ts() });
  radio.onBroadcast((frame) => {
    const ws = weatherStationMatcher(frame);
    if (ws) {
      onEvent({
        type: "weather-station",
        timestamp: ts(),
        serialNumber: ws.serialNumber,
        windSpeed: ws.windSpeed
      });
    }
  });
  window.addEventListener("beforeunload", () => {
    radio.close();
  });
  return { commands };
}

// packages/web/src/home.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var NAMES_KEY = "wms-device-names";
var HIDDEN_KEY = "wms-hidden-serials";
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
  const [stations, setStations] = React.useState(/* @__PURE__ */ new Map());
  const [status, setStatus] = React.useState("connect");
  const [error, setError] = React.useState("");
  const commandsRef = React.useRef(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanDevices, setScanDevices] = React.useState([]);
  const [scanError, setScanError] = React.useState("");
  const [deviceStatuses, setDeviceStatuses] = React.useState(/* @__PURE__ */ new Map());
  const [statusErrors, setStatusErrors] = React.useState(/* @__PURE__ */ new Map());
  const [queryingSerial, setQueryingSerial] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshSummary, setRefreshSummary] = React.useState("");
  const [deviceNames, setDeviceNames] = React.useState(loadNames);
  const [hiddenSerials, setHiddenSerials] = React.useState(loadHidden);
  const [wavingSerial, setWavingSerial] = React.useState("");
  const [waveMessages, setWaveMessages] = React.useState(/* @__PURE__ */ new Map());
  const [moveMessages, setMoveMessages] = React.useState(/* @__PURE__ */ new Map());
  const handleConnect = async () => {
    try {
      const p = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 1027, usbProductId: 24577 }]
      });
      const stored = localStorage.getItem("wms-network-params");
      if (!stored) {
        setStatus("error");
        setError('No network parameters found. Go to <a href="/discovery.html" class="underline text-emerald-400">the discovery page</a> to find them first.');
        return;
      }
      const params = JSON.parse(stored);
      setStatus("connecting");
      const { commands } = await startMonitor(p, params, (evt) => {
        if (evt.type === "connected") {
          setStatus("monitoring");
        }
        if (evt.type === "weather-station") {
          const serial = evt.serialNumber;
          setStations((prev) => {
            const next = new Map(prev);
            next.set(serial, { serialNumber: serial, windSpeed: evt.windSpeed });
            return next;
          });
        }
        if (evt.type === "error") {
          setError(evt.message || "");
          setStatus("error");
        }
      });
      commandsRef.current = commands;
    } catch {
    }
  };
  const handleScan = async () => {
    if (!commandsRef.current) return;
    const stored = localStorage.getItem("wms-network-params");
    if (!stored) {
      setScanError("No network parameters found");
      return;
    }
    const params = JSON.parse(stored);
    setScanning(true);
    setScanError("");
    try {
      const results = await commandsRef.current.scanNetwork(params.panId);
      setScanDevices((prev) => {
        const map = new Map(prev.map((d) => [d.serialNumber, d]));
        for (const d of results) map.set(d.serialNumber, d);
        return [...map.values()];
      });
    } catch (e) {
      setScanError(e.message);
    }
    setScanning(false);
  };
  const handleQueryStatus = async (serialNumber) => {
    if (!commandsRef.current) return;
    setQueryingSerial(serialNumber);
    setStatusErrors((prev) => {
      const next = new Map(prev);
      next.delete(serialNumber);
      return next;
    });
    try {
      const status2 = await commandsRef.current.getDeviceStatus(serialNumber);
      setDeviceStatuses((prev) => {
        const next = new Map(prev);
        next.set(serialNumber, status2);
        return next;
      });
    } catch (e) {
      setStatusErrors((prev) => {
        const next = new Map(prev);
        next.set(serialNumber, e.message);
        return next;
      });
    }
    setQueryingSerial("");
  };
  const handleRefreshAll = async () => {
    if (!commandsRef.current || scanDevices.length === 0) return;
    setRefreshing(true);
    setRefreshSummary("");
    const results = await Promise.all(
      scanDevices.map(async (d) => {
        try {
          const status2 = await commandsRef.current.getDeviceStatus(d.serialNumber);
          return { serial: d.serialNumber, status: status2 };
        } catch (err) {
          return { serial: d.serialNumber, error: err.message };
        }
      })
    );
    let ok = 0;
    let fail = 0;
    const newStatuses = /* @__PURE__ */ new Map();
    const newErrors = /* @__PURE__ */ new Map();
    for (const r of results) {
      if ("status" in r) {
        ok++;
        if (r.status) newStatuses.set(r.serial, r.status);
      } else {
        fail++;
        newErrors.set(r.serial, r.error);
      }
    }
    setRefreshSummary(
      ok > 0 ? `Updated ${ok} device${ok > 1 ? "s" : ""}${fail > 0 ? ` (${fail} failed)` : ""}` : `No devices responded (${fail} failed)`
    );
    setDeviceStatuses((prev) => {
      const next = new Map(prev);
      for (const [k, v] of newStatuses) next.set(k, v);
      return next;
    });
    setStatusErrors((prev) => {
      const next = new Map(prev);
      for (const [k, v] of newErrors) next.set(k, v);
      return next;
    });
    setRefreshing(false);
  };
  const handleDeleteDevice = (serial) => {
    setScanDevices((prev) => prev.filter((d) => d.serialNumber !== serial));
    setDeviceStatuses((prev) => {
      const next = new Map(prev);
      next.delete(serial);
      return next;
    });
    setStatusErrors((prev) => {
      const next = new Map(prev);
      next.delete(serial);
      return next;
    });
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
  const handleWaveDevice = async (serial) => {
    if (!commandsRef.current) return;
    setWavingSerial(serial);
    setWaveMessages((prev) => {
      const next = new Map(prev);
      next.delete(serial);
      return next;
    });
    try {
      const result = await commandsRef.current.waveDevice(serial);
      const msg = result.code ? `Waved! code=${result.code}` : "Waved!";
      setWaveMessages((prev) => new Map(prev).set(serial, msg));
    } catch (err) {
      setWaveMessages((prev) => new Map(prev).set(serial, `Wave failed: ${err.message}`));
    }
    setWavingSerial("");
  };
  const handleMove = async (serial, direction) => {
    if (!commandsRef.current) return;
    try {
      if (direction === "stop") {
        await commandsRef.current.stopDevice(serial);
        setMoveMessages((prev) => new Map(prev).set(serial, "Stopped"));
      } else {
        const position = direction === "up" ? 0 : 100;
        await commandsRef.current.moveToPosition(serial, position);
        setMoveMessages((prev) => new Map(prev).set(serial, `Moving ${direction}...`));
      }
      commandsRef.current.getDeviceStatus(serial).then((status2) => {
        setDeviceStatuses((prev) => new Map(prev).set(serial, status2));
        setStatusErrors((prev) => {
          const next = new Map(prev);
          next.delete(serial);
          return next;
        });
      }).catch(() => {
      });
    } catch (err) {
      setMoveMessages((prev) => new Map(prev).set(serial, `Move failed: ${err.message}`));
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "max-w-3xl mx-auto p-4 space-y-4", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-2xl font-bold text-emerald-400", children: "WMS Network Monitor" }),
    status === "connect" && /* @__PURE__ */ jsx(
      "button",
      {
        onClick: handleConnect,
        className: "px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors",
        children: "Connect USB Stick"
      }
    ),
    status === "connecting" && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-gray-400", children: [
      /* @__PURE__ */ jsx("span", { className: "w-2 h-2 bg-emerald-400 rounded-full animate-pulse" }),
      "Configuring network..."
    ] }),
    status === "error" && /* @__PURE__ */ jsx(
      "div",
      {
        className: "bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400",
        dangerouslySetInnerHTML: { __html: error }
      }
    ),
    status === "monitoring" && stations.size === 0 && /* @__PURE__ */ jsx("div", { className: "text-gray-500", children: "Waiting for weather station broadcasts..." }),
    status === "monitoring" && [...stations.values()].map((s) => /* @__PURE__ */ jsxs("div", { className: "bg-gray-900 border border-emerald-700 rounded-lg p-4", children: [
      /* @__PURE__ */ jsx("div", { className: "text-gray-400 text-xs uppercase tracking-wide", children: "Serial" }),
      /* @__PURE__ */ jsx("div", { className: "text-white font-semibold mt-1", children: s.serialNumber }),
      /* @__PURE__ */ jsx("div", { className: "text-gray-400 text-xs uppercase tracking-wide mt-3", children: "Wind Speed" }),
      /* @__PURE__ */ jsxs("div", { className: "text-emerald-400 font-bold text-2xl mt-1", children: [
        s.windSpeed,
        " km/h"
      ] })
    ] }, s.serialNumber)),
    status === "monitoring" && /* @__PURE__ */ jsxs("div", { className: "space-y-3 pt-2", children: [
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
      scanDevices.length > 0 && /* @__PURE__ */ jsx(
        "button",
        {
          onClick: handleRefreshAll,
          disabled: refreshing,
          className: "ml-2 px-6 py-3 bg-violet-700 hover:bg-violet-600 disabled:bg-violet-800 disabled:cursor-wait text-white rounded-lg font-semibold text-sm transition-colors",
          children: refreshing ? "Refreshing..." : "Refresh All"
        }
      ),
      refreshSummary && /* @__PURE__ */ jsx("div", { className: "text-sm text-gray-500", children: refreshSummary }),
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
      scanDevices.filter((d) => !hiddenSerials.has(d.serialNumber)).map((d) => {
        const ds = deviceStatuses.get(d.serialNumber);
        const err = statusErrors.get(d.serialNumber);
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
                disabled: queryingSerial === d.serialNumber,
                className: "px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-wait text-white rounded text-xs font-semibold transition-colors shrink-0",
                children: queryingSerial === d.serialNumber ? "..." : "Status"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => handleWaveDevice(d.serialNumber),
                disabled: wavingSerial === d.serialNumber,
                className: "px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-800 disabled:cursor-wait text-white rounded text-xs font-semibold transition-colors shrink-0",
                children: wavingSerial === d.serialNumber ? "..." : "Wave"
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
          err && /* @__PURE__ */ jsx("div", { className: "mt-2 text-xs text-red-400", children: err }),
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
            if (!mm) return null;
            const ok = !mm.startsWith("Move failed");
            return /* @__PURE__ */ jsx("div", { className: `mt-2 text-xs ${ok ? "text-emerald-400" : "text-red-400"}`, children: mm });
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
