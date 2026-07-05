// src/home.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// ../lib/src/frame/errors.ts
var MalformedFrameError = class extends Error {
  partial;
  constructor(partial) {
    super(`Malformed frame: no closing brace within timeout`);
    this.name = "MalformedFrameError";
    this.partial = partial;
  }
};

// ../lib/src/frame/parser.ts
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

// ../lib/src/frame/serializer.ts
var encoder = new TextEncoder();
function serializeFrame(content) {
  return encoder.encode(`{${content}}`);
}

// ../lib/src/command/session.ts
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

// ../lib/src/command/ack-match.ts
var ackMatch = {
  exact(type) {
    return (frame) => frame === type ? "" : null;
  },
  prefix(prefix) {
    return (frame) => frame.startsWith(prefix) ? frame.slice(prefix.length) : null;
  }
};

// ../lib/src/controller.ts
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
    this.driver.write(serializeFrame(op.command));
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
        return;
      }
    }
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

// ../lib/src/parsers/device-scan-response.ts
function deviceScanResponseMatcher(frame) {
  if (frame.length < 57) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "7021") return null;
  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    deviceType: frame.slice(15, 17),
    unknown: frame.slice(17, 57),
    raw: frame
  };
}

// ../lib/src/commands/name.ts
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
    const responses = [];
    const frame = `R04FFFFFF7020${panId.toUpperCase()}02`;
    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: timeoutMs
    });
    session.onResponse((content) => {
      const parsed = deviceScanResponseMatcher(content);
      if (parsed) {
        responses.push(parsed);
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
    return responses;
  }
};

// ../lib/src/parsers/weather-station.ts
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

// src/drivers/web-serial.ts
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

// src/browser.ts
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
    return;
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
    return;
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
  return { commands };
}

// src/home.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function App() {
  const [stations, setStations] = React.useState(/* @__PURE__ */ new Map());
  const [status, setStatus] = React.useState("connect");
  const [error, setError] = React.useState("");
  const commandsRef = React.useRef(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanDevices, setScanDevices] = React.useState([]);
  const [scanError, setScanError] = React.useState("");
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
      setScanDevices(results);
    } catch (e) {
      setScanError(e.message);
    }
    setScanning(false);
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
      scanDevices.map((d) => /* @__PURE__ */ jsxs("div", { className: "bg-gray-900 border border-violet-700 rounded-lg p-4", children: [
        /* @__PURE__ */ jsx("div", { className: "text-gray-400 text-xs uppercase tracking-wide", children: "Serial" }),
        /* @__PURE__ */ jsx("div", { className: "text-white font-semibold mt-1", children: d.serialNumber }),
        /* @__PURE__ */ jsx("div", { className: "text-gray-400 text-xs uppercase tracking-wide mt-3", children: "Device Type" }),
        /* @__PURE__ */ jsx("div", { className: "text-violet-400 font-bold text-2xl mt-1", children: d.deviceType })
      ] }, d.serialNumber))
    ] })
  ] });
}
var root = document.getElementById("root");
if (root) createRoot(root).render(/* @__PURE__ */ jsx(App, {}));
