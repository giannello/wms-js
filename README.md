# WMS-JS

A JavaScript interface to a [Warema WMS network](https://www.warema.com/en/control-systems/radio-systems/) using a
[Warema WMS Stick](https://warema.com/en/control-systems/radio-systems/supplementary-components/).

## Usage

```typescript
import {SerialPort} from "serialport";
import WaremaWMS from "./lib/WaremaWMS.js";
import WaremaWMSFrameHandler from "./lib/WaremaWMSFrameHandler.js";

const port = new SerialPort({
    path: '/dev/ttyUSB0',
    baudRate: 128000,
})

const wms = new WaremaWMS(port);
console.log(wms.getName());
console.log(wms.getVersion());
console.log(await wms.configureNetwork(11, 'ABCD'));
console.log(await wms.configureEncryptionKey('012345678ABCDEF012345678ABCDEF01'));
wms.frameHandler.on(WaremaWMSFrameHandler.MESSAGE_TYPE_BROADCAST_WEATHER, console.log);
console.log(await wms.wave('ABCDEF'));
```

## Protocol details

The protocol has been reversed by some kind folks from
the [IoBroker forum](https://forum.iobroker.net/topic/7336/iobroker-mit-warema-wms-web-control).
Additional information is available from
the [warema-wms-venetian-blinds](https://www.npmjs.com/package/warema-wms-venetian-blinds) npm package.

The radio communication is encrypted, the USB stick takes care of all the encryption details, and provides a serial
interface that can be easily used to communicate with the WMS network.

### Frame structure

Frames are the basic unit of communication with the USB stick. Frames are enclosed in curly braces, and the first
character defines the frame type and the direction (uppercase -> host to USB, lowercase -> USB to host).

```
-> {G}
<- {gWMS USB-Stick}
-> {V}
<- {v12345678   }
-> {R01ABCDEF7021FFFF02}
<- {rABCDEF7080000010FFFFFFFAC8FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF}
```

Frames, regardless of their direction, might include a payload. The payload might contain information from the USB stick
to the host, configuration for the USB stick, or messages to/from the network.

The following frame types are known:

| Frame type | Content                                    |
|:----------:|--------------------------------------------|
|  `G`/`g`   | Stick name request/response                |
|  `V`/`v`   | Stick version request/response             |
|  `R`/`r`   | Network message request/response           |
|    `M`     | Stick network parameters configuration     |
|    `K`     | Stick network encryption key configuration |
|    `a`     | Stick ACK                                  |

##### Stick name request/response

```
-> {G}
<- {gWMS USB-Stick}
```

#### Stick version request/response

```
-> {V}
<- {v XXXXXXXX ___}
```

* `XXXXXXXX` is the version reported by the stick. It's not known whether there are multiple versions, or if it's
  possible to upgrade
* `___` are blank spaces in the response

#### Stick network parameters configuration

```
-> {M X CC PPPP}
<- {a}
```

* `X` can be either `%` or `#`, depending on whether we want to receive network broadcast messages, or not.
* `CC` is the channel number, between `11` and `26`
* `PPPP` is the PAN ID, between `0000` and `FFFF`

#### Stick network encryption key configuration

```
-> {K 401 XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX}
<- {a}
```

* `XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` 32-character, hex encryption key

#### Network message request/response

```
-> {R TT XXXXXX YYYY ZZZ[...]}
<- {r XXXXXX YYYY ZZZ[...]}
```

* `TT` is some kind of type identifier added to outgoing messages only
* `XXXXXX` is the source serial number
* `YYYY` is the message type
* `ZZZ[...]` is the message payload

### Network message structure

Messages contain data travelling between devices of the WMS network.
Messages are embedded within `R`/`r` frames, and can be of different types.

The following message types are known:

| Message type | Content                   |
|:------------:|---------------------------|
|    `50AC`    | ACK from device           |
|    `7050`    | Wave request              |
|    `7080`    | Weather station broadcast |

#### Weather station broadcast

```
<- {r XXXXXX 7080 YY WW L1 ZZZZZZ L2 xx RR TT yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy}
// the followings are actual message received from 2 different weather stations
    r ABCDEF 7080 00 00 10 FFFFFF FA C8 FF FF FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
    r ABCDEF 7080 00 01 1A FFFFFF FA C8 FF FF FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
    r ABCDEF 7080 00 00 00 FFFFFF 00 C7 FF FF FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
```

* `YY` unknown
* `WW` wind speed (hex)
* `L1` illuminance 1, needs processing
* `ZZZZZZ` unknown
* `L2` illuminance 2, needs processing
* `xx` unknown
* `RR` rain (`00` = no rain, `C8` = rain)
* `TT` temperature, needs processing
* `yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy` unknown

According to the forum, the following post-processing is needed:

* temperature: convert to dec, divide by 2, and subtract 35
* illuminance
    * if `L1` is `00`, the illuminance value is `L2`, converted to dec, multiplied by 2
    * otherwise, convert both `L1` and `L2` to dec, multiply them and then multiply by 2

Given the mismatch between the documentation and the sample messages, only wind speed is currently implemented

#### Wave request

```
-> {R06 XXXXXX 7050}
<- {a}
<- {r XXXXXX 50AC YYYY}
// real world examples
    r ABCDEF 50AC 88ED
    r ABCDEF 50AC CDD6
    r ABCDEF 50AC B043

```

* `XXXXXX` serial number of the target device
* `YYYY` unknown - changes with every request
