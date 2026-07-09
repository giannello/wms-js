# Protocol Reference (from thauer/warema-wms-api)

Reference implementation: https://github.com/thauer/warema-wms-api  
Files analysed: `lib/wms-vb-wmsutil.js`, `lib/wms-vb-stick.js`

---

## Frame Structure

All frames are ASCII hex-encoded. Device → stick broadcasts are unwrapped
(no braces). Stick-level commands/responses are wrapped in `{}`.

| Format | Direction | Example |
|--------|-----------|---------|
| `r<snr><type><payload>` | Device → stick (broadcast) | `rABCDEF7080010A...` |
| `{R<cmd><snr><type><payload>}` | Stick → device (command) | `{R06ABCDEF70700300C8FFFF}` |
| `{G}` / `{V}` / `{a}` / `{f}` | Stick ↔ host (control) | `{G}`, `{vWMSv2.5}`, `{a}`, `{f}` |
| `{R21<snr>50AC}` | Stick → device (ack request) | `{R21ABCDEF50AC}` |

---

## 7080 — Weather Station Broadcast

Unsolicited broadcast from a weather station.

```
rSSSSSS7080YYWWL1AAAAAAL2RRxxTTyyyy
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Serial number, zero-padded |
| 7–10   | 4   | Msg Type | Always `7080` |
| 11–12  | 2   | YY    | Unknown |
| 13–14  | 2   | WW    | Wind speed (hex 0–FF → 0–255 km/h) |
| 15–16  | 2   | L1    | Illuminance factor 1 |
| 17–22  | 6   | AAAAAA | Unknown (6 hex chars) |
| 23–24  | 2   | L2    | Illuminance factor 2 |
| 25–26  | 2   | RR    | Unknown |
| 27–28  | 2   | xx    | Rain flag (`C8` = raining) |
| 29–30  | 2   | TT    | Temperature hex |
| 31+    | —   | yyyy  | Unknown |

**Decoding** (Thauer, alpha — no real device validation):

- Wind speed: `parseInt(WW, 16)`
- Illuminance: `L1 === "00" ? parseInt(L2, 16) * 2 : parseInt(L1, 16) * parseInt(L2, 16) * 2`
- Rain: `xx === "C8"`
- Temperature: `parseInt(TT, 16) / 2 - 35` → °C

---

## 5060 — Network Parameter Broadcast

Broadcast from a remote in pairing mode (L button pressed).

```
rXXXXXX5060PPPP02CC00
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Remote serial |
| 7–10   | 4   | Msg Type | Always `5060` |
| 11–14  | 4   | PAN ID | Network PAN ID (hex) |
| 15–16  | 2   | `02`  | Constant |
| 17–18  | 2   | Channel | Channel hex (`0B`–`1A`) |
| 19–20  | 2   | `00`  | Constant |

---

## 7020 — Device Scan Query

Broadcast from a remote scanning for devices.

```
rXXXXXX7020PPPP02
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Remote serial |
| 7–10   | 4   | Msg Type | Always `7020` |
| 11–14  | 4   | PAN ID | Network PAN ID (hex) |
| 15–16  | 2   | `02`  | Constant (device type filter?) |

---

## 7021 — Scan Response

Stick responds to a `7020` scan query.

```
R01XXXXXX7021PPPPDD
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0–2    | 3   | Prefix | Always `R01` |
| 3–8    | 6   | Serial | Remote serial (echoed) |
| 9–12   | 4   | Msg Type | Always `7021` |
| 13–16  | 4   | PAN ID | Network PAN ID (maybe `FFFF` wildcard) |
| 17–18  | 2   | DD    | Device type (see table) |

**Device type values**:

| DD  | Type |
|-----|------|
| `02` | Stick / software |
| `06` | Weather station |
| `07` | Remote control |
| `20` | Plug receiver |
| `21` | Actuator UP |
| `25` | Radio motor |
| `63` | Web control |

---

## 7050 — Wave Request

Sent by remote to invite the stick into key-exchange pairing.

