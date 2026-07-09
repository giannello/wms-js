# Frame Decode Issues (from Thauer Reference Analysis)

Discrepancies found by comparing our implementation against
[thauer/warema-wms-api](https://github.com/thauer/warema-wms-api)
(`lib/wms-vb-wmsutil.js`, `lib/wms-vb-stick.js`).

See also:
- `docs/thauer-protocol-reference.md` — full frame format reference
- `docs/comparison-with-thauer-wms-api.md` — implementation comparison

---

## 1. Rain flag offset in 7080 weather station frames

We check position 25–26 (`RR` field). Thauer says rain flag (`C8` = raining)
is at position 27–28 (`xx` field).

| Source | Pos 25–26 | Pos 27–28 |
|--------|-----------|-----------|
| Us     | Rain (`C8`) | (not read) |
| Thauer | RR (unknown) | xx (rain flag) |

**File**: `packages/lib/src/parsers/weather-station.ts:18`
```typescript
rain: frame.slice(25, 27) === "C8",   // BUG: should be slice(27, 29)?
```

**Risk**: The Thauer field labels here are marked alpha ("no real device
validation") — RR and xx could be swapped in the reference. Fix only after
validating against real hardware.

---

## 2. Stop command truncated

Both implementations send `R06<snr>707001` (13 chars) but Thauer sends
`R06<snr>707001FFFFFF00` (24 chars — includes FF placeholders for
position, angle, valance 1, valance 2, and a trailing `00`).

| Source | Stop command |
|--------|-------------|
| Us     | `R06ABCDEF707001` |
| Thauer | `R06ABCDEF707001FFFFFF00` |

**Fiels**:
- `packages/lib/src/commands/name.ts:240`
- `packages/lib/src/network/manager.ts:181`

**Fix**: Append `FFFFFF00` to both `stopDevice()` commands.

---

## 3. Valance bytes: 0000 vs FFFF

`Commands.moveToPosition` uses `0000` (valance at 0%) while
`NetworkManager.moveToPosition` uses `FFFF` (omit valance). Thauer
specifies `FFFF` = omit.

| Source | Valance bytes |
|--------|--------------|
| `Commands.moveToPosition` | `0000` |
| `NetworkManager.moveToPosition` | `FFFF` |
| Thauer | `FFFF` |

**File**: `packages/lib/src/commands/name.ts:259`

**Fix**: Change `0000` to `FFFF` to match `NetworkManager` and Thauer.

---

## 4. "deviceType" in 8011 parser is actually param ID suffix

We parse positions 17–18 as `deviceType`. This is actually the **last two
hex digits of the 8-character parameter ID** (`01000003` or `01000005`).
The values `03` / `05` are not valid device types from the Thauer table.

Thauer's actual 8011 frame layout:
```
rAAAAAA801101000003PPWWV1V2MM
              ^^^^^^^^
              param ID: 01000003
                        ^^
                        tail = "03" (what we call "deviceType")
```

Our parser layout:
```
rAAAAAA8011<6-pad><deviceType><pos><incl><v1><v2><moving>
            ^^^^^^  ^^^^^^^^^^^^
            pad     = this is actually the first 6 chars of param ID
                    = this is the last 2 chars of param ID
```

**File**: `packages/lib/src/parsers/device-status.ts:18-36`

**Impact**: The UI displays device type names based on this field
(`home.tsx` uses `d.deviceTypeName`). Since the value is always `03`
or `05`, device type labels are always wrong for real devices.

**Fix options**:
1. Rename the field to clarify it's a param suffix (not a device type)
2. Remove device type display from the UI for 8011 frames
3. If possible, derive device type from other frame data (e.g. 7021)

---

## 5. Angle encoding: missing clamp

Both implementations use `Math.round(inclination + 127)` without clamping.
Thauer specifies clamping to the range [−75, +75] (device-native units)
before encoding.

**Fiels**:
- `packages/lib/src/commands/name.ts:258`
- `packages/lib/src/network/manager.ts:152`

**Fix**: Add clamping: `Math.min(75, Math.max(-75, inclination))` before
adding 127.

---

## 6. Serial number byte order

Thauer decodes serial numbers as big-endian, byte-reversed in the frame:
```
decimal: 636300
hex:     09B5EC
frame:   ECB509
```

We treat the frame-order bytes (`ECB509`) as the canonical serial. This is
internally consistent but differs from any external tool using Thauer's
convention.

**Files**: Every parser that reads `frame.slice(1, 7)` — all parsers.

**Note**: Only relevant if serial numbers need to match external tools.
No urgency — our convention works within our ecosystem.

---

## 7. Feature gaps (no code issue, just missing)

| Gap | Description | Thauer format |
|-----|-------------|---------------|
| No 8020 parser | Clock/calendar broadcast silently ignored | `rAAAAAA80200B080009<ymd>...` |
| No R21 ack request | Device-level acknowledgment never sent | `{R21<snr>50AC}` |
| Only `01000005` param ID | `01000003` variant not tested | `rAAAAAA801101000003PPWWV1V2MM` |

---

## Recommendations (priority order)

1. **Validate rain offset** with real hardware before fixing
2. **Fix stop command** — add `FFFFFF00` suffix
3. **Fix valance bytes** — `0000` → `FFFF` in `Commands`
4. **Fix device type** — rename field, update UI
5. **Add angle clamp** — safety guard
6. **Decide on serial convention** — document if keeping frame-order
