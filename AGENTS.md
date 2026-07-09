# wms-js

## Dependency pinning
`.npmrc` has `save-exact=true` — all versions pinned exactly. Never add `^` or `~`.

## Prerequisites
Docker (or Podman with docker-compose compatibility) — that's it.

## Commands (all via compose)
- `podman compose run --rm web npm test` — run all tests
- `podman compose run --rm web npx tsc --noEmit` — typecheck
- `podman compose run --rm web npm run build` — compile TS to dist/

## CLI debugger (needs USB stick)
```sh
docker compose run --rm web sh -c \
  "npx tsx packages/cli/src/index.ts --port /dev/ttyUSB0 --channel 18"
docker compose run --rm web sh -c \
  "npx tsx packages/cli/src/index.ts --port /dev/ttyUSB0 --discover"
```
The `web` service mounts `/dev:/dev` in `compose.yml` for USB access.

### CLI options
- `--port <path>` — serial port (required)
- `--channel <n>` — radio channel 11-26 (required unless `--discover`)
- `--pan-id <XXXX>` — PAN ID hex, default FFFF (rejected with `--discover`)
- `--key <hex>` — 32-char hex key (rejected with `--discover`)
- `--discover` — listen for a remote pairing broadcast, auto-switch to its network

## Running services
- `docker compose up -d mosquitto` — start MQTT broker
- `docker compose up mqtt-bridge web` — start app services with hot-reload

## Dev workflow
All services run via `tsx watch` inside the container — source is mounted
read-write, so edits are reflected immediately. No local Node.js needed.

## Module resolution
`@wms-js/lib/package.json` has an `exports` field pointing to `./src/index.ts`.
`tsx` resolves `@wms-js/lib` to TS source directly — no build step in dev.

## Testing
- Vitest with `vi.useFakeTimers()` for protocol timeout tests
- `MockSerialDriver` (`packages/lib/src/testing/`) simulates serial data
  without hardware: `simulateData()`, `simulateError()`, `simulateClose()`
- Test files live alongside source: `packages/*/src/**/*.test.ts`

## Logging
`packages/lib/src/logging/logger.ts` — minimal logger gated by `WMS_LOG_LEVEL` env var:
- Levels: `debug`, `info` (default), `warn`, `error`, `silent`
- Set via `WMS_LOG_LEVEL=debug` or at runtime with `setLogLevel(LogLevel.DEBUG)`
- Format: `[timestamp] [LVL] [TAG] message`
- `info` level shows: `[MOVE]`, `[STOP]`, `[7071]` state changes
- `debug` level adds: `[>>]`/`[<<]` serial I/O, `[8011]` overrides, raw 7071 frames
- Graceful in browser where `process.env` is unavailable (defaults to `info`)

## Serial driver interface
Defined in `packages/lib/src/serial/driver.ts`. Implementations:
- `MockSerialDriver` — for tests (in `@wms-js/lib`)
- `NodeSerialDriver` — real serialport via npm package (in `@wms-js/cli`)

## Protocol
Frames are `{...}` delimited. `{f}` = command rejected, `{a}` = success.
Broadcast frames are unwrapped (no braces). Full spec in `PROTOCOL.md`.

### Parsers (all compact, no spaces)
| Parser | File | Message type | Description |
|--------|------|-------------|-------------|
| `weatherStationMatcher` | `parsers/weather-station.ts` | `7080` | Wind speed broadcast |
| `networkParamsMatcher` | `parsers/network-params.ts` | `5060` | Remote pairing broadcast |
| `deviceScanMatcher` | `parsers/device-scan.ts` | `7020` | Remote scan query |
| `waveRequestMatcher` | `parsers/wave-request.ts` | `7050` | Wave request (key exchange step) |
| `networkJoinMatcher` | `parsers/network-join.ts` | `5018` | Network key share (key is byte-reversed) |
| `deviceScanResponseMatcher` | `parsers/device-scan-response.ts` | `7021` | Scan response (from `--scan` probe) |

### CLI behaviour
- Normal mode: logs `[>>]` writes, `[<<]` broadcasts, `[WS]`, `[NET]`, `[SCN]`, `[WAV]`, `[KEY]`
- `--discover`: listens on channel 18; on `5060` broadcast, auto-switches to discovered channel/PAN ID; rejects `--channel`, `--pan-id`, `--key`
- Scan response (`7020`): answered with `R01<serial>7021FFFF02` (hardcoded PAN ID)
- Network join (`5018`): prints serial, PAN ID, channel, key then exits