```
rXXXXXX7050
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Remote serial |
| 7–10   | 4   | Msg Type | Always `7050` |

---

## 5018 — Network Join Request

Sent by remote (after STOP press) to share the network key.

```
rXXXXXX5018PPPP<32-hex-key>FFCC
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Remote serial |
| 7–10   | 4   | Msg Type | Always `5018` |
| 11–14  | 4   | PAN ID | Network PAN ID |
| 15–46  | 32  | Key   | Encryption key, byte-reversed (LE) |
| 47–48  | 2   | `FF`  | Constant |
| 49–50  | 2   | Channel | Radio channel (hex `0B`–`1A`) |

**Key reversal**: frame bytes are little-endian. `0102...0F10` → reverse pairs → `100F...0201`.

---

## 7070 — Device Move / Stop

Commands sent from stick to device to control position.

### Move to position

```
{R06XXXXXX707003PPWWFFFF}
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | `{`   | Frame start |
| 1–3    | 3   | Prefix | Always `R06` |
| 4–9    | 6   | Serial | Target device serial |
| 10–13  | 4   | Msg Type | Always `7070` |
| 14–15  | 2   | Cmd   | `03` = move to position |
| 16–17  | 2   | PP    | Target position (hex `00`–`C8` = 0–100%) |
| 18–19  | 2   | WW    | Target slat angle (hex; `7F` = 0°, `34`–`CA` range) |
| 20–23  | 4   | VV    | Valance (both, `FFFF` = omit) |
| 24     | 1   | `}`   | Frame end |

### Stop

```
{R06XXXXXX707001FFFFFF00}
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | `{`   | Frame start |
| 1–3    | 3   | Prefix | Always `R06` |
| 4–9    | 6   | Serial | Target device serial |
| 10–13  | 4   | Msg Type | Always `7070` |
| 14–15  | 2   | Cmd   | `01` = stop |
| 16–17  | 2   | FF    | Position placeholder (`FF`) |
| 18–19  | 2   | FF    | Angle placeholder (`FF`) |
| 20–21  | 2   | FF    | Valance 1 placeholder (`FF`) |
| 22–23  | 2   | VV    | Valance 2 placeholder (`FF`) |
| 24–25  | 2   | `00`  | Trailing byte |
| 26     | 1   | `}`   | Frame end |

**Ack**: `{a}` = accepted, `{f}` = rejected.

### Position encoding

- Percent → hex: `Math.round(pos × 2)`, clamped [0, 100] → `00`–`C8`
- Hex → percent: `Math.round(hex / 2)`
- `FF` (128%) = "no target" (e.g. stop response, first-ever command)

### Angle (slat tilt) encoding

- Midpoint: `7F` = 0°
- Range: ~`34` (52, = −75°) to ~`CA` (202, = +75°)
- Formula: `angleDeg = (parseInt(hex, 16) - 127) / 75 × 100`
- Hex from degrees: `Math.round(percent / 100 × 75 + 127)`, clamped [−75, +75]

---

## 7071 — Move Response

Broadcast from device after processing a 7070 command. Carries the **previous
target** parameters (not current device state).

```
rXXXXXX7071<10-char-header>PPWWV1V2<8-char-trailer>
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Device serial |
| 7–10   | 4   | Msg Type | Always `7071` |
| 11–20  | 10  | Header | Unknown (observed: `0010023F02` / `0010023D02`) |
| 21–22  | 2   | PP    | Previous target position (`00`–`C8`; `FF` = none) |
| 23–24  | 2   | WW    | Previous target angle (`34`–`CA`; `FF` = none) |
| 25–26  | 2   | V1    | Previous valance 1 (`FF` = none) |
| 27–28  | 2   | V2    | Previous valance 2 (`FF` = none) |
| 29–36  | 8   | Trailer | Unknown (observed: `FFFF0C0DFFFF`) |

---

## 8010 — Parameter Get

Request a parameter from a device.

```
{R06XXXXXX801001000005}
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | `{`   | Frame start |
| 1–3    | 3   | Prefix | Always `R06` |
| 4–9    | 6   | Serial | Device serial |
| 10–13  | 4   | Msg Type | Always `8010` |
| 14–21  | 8   | Param ID | Parameter identifier (hex) |
| 22     | 1   | `}`   | Frame end |

**Known parameter IDs**:

| Param ID | Description |
|----------|-------------|
| `01000003` | Position status (with inclination and valance) |
| `01000005` | Position status (alternative) |
| `0C000006` | Auto modes & limits (wind, rain, sun, dusk thresholds) |
| `26000046` | Clock / timer settings |

