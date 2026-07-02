# warema-wms

## Dependency pinning
`.npmrc` has `save-exact=true` — all versions pinned exactly. Never add `^` or `~`.

## Prerequisites
Docker (or Podman with docker-compose compatibility) — that's it.

## Commands (all via compose)
- `docker compose run --rm web npm test` — run all tests
- `docker compose run --rm web npx tsc --noEmit` — typecheck
- `docker compose run --rm web npm run build` — compile TS to dist/

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
`@warema/lib/package.json` has an `exports` field pointing to `./src/index.ts`.
`tsx` resolves `@warema/lib` to TS source directly — no build step in dev.

## Testing
- Vitest with `vi.useFakeTimers()` for protocol timeout tests
- `MockSerialDriver` (`packages/lib/src/testing/`) simulates serial data
  without hardware: `simulateData()`, `simulateError()`, `simulateClose()`
- Test files live alongside source: `packages/*/src/**/*.test.ts`

## Serial driver interface
Defined in `packages/lib/src/serial/driver.ts`. Implementations:
- `MockSerialDriver` — for tests (in `@warema/lib`)
- `NodeSerialDriver` — real serialport via npm package (in `@warema/cli`)

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

### CLI behaviour
- Normal mode: logs `[>>]` writes, `[<<]` broadcasts, `[WS]`, `[NET]`, `[SCN]`, `[WAV]`, `[KEY]`
- `--discover`: listens on channel 18; on `5060` broadcast, auto-switches to discovered channel/PAN ID; rejects `--channel`, `--pan-id`, `--key`
- Scan response (`7020`): answered with `R01<serial>7021FFFF02` (hardcoded PAN ID)
- Network join (`5018`): prints serial, PAN ID, channel, key then exits

## Packages
| Package | Entry point | Role |
|---------|-------------|------|
| `@warema/lib` | `packages/lib/src/index.ts` | Core: frame parsing, sessions, controller, commands, broadcast routing |
| `@warema/mqtt-bridge` | `packages/mqtt-bridge/src/index.ts` | MQTT relay (stub — waiting for lib integration) |
| `@warema/web` | `packages/web/src/index.ts` | Web service (stub — waiting for framework) |
| `@warema/cli` | `packages/cli/src/index.ts` | CLI debugger |
