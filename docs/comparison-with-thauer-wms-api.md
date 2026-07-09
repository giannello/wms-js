# Comparison with thauer/warema-wms-api (reference)

Reference: https://github.com/thauer/warema-wms-api

Files analysed:
- `lib/wms-vb-stick.js` — stick driver, command queue, device management
- `lib/wms-vb-wmsutil.js` — frame encoding/decoding

---

## Frame / Command Formats — Same

| Command | Us | Reference |
|---------|----|-----------|
| `blindGetPos` | `R06<serial>801001000005` | `R06<snr>801001000005` |
| `blindMoveToPos` | `R06<serial>707003<pp><ww>FFFF` | `R06<snr>707003<pp><ww>FFFF` |
| `scanRequest` | `R04FFFFFF7020<panId>02` | `R04FFFFFF7020<panId>02` |
| `stickGetName` | `{G}` | `{G}` |
| `stickSetKey` | `{K401<key>}` | `{K401<key>}` |
| `stickSwitchChannel` | `{M%<channel><panId>}` | `{M%<channel><panId>}` |
| Position encoding | `Math.round(pos × 2)` | `pos × 2, min(0, 100)` |
| Angle encoding | `Math.round(inc + 127)` | `ang/100 × 75 + 127` |

---

## Differences

### 1. Stop command suffix

| Us | Reference |
|----|-----------|
| `R06<serial>707001` | `R06<serial>707001FFFFFF00` |

Reference appends `FFFFFF00` suffix to the stop command. We send just `707001` with no suffix.
Known decision — our version works but the reference's `FFFFFF00` may be more reliable.

### 2. Scan repetition

Reference sends scan **3 times** back-to-back with a comment "some devices don't answer the
first scanRequest". We send it once.

### 3. Retry / timeout per command type

Reference has per-command retry logic with a queue-based timeout system:

| Command    | Timeout | Retries | Delay after |
|------------|---------|---------|-------------|
| `blindGetPos`    | 500ms  | 5       | 100ms      |
| `blindMoveToPos` | 500ms  | 3       | 300ms      |
| `blindStopMove`  | 200ms  | 3       | 5ms        |
| `waveRequest`    | 500ms  | 0       | 300ms      |
| `scanRequest`    | 750ms  | 0       | —          |

We have **no retry mechanism** — commands are fire-and-forget via `.then()` queue.

### 4. `{V}` (stick version) not queried

Reference sends `{V}` during init (after `{G}`) and parses the `{v...}` response.
We skip it entirely.

### 5. Key/Channel init order

Reference: `G → V → K → M` (set key, then switch channel).
Us: `G → M → K` (switch channel, then optionally set key).

### 6. Slat tilt control — missing

Reference has `vnBlindSlatTiltOver(id, diff)`, `vnBlindSlatUp()`, `vnBlindSlatDown()`.
These query the current position, calculate a ±33° angle step (100/3), then send a new
move command with the updated angle. We have nothing equivalent.

### 7. Periodic full position polling — missing

Reference has `setPosUpdInterval(ms)` (minimum 5000ms) that polls **all** devices
regardless of moving state. We only poll devices where `moving === true`
(via `startMovingPoll` at 2000ms).

### 8. 7070 incoming frame parsing — missing

Reference decodes incoming `7070` frames (move commands sent from other remotes to a
device), parsing position/angle/valance from them. We only handle `7071` (move responses).

### 9. Weather station — partial decode

Reference decodes from `7080` broadcasts:
- wind speed ✓ (we do this)
- illuminance (calculated from two hex fields)
- temperature (`parseInt(hex, 16) / 2 - 35`)
- rain flag (`hex === "C8"`)

We only decode wind speed.

### 10. Other 8011 parameter types — missing

Reference decodes additional sub-types from 8011 responses:
- `0C000006` — auto modes & limits (wind/rain/sun/dusk thresholds)
- `26000046` — clock/timer settings

We only decode the `01000003` / `01000005` position sub-type.

### 11. Command completion notifications — missing

Reference has an `enableCmdConfirmationNotification` flag. When set, every command
publishes a `wms-vb-cmd-result-*` event on completion (success or timeout), allowing
callers to track per-command completion. We have nothing equivalent — our commands
are entirely fire-and-forget.

### 12. Scan response PAN ID

Reference echoes the actual `params.panId` in scan responses (`R01<snr>7021<panId>02`).
We hardcode `FFFF`.

### 13. `scanInProgress` guard

Reference guards against concurrent scans (`stickObj.scanInProgress` flag). We don't —
calling `scanNetwork` multiple times stacks probe frames onto the write queue.

---

## Ranking by impact

| #  | Gap | Impact |
|----|-----|--------|
| 3  | Retry/timeout per command | **High** — lost commands never recover |
| 7  | Periodic full position poll | **Medium** — no status refresh for idle devices |
| 6  | Slat tilt control | **Medium** — feature gap for venetian blinds |
| 9  | Weather station decode | **Medium** — temperature/rain/illuminance lost |
| 2  | Scan repetition | **Low** — occasional missed devices on first scan |
| 1  | Stop suffix | **Low** — works but may differ from spec |
| 10 | 8011 other params | **Low** — useful for automation features later |
| 4  | `{V}` version query | **Low** — diagnostic only |
| 5  | Init order | **Low** — functionally equivalent |
| 8  | 7070 frame parsing | **Low** — diagnostic / multi-remote scenarios |
| 11 | Cmd completion notifications | **Low** — nice-to-have for HA command feedback |
| 12 | Scan response PAN ID | **Low** — FFFF wildcard works fine |
| 13 | scanInProgress guard | **Low** — edge case |
