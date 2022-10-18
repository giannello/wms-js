import type {SerialPort} from "serialport";
import WaremaWMSFrameHandler from "./WaremaWMSFrameHandler.js";

class WaremaWMS {
    readonly frameHandler;

    constructor(serialPort: SerialPort) {
        this.frameHandler = new WaremaWMSFrameHandler({serialPort});
    }

    /* c8 ignore next 3 */
    disconnect(): void {
        this.frameHandler.serialPort.close();
    }
}

export default WaremaWMS;