**Scan response window**: `Commands.scanNetwork()` uses `responseWindowMs` to collect `7021` broadcast responses. During this window (~3s), all serial frames are consumed by the active command session — broadcasts (weather station, pairing, etc.) are suppressed. This is acceptable because scanning is infrequent and short-lived.

## NetworkManager (new core module — WIP)
`packages/lib/src/network/` contains a state machine replacing `Commands` + `RadioController`:
- `events.ts` — `TypedEventEmitter<EventMap>` (zero-dep, portable)
- `types.ts` — `ConnectionState`, `KnownDevice`, `NetworkEventMap`
- `manager.ts` — `NetworkManager` class: fire-and-forget commands, broadcast frame
  cascade, typed events, device registry with dedup, serial write queue
- `manager.test.ts` — 18 tests

### Design
- All commands are fire-and-forget (no `CommandSession`).
- All incoming frames treated as broadcasts processed via matcher cascade.
- `processFrame()` cascade order: weatherStation → deviceScanResponse →
  deviceStatus → moveResponse → waveResponse → waveRequest. First match wins.
- Setup phase (open) still uses synchronous ack-wait with temporary `FrameParser`
  and `sendAndWait` helper.

### Known protocol frame formats
- `scanNetwork(panId)`: writes `R04FFFFFF7020<panId>02` (was missing `7020`)
- Device scan response: `r<serial>7021<panId><deviceType>…`
- Device status: `r<serial>8011<6-pad><deviceType><pos><incl><v1><v2><moving>`
- Move response: `r<serial>7071<10-pad><pos><incl>…`
- Position hex = `Math.round(pos × 2)`, inclination hex = `Math.round(inc + 127)`

### Web app changes
- `packages/web/src/browser.ts` — `startMonitor` now returns `NetworkManager` instead of
  `{ commands: Commands }`. Discovery wizard (`startDiscovery`) unchanged.
- `packages/web/src/home.tsx` — reduced from 17 to 10 state vars. Uses `NetworkManager`'s
  reactive events and fire-and-forget commands. `knownDevices` derived from
  `manager.knownDevices` each render with `forceRender` counter. Wave/move messages
  stored in local state, set optimistically before the serial write completes.
- `packages/web/public/home-bundle.js` — esbuild output (28.6kb).

## Publishing `@wms-js/lib` to npm

### Automated (CI, recommended)
Push a version tag to trigger CI publish:
```sh
git checkout main && git pull
npm version 0.1.0 -w @wms-js/lib   # bumps version, commits, tags v0.1.0
git push && git push --tags          # CI: tests → build → publish
```

### Manual (local, fallback)
```sh
npm run build -w @wms-js/lib
cp packages/lib/README.md packages/lib/dist/
cp packages/lib/LICENSE packages/lib/dist/
node -e "
  const pkg = require('./packages/lib/package.json');
  pkg.main = 'index.js';
  pkg.types = 'index.d.ts';
  pkg.exports = {
    '.': { types: './index.d.ts', import: './index.js' },
    './*': { types: './*.d.ts', import: './*.js' }
  };
  delete pkg.scripts;
  delete pkg.devDependencies;
  delete pkg.publishConfig;
  delete pkg.files;
  require('fs').writeFileSync('./packages/lib/dist/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
npm publish packages/lib/dist --access public
```

### Prerequisites
- `npm login` on your machine
- `NPM_TOKEN` set in GitHub repo secrets (automation token, publish scope)
- `@wms-js` scope on npm (already done)

## Packages
| Package | Entry point | Role |
|---------|-------------|------|
| `@wms-js/lib` | `packages/lib/src/index.ts` | Core: frame parsing, sessions, controller, commands, broadcast routing |
| `@wms-js/mqtt-bridge` | `packages/mqtt-bridge/src/index.ts` | MQTT relay (stub — waiting for lib integration) |
| `@wms-js/web` | `packages/web/src/index.ts` | Web service (stub — waiting for framework) |
| `@wms-js/cli` | `packages/cli/src/index.ts` | CLI debugger |
