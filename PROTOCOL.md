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