---

## 8011 — Status Response

Broadcast from device with current parameter values.

### Position status (param `01000003` / `01000005`)

```
rAAAAAA801101000003PPWWV1V2MM
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Device serial |
| 7–10   | 4   | Msg Type | Always `8011` |
| 11–18  | 8   | Param ID | `01000003` or `01000005` |
| 19–20  | 2   | PP    | Current position (`00`–`C8` = 0–100%) |
| 21–22  | 2   | WW    | Current slat angle (`34`–`CA`; `FF` = none) |
| 23–24  | 2   | V1    | Valance 1 (`FF` = none) |
| 25–26  | 2   | V2    | Valance 2 (`FF` = none) |
| 27–28  | 2   | MM    | Moving flag (`00` = stopped, non-00 = moving) |

### Auto modes & limits (param `0C000006`)

```
rAAAAAA80110C000006<wind><rain><sun><dusk><op><FF>
```

(Fields are 2 hex chars each; exact layout from Thauer, not validated.)

### Clock / timer (param `26000046`)

```
rAAAAAA801126000046<...>
```

(Format not decoded in Thauer code.)

---

## 8020 — Clock / Calendar Data

Broadcast containing clock or calendar information.

```
rAAAAAA80200B080009<year><month><day><hour><min><sec><dow><unknown>
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Device serial |
| 7–10   | 4   | Msg Type | Always `8020` |
| 11–12  | 2   | `0B`  | Header? |
| 13–14  | 2   | `08`  | Header? |
| 15–16  | 2   | `00`  | Header? |
| 17–18  | 2   | `09`  | Payload length? |
| 19–20  | 2   | year  | Year (hex, e.g. `1A` = 26) |
| 21–22  | 2   | month | Month (hex, e.g. `07` = July) |
| 23–24  | 2   | day   | Day (hex) |
| 25–26  | 2   | hour  | Hour (hex) |
| 27–28  | 2   | min   | Minute (hex) |
| 29–30  | 2   | sec   | Second (hex) |
| 31–32  | 2   | dow   | Day of week (hex, 1–7) |
| 33+    | —   | —     | Unknown remainder |

---

## 50AC — Acknowledgment

Device-level acknowledgment frame (distinct from stick-level `{a}`).

```
rAAAAAA50AC<4-hex-unknown>
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | Type  | Always `r` |
| 1–6    | 6   | Serial | Device serial |
| 7–10   | 4   | Msg Type | Always `50AC` |
| 11–14  | 4   | Unknown | Context-dependent |

Sent in response to `{R21<snr>50AC}` or as implicit reply to wave/scan.

---

## R21 — Acknowledgment Request

Command sent to device to request an explicit ack.

```
{R21XXXXXX50AC}
```

| Offset | Len | Field | Description |
|--------|-----|-------|-------------|
| 0      | 1   | `{`   | Frame start |
| 1–3    | 3   | Prefix | Always `R21` |
| 4–9    | 6   | Serial | Device serial |
| 10–13  | 4   | Msg Type | Always `50AC` |
| 14     | 1   | `}`   | Frame end |

---

## Stick Control Commands

Control commands sent to the stick itself (not forwarded to devices).

### Get name

- Request: `{G}`
- Response: `{g<name>}` — name string

### Get version

- Request: `{V}`
- Response: `{v<version>}` — version string (may have leading/trailing spaces)

### Set network parameters

- Request: `{M%<channel><panId>}` or `{M % CC PPPP}` (both work)
  - `%` = enable broadcast reception (`#` to disable)
  - Channel: `11`–`26`
  - PAN ID: `0000`–`FFFF`
- Response: `{a}` / `{f}`

### Set encryption key

- Request: `{K401<32-hex-char-key>}` or `{K 401 <key>}` (both work)
  - 32 hex chars = 16 bytes
- Response: `{a}` / `{f}`

---

## Serial Number Byte Order

WMS serial numbers are transmitted byte-reversed (little-endian in frame):

```
decimal: 636300
hex:     09B5EC
frame:   ECB509
```

Decoding: split frame hex into bytes, reverse array, join, parse int.
