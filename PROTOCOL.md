# Protocol

Frame format: content is wrapped in `{` and `}`. Anything outside braces is ignored.

## Name

Ask the stick for its device name.

- Request: `{G}`
- Response: `{g<name>}` — response type `g` followed by the device name

## Version

Ask the stick for its firmware version.

- Request: `{V}`
- Response: `{v<version>}` — response type `v` followed by the version string
- Note: version may contain leading/trailing spaces; trim before use

## Network Parameters

Configure the radio's network parameters.

- Request: `{M X CC PPPP}`
  - `X`: `%` (receive broadcasts) or `#` (don't)
  - `CC`: channel number, `11`–`26`
  - `PPPP`: PAN ID, `0000`–`FFFF`, uppercase hex
- Response: `{a}` — success
- Failure: `{f}`

## Encryption Key

Set the network encryption key.

- Request: `{K 401 XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX}`
  - `Xs`: 32-character uppercase hex string
- Response: `{a}` — success
- Failure: `{f}`

## Network Parameter Broadcast

Broadcast from a remote in pairing mode. When the "L" button is pressed on a
remote, it scans the network and emits its current network configuration.

```
rXXXXXX5060PPPP02CC00
```

| Pos   | Len | Field     | Description                     |
|-------|-----|-----------|---------------------------------|
| 0     | 1   | Type      | Always `r`                      |
| 1–6   | 6   | Serial    | Remote serial number            |
| 7–10  | 4   | Msg Type  | Always `5060`                   |
| 11–14 | 4   | PAN ID    | Network PAN ID (hex)            |
| 15–16 | 2   | `02`      | Constant                        |
| 17–18 | 2   | Channel   | Channel (hex: `0B`–`1A`)        |
| 19–20 | 2   | `00`      | Trailing constant               |

## Device Scan Query

Broadcast from a remote when it scans for devices (e.g. after pressing the L
button). The stick must answer with a scan response.

### Query

```
rXXXXXX7020PPPP02
```

| Pos   | Len | Field     | Description                     |
|-------|-----|-----------|---------------------------------|
| 0     | 1   | Type      | Always `r`                      |
| 1–6   | 6   | Serial    | Remote serial number            |
| 7–10  | 4   | Msg Type  | Always `7020`                   |
| 11–14 | 4   | PAN ID    | Network PAN ID (hex)            |
| 15–16 | 2   | `02`      | Constant                        |

### Response

Stick responds to a scan query. Always uses `FFFF` as the PAN ID.

```
R01XXXXXX7021FFFF02
```

| Pos   | Len | Field     | Description                     |
|-------|-----|-----------|---------------------------------|
| 0–2   | 3   | Type      | Always `R01`                    |
| 3–8   | 6   | Serial    | Remote serial (echoed)          |
| 9–12  | 4   | Msg Type  | Always `7021`                   |
| 13–16 | 4   | PAN ID    | Always `FFFF` (hardcoded)       |
| 17–18 | 2   | `02`      | Constant                        |

## Wave Request

Sent by a remote to ask the stick to "wave" — used during key exchange pairing. The
stick only logs this; no response needed.

```
rXXXXXX7050
```

| Pos   | Len | Field     | Description                     |
|-------|-----|-----------|---------------------------------|
| 0     | 1   | Type      | Always `r`                      |
| 1–6   | 6   | Serial    | Remote serial number            |
| 7–10  | 4   | Msg Type  | Always `7050`                   |

## Network Join Request

Sent by a remote (after STOP button press) to share its network key with the
stick. The stick should log the data and shut down cleanly.

```
rXXXXXX5018PPPPKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKFFCC
```

| Pos   | Len | Field     | Description                         |
|-------|-----|-----------|-------------------------------------|
| 0     | 1   | Type      | Always `r`                          |
| 1–6   | 6   | Serial    | Remote serial number                |
| 7–10  | 4   | Msg Type  | Always `5018`                       |
| 11–14 | 4   | PAN ID    | Network PAN ID (hex)                |
| 15–46 | 32  | Key       | Encryption key (32 hex chars = 16 bytes), byte‑reversed
(little‑endian order in frame, e.g. frame `0102...0F10` → key `100F...0201`) |
| 47–48 | 2   | `FF`      | Constant                            |
| 49–50 | 2   | Channel   | Radio channel (hex, 11–26 decimal)  |

## Weather Station Broadcast

Unsolicited broadcast from a weather station. Frame type `r`, message type `7080`.

```
rSSSSSS7080YYWWL1AAAAAAL2RRxxTTyyyy
```

| Pos   | Len | Field          | Description                        |
|-------|-----|----------------|------------------------------------|
| 0     | 1   | Type           | Always `r`                         |
| 1–6   | 6   | Serial Number  | 6-digit serial, zero-padded        |
| 7–10  | 4   | Message Type   | Always `7080`                      |
| 11–12 | 2   | YY             | Unknown                            |
| 13–14 | 2   | WW             | Wind speed (hex), 0–255            |
| 15+   | —   | Remainder      | Additional fields (L1, A, L2, ...) |
