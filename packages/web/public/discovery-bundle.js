// packages/web/src/ui.tsx
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

// packages/lib/src/parsers/network-params.ts
function networkParamsMatcher(frame) {
  if (frame.length < 21) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "5060") return null;
  const channelHex = frame.slice(17, 19);
  const channel = Number.parseInt(channelHex, 16);
  if (Number.isNaN(channel) || channel < 11 || channel > 26) return null;
  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    channel,
    raw: frame
  };
}

// packages/lib/src/parsers/device-scan.ts
function deviceScanMatcher(frame) {
  if (frame.length < 17) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "7020") return null;
  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    raw: frame
  };
}

// packages/lib/src/parsers/network-join.ts
function networkJoinMatcher(frame) {
  if (frame.length < 51) return null;
  if (frame[0] !== "r") return null;
  if (frame.slice(7, 11) !== "5018") return null;
  if (frame.slice(47, 49) !== "FF") return null;
  const channelHex = frame.slice(49, 51);
  const channel = Number.parseInt(channelHex, 16);
  if (Number.isNaN(channel) || channel < 11 || channel > 26) return null;
  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    key: decodeKey(frame.slice(15, 47)),
    channel,
    raw: frame
  };
}
function decodeKey(hex) {
  let out = "";
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    out += hex.slice(i, i + 2);
  }
  return out;
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
async function startDiscovery(port, onEvent) {
  const driver = new WebSerialDriver(port);
  const radio = new RadioController(driver);
  const commands = new Commands(radio);
  const logParser = new FrameParser();
  driver.onData((data) => {
    const frames = logParser.feed(data);
    for (const frame of frames) {
      onEvent({ type: "log", timestamp: ts(), message: `[<<] {${frame}}` });
    }
  });
  const originalWrite = driver.write.bind(driver);
  driver.write = async (data) => {
    const frame = new TextDecoder().decode(data);
    const inner = frame.startsWith("{") && frame.endsWith("}") ? frame.slice(1, -1) : frame;
    onEvent({ type: "log", timestamp: ts(), message: `[>>] {${inner}}` });
    await originalWrite(data);
  };
  radio.onError((error) => {
    onEvent({ type: "error", timestamp: ts(), message: error.message });
  });
  onEvent({ type: "log", timestamp: ts(), message: "Opening serial port..." });
  await radio.open("web-serial");
  let stickName = "";
  try {
    stickName = await commands.getName();
    onEvent({ type: "log", timestamp: ts(), message: `Stick name: ${stickName}` });
  } catch (e) {
    onEvent({
      type: "error",
      timestamp: ts(),
      message: `Failed to configure network: ${e.message}`
    });
    await radio.close();
    throw new Error("Failed to configure network");
  }
  onEvent({ type: "connected", timestamp: ts() });
  try {
    await commands.setNetworkParameters({
      receiveBroadcasts: true,
      channel: 18,
      panId: "FFFF"
    });
    onEvent({
      type: "log",
      timestamp: ts(),
      message: "Network configured: channel 18, PAN ID FFFF"
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
  onEvent({
    type: "log",
    timestamp: ts(),
    message: "Press the L button on a remote to scan"
  });
  radio.onBroadcast(async (frame) => {
    const ws = weatherStationMatcher(frame);
    if (ws) {
      onEvent({
        type: "weather-station",
        timestamp: ts(),
        serialNumber: ws.serialNumber,
        windSpeed: ws.windSpeed
      });
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[WS] ${ws.serialNumber}  wind=${ws.windSpeed} km/h`
      });
    }
    const np = networkParamsMatcher(frame);
    if (np) {
      onEvent({
        type: "network-params",
        timestamp: ts(),
        serialNumber: np.serialNumber,
        panId: np.panId,
        channel: np.channel
      });
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[NET] ${np.serialNumber}  PAN ID=${np.panId}  channel=${np.channel}`
      });
      try {
        await commands.setNetworkParameters({
          receiveBroadcasts: true,
          channel: np.channel,
          panId: np.panId
        });
        onEvent({
          type: "log",
          timestamp: ts(),
          message: `[NET] Switched to channel ${np.channel}, PAN ID ${np.panId}`
        });
      } catch (e) {
        onEvent({
          type: "error",
          timestamp: ts(),
          message: `[NET] Switch failed: ${e.message}`
        });
      }
      return;
    }
    const sq = deviceScanMatcher(frame);
    if (sq) {
      onEvent({
        type: "device-scan",
        timestamp: ts(),
        serialNumber: sq.serialNumber,
        panId: sq.panId
      });
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[SCN] ${sq.serialNumber}  PAN ID=${sq.panId}`
      });
      const cmd = `R01${sq.serialNumber}7021FFFF02`;
      setTimeout(() => {
        try {
          radio.send(cmd, {
            ackMatcher: () => null,
            ackTimeoutMs: 0,
            responseWindowMs: 0
          });
        } catch (e) {
          onEvent({
            type: "error",
            timestamp: ts(),
            message: `Scan response failed: ${e.message}`
          });
        }
      }, 0);
    }
    const wr = waveRequestMatcher(frame);
    if (wr) {
      onEvent({
        type: "wave-request",
        timestamp: ts(),
        serialNumber: wr.serialNumber
      });
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[WAV] ${wr.serialNumber}`
      });
    }
    const nj = networkJoinMatcher(frame);
    if (nj) {
      onEvent({
        type: "network-join",
        timestamp: ts(),
        serialNumber: nj.serialNumber,
        panId: nj.panId,
        channel: nj.channel,
        key: nj.key
      });
      onEvent({
        type: "log",
        timestamp: ts(),
        message: `[KEY] ${nj.serialNumber}  PAN=${nj.panId}  CH=${nj.channel}`
      });
      try {
        await radio.close();
        onEvent({ type: "log", timestamp: ts(), message: "Port closed" });
      } catch (e) {
        onEvent({
          type: "error",
          timestamp: ts(),
          message: `Failed to close port: ${e.message}`
        });
      }
    }
  });
}

