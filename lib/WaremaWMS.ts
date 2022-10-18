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

    async configureNetwork(channel: number, panId: string): Promise<boolean> {
        if (channel < 11 || channel > 26) {
            throw new Error('Channel should be between 11 and 26')
        }
        if (!/^([0-9A-F]{1,4})$/i.test(panId)) {
            throw new Error('panId should be a valid HEX betwen 0000 and FFFF')
        }
        return this.frameHandler.send({
            frameType: WaremaWMSFrameHandler.FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST,
            payload: {
                channel,
                panId
            }
        })
            .then(() => true)
            .catch(() => false);
    }

    async configureEncryptionKey(encryptionKey: string): Promise<boolean> {
        if (!/^([0-9A-F]{32})$/i.test(encryptionKey)) {
            throw new Error('encryptionKey should be a valid 32-character HEX string')
        }
        return this.frameHandler.send({
            frameType: WaremaWMSFrameHandler.FRAME_TYPE_ENCRYPTION_CONFIGURATION_REQUEST,
            payload: {
                encryptionKey
            }
        })
            .then(() => true)
            .catch(() => false);
    }
}

export default WaremaWMS;
