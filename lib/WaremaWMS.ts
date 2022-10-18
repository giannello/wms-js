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

    async getName(): Promise<string> {
        return this.frameHandler.send({
            frameType: WaremaWMSFrameHandler.FRAME_TYPE_NAME_REQUEST,
            expectAck: false,
            expectedResponse: WaremaWMSFrameHandler.FRAME_TYPE_NAME_RESPONSE
        })
            .then((res) => res.name)
            .catch(() => new Error('Failed to get the stick name'));
    }

    async getVersion(): Promise<string> {
        return this.frameHandler.send({
            frameType: WaremaWMSFrameHandler.FRAME_TYPE_VERSION_REQUEST,
            expectAck: false,
            expectedResponse: WaremaWMSFrameHandler.FRAME_TYPE_VERSION_RESPONSE
        })
            .then((res) => res.version)
            .catch(() => new Error('Failed to get the stick version'));
    }
}

export default WaremaWMS;
