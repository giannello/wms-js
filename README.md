# warema-wms

Control Warema WMS radio devices (awnings, weather stations) via a USB serial stick.

## Packages

| Package | Description |
|---------|-------------|
| `@warema/lib` | Core library — frame parsing, command sessions, controller, broadcast routing |
| `@warema/mqtt-bridge` | MQTT bridge — relays radio messages to a Home Assistant MQTT broker |
| `@warema/web` | Web service (stub) |
| `@warema/cli` | CLI debugger — interact with the stick from the command line |

## Setup

```sh
git clone <repo>
cd warema-wms
npm install
```

TypeScript compilation:

```sh
npm run build
```

Run all tests:

```sh
npm test
```

### Docker

A `compose.yml` provides a Mosquitto broker and two app services:

```sh
docker compose up -d mosquitto
docker compose up mqtt-bridge web
```

## CLI Debugger

The CLI tool opens the serial port, initializes the stick, and prints all frames
exchanged with it to stdout — useful for debugging weather broadcasts and other
radio traffic.

### Usage

```
npx tsx packages/cli/src/index.ts --port <path> --channel <n> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--port <path>` | Serial port path (e.g. `/dev/ttyUSB0`) |
| `--channel <n>` | Radio channel (11–26) |
| `--pan-id <XXXX>` | PAN ID in hex, defaults to `FFFF` |
| `--key <hex>` | 32-character hex encryption key (optional, for encrypted networks) |
| `--help` | Show help |

### Examples

Open an unencrypted network (PAN ID `FFFF`):

```sh
npx tsx packages/cli/src/index.ts --port /dev/ttyUSB0 --channel 18
```

Join an encrypted network:

```sh
npx tsx packages/cli/src/index.ts --port /dev/ttyUSB0 --channel 18 --pan-id 1234 --key 0123456789ABCDEF0123456789ABCDEF
```

Through Docker with USB passthrough:

```sh
docker compose run --rm --device /dev/ttyUSB0:/dev/ttyUSB0 web sh -c \
  "npx tsx packages/cli/src/index.ts --port /dev/ttyUSB0 --channel 18"
```

### Output format

Each line is prefixed with a timestamp and a tag:

```
[12:34:56] [>>] {G}
[12:34:56] [<<] {gWMS USB-Stick}
[12:34:56] [>>] {M % 18 FFFF}
[12:34:56] [<<] {a}
[12:34:57] [INF] Listening for broadcasts (Ctrl+C to stop)...
[12:34:58] [<<] {rABCDEF7080000010FFFFFFFAC8FFFF}
[12:34:58] [WS]  ABCDEF  wind=16 km/h
```

| Tag | Meaning |
|-----|---------|
| `[>>]` | Frame sent to the stick |
| `[<<]` | Frame received from the stick |
| `[INF]` | Informational message |
| `[WS]` | Decoded weather station broadcast |
| `[ERR]` | Error message |

## Protocol

See [`PROTOCOL.md`](./PROTOCOL.md) for details on the WMS serial protocol.