// packages/web/src/ui.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function App() {
  const [port, setPort] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [step, setStep] = React.useState("connect");
  const [events, setEvents] = React.useState([]);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const eventsRef = React.useRef([]);
  const logEndRef = React.useRef(null);
  const addEvent = React.useCallback((evt) => {
    eventsRef.current = [...eventsRef.current, evt];
    setEvents(eventsRef.current);
  }, []);
  const handleConnect = async () => {
    try {
      const p = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 1027, usbProductId: 24577 }]
      });
      setPort(p);
      setRunning(true);
      setResult(null);
      setError("");
      eventsRef.current = [];
      setEvents([]);
      try {
        await startDiscovery(p, (evt) => {
          if (evt.type === "connected") {
            setStep("paired");
          }
          if (evt.type === "device-scan") {
            setStep((prev) => prev === "paired" ? "press-a" : prev);
          }
          if (evt.type === "wave-request") {
            setStep((prev) => prev === "press-a" ? "press-stop" : prev);
          }
          if (evt.type === "network-join") {
            setResult(evt);
            setStep("complete");
            try {
              localStorage.setItem("wms-network-params", JSON.stringify({
                panId: evt.panId,
                channel: evt.channel,
                key: evt.key
              }));
            } catch {
            }
          }
          if (evt.type === "error") {
            setError(evt.message || "");
          }
          addEvent(evt);
        });
      } catch (e) {
        addEvent({ type: "error", timestamp: "", message: e.message });
        setError(e.message);
      }
      setRunning(false);
    } catch {
    }
  };
  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);
  const stepStatus = (s) => {
    const order = ["connect", "paired", "press-a", "press-stop", "complete"];
    const idx = order.indexOf(step);
    const sIdx = order.indexOf(s);
    if (sIdx < idx) return "done";
    if (sIdx === idx) return "active";
    return "pending";
  };
  return /* @__PURE__ */ jsxs("div", { className: "max-w-3xl mx-auto p-4 space-y-4", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-2xl font-bold text-emerald-400", children: "WMS Network Parameters Discovery" }),
    /* @__PURE__ */ jsx(StepCard, { number: 1, title: "Connect the USB stick", status: stepStatus("connect"), children: step === "connect" ? /* @__PURE__ */ jsx(
      "button",
      {
        onClick: handleConnect,
        className: "px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors",
        children: "Connect USB Stick"
      }
    ) : /* @__PURE__ */ jsxs("div", { className: "text-emerald-400 flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("span", { children: "\u2713" }),
      /* @__PURE__ */ jsx("span", { children: "Stick connected" })
    ] }) }),
    stepStatus("paired") !== "pending" && /* @__PURE__ */ jsx(StepCard, { number: 2, title: "Enable discovery mode on the remote", status: stepStatus("paired"), children: step === "paired" ? /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
      /* @__PURE__ */ jsxs("p", { children: [
        "Long-press the ",
        /* @__PURE__ */ jsx("strong", { children: "L" }),
        " button on your remote until the LED blinks."
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-400", children: [
        /* @__PURE__ */ jsx("span", { className: "w-2 h-2 bg-emerald-400 rounded-full animate-pulse" }),
        "Listening for remote..."
      ] })
    ] }) : /* @__PURE__ */ jsxs("div", { className: "text-emerald-400 flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("span", { children: "\u2713" }),
      /* @__PURE__ */ jsx("span", { children: "Remote detected" })
    ] }) }),
    stepStatus("press-a") !== "pending" && /* @__PURE__ */ jsx(StepCard, { number: 3, title: "Connect the remote to the USB stick", status: stepStatus("press-a"), children: step === "press-a" ? /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
      /* @__PURE__ */ jsxs("p", { children: [
        "Wait for the ",
        /* @__PURE__ */ jsx("strong", { children: "wifi" }),
        " LED on your remote to turn solid red, then press the ",
        /* @__PURE__ */ jsx("strong", { children: "A" }),
        " button."
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "bg-gray-800 rounded p-3 text-sm text-gray-400 border border-gray-700", children: [
        /* @__PURE__ */ jsx("strong", { className: "text-yellow-400", children: "Tip:" }),
        " If nothing happens, press",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "C" }),
        ", wait for the LED to stop blinking, then press",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "A" }),
        " again. Repeat until the next step appears."
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-500", children: [
        /* @__PURE__ */ jsx("span", { className: "w-2 h-2 bg-blue-400 rounded-full animate-pulse" }),
        "Waiting for wave request..."
      ] })
    ] }) : /* @__PURE__ */ jsxs("div", { className: "text-emerald-400 flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("span", { children: "\u2713" }),
      /* @__PURE__ */ jsx("span", { children: "Wave request received" })
    ] }) }),
    stepStatus("press-stop") !== "pending" && /* @__PURE__ */ jsx(StepCard, { number: 4, title: "Extract network parameters", status: stepStatus("press-stop"), children: step === "press-stop" ? /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
      /* @__PURE__ */ jsxs("p", { children: [
        "Press the ",
        /* @__PURE__ */ jsx("strong", { children: "STOP" }),
        " button on your remote."
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-500", children: [
        /* @__PURE__ */ jsx("span", { className: "w-2 h-2 bg-purple-400 rounded-full animate-pulse" }),
        "Waiting for key exchange..."
      ] })
    ] }) : /* @__PURE__ */ jsxs("div", { className: "text-emerald-400 flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("span", { children: "\u2713" }),
      /* @__PURE__ */ jsx("span", { children: "Pairing complete" })
    ] }) }),
    result && /* @__PURE__ */ jsxs("div", { className: "border-2 border-yellow-500 rounded-lg p-4 bg-yellow-500/10 space-y-3", children: [
      /* @__PURE__ */ jsx("div", { className: "text-yellow-400 font-bold text-lg", children: "Network Parameters Discovered!" }),
      /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm", children: [
        /* @__PURE__ */ jsx("span", { className: "text-gray-400", children: "PAN ID:" }),
        /* @__PURE__ */ jsx("span", { className: "font-semibold", children: result.panId }),
        /* @__PURE__ */ jsx("span", { className: "text-gray-400", children: "Channel:" }),
        /* @__PURE__ */ jsx("span", { className: "font-semibold", children: result.channel }),
        /* @__PURE__ */ jsx("span", { className: "text-gray-400", children: "Key:" }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-yellow-300 break-all", children: result.key })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "bg-emerald-900/40 border border-emerald-700 rounded p-3 text-sm text-emerald-300", children: [
        "Short-press the ",
        /* @__PURE__ */ jsx("strong", { children: "L" }),
        " button on your remote to return it to normal operation."
      ] })
    ] }),
    error && step !== "complete" && /* @__PURE__ */ jsx("div", { className: "bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-400", children: error }),
    /* @__PURE__ */ jsxs("details", { className: "text-sm", children: [
      /* @__PURE__ */ jsx("summary", { className: "text-gray-500 cursor-pointer hover:text-gray-300 transition-colors", children: "Technical Details" }),
      /* @__PURE__ */ jsxs("div", { className: "bg-gray-900 rounded-lg p-3 mt-2 h-64 overflow-y-auto leading-relaxed", children: [
        events.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-gray-600 italic", children: "No events yet..." }),
        events.map((e, i) => /* @__PURE__ */ jsxs("div", { className: e.type === "error" ? "text-red-400" : e.type === "network-join" ? "text-yellow-300" : e.type === "weather-station" ? "text-green-400" : e.type === "network-params" ? "text-cyan-300" : e.type === "device-scan" ? "text-purple-300" : e.type === "wave-request" ? "text-orange-300" : "text-gray-300", children: [
          e.timestamp && /* @__PURE__ */ jsxs("span", { className: "text-gray-600", children: [
            "[",
            e.timestamp,
            "] "
          ] }),
          e.message
        ] }, i)),
        /* @__PURE__ */ jsx("div", { ref: logEndRef })
      ] })
    ] })
  ] });
}
function StepCard({ number, title, status, children }) {
  const border = status === "done" ? "border-emerald-700" : status === "active" ? "border-emerald-500" : "border-gray-700";
  const bg = status === "pending" ? "bg-gray-900/50" : "bg-gray-900";
  return /* @__PURE__ */ jsxs("div", { className: `rounded-lg p-4 ${bg} border ${border} space-y-2`, children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsx("span", { className: `w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${status === "done" ? "bg-emerald-600 text-white" : status === "active" ? "bg-emerald-500 text-white" : "bg-gray-700 text-gray-400"}`, children: status === "done" ? "\u2713" : number }),
      /* @__PURE__ */ jsx("h2", { className: `font-semibold ${status === "pending" ? "text-gray-500" : "text-gray-200"}`, children: title })
    ] }),
    status !== "pending" && /* @__PURE__ */ jsx("div", { className: "ml-10", children })
  ] });
}
var root = document.getElementById("root");
if (root) createRoot(root).render(/* @__PURE__ */ jsx(App, {}));
