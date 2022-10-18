# WMS-JS

A JavaScript interface to a [Warema WMS network](https://www.warema.com/en/control-systems/radio-systems/) using a
[Warema WMS Stick](https://warema.com/en/control-systems/radio-systems/supplementary-components/).

## Usage

```typescript
import {SerialPort} from "serialport";
import WaremaWMS from "./lib/WaremaWMS.js";

const port = new SerialPort({
    path: '/dev/ttyUSB0',
    baudRate: 128000,
})

const wms = new WaremaWMS(port);
console.log(wms.getName());
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
