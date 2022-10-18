import {DelimiterParser, SerialPort} from "serialport";
import {EventEmitter, once} from 'node:events';
import {setTimeout} from "timers/promises";
import type {WaremaWMSFrameAck, WaremaWMSFrameName, WaremaWMSFrameVersion} from "./WaremaWMSFrame";

interface WaremaWMSFrameHandlerOptions {
    serialPort: SerialPort
}

interface WaremaWMSFrameHandlerSendOptions {
    frameType: string,
    expectedResponse?: string
    expectAck?: boolean,
    payload?: {
        channel?: number,
        panId?: string,
    },
    timeout?: number,
}

class WaremaWMSFrameHandler extends EventEmitter {
    static readonly FRAME_DELIMITER = '}'

    static readonly FRAME_TYPE_ACK = 'a';
    static readonly FRAME_TYPE_NAME_REQUEST = 'G';
    static readonly FRAME_TYPE_NAME_RESPONSE = 'g';
    static readonly FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST = 'M';
    static readonly FRAME_TYPE_VERSION_REQUEST = 'V';
    static readonly FRAME_TYPE_VERSION_RESPONSE = 'v';

    readonly serialPort;

    constructor({serialPort}: WaremaWMSFrameHandlerOptions) {
        super();
        this.serialPort = serialPort;

        const parser = this.serialPort.pipe(
            new DelimiterParser({
                delimiter: WaremaWMSFrameHandler.FRAME_DELIMITER,
                includeDelimiter: true
            })
        );

        parser.on('data', async (frame) => {
            await this.handle(frame.toString());
        })
    }

    async handle(frame: string): Promise<void> {
        // Validate frames
        /* c8 ignore next 3 */
        if (!frame.startsWith('{') || !frame.endsWith('}')) {
            return;
        }
        // Parse the frame, split `type` and `payload`
        const frameType = frame.slice(1, 2);
        const framePayload = frame.slice(2, -1);
        const emitType = frameType;
        let emitPayload = {};
        switch (frameType) {
            case WaremaWMSFrameHandler.FRAME_TYPE_ACK:
                emitPayload = <WaremaWMSFrameAck>{}
                break;
            case WaremaWMSFrameHandler.FRAME_TYPE_NAME_RESPONSE:
                emitPayload = <WaremaWMSFrameName>{
                    name: framePayload
                }
                break;
            case WaremaWMSFrameHandler.FRAME_TYPE_VERSION_RESPONSE:
                emitPayload = <WaremaWMSFrameVersion>{
                    version: framePayload.trim()
                }
                break;
            /* c8 ignore next 2 */
            default:
                throw new Error(`Cannot handle. Unknown frame type for frame: ${frame.toString()}`);
        }
        this.emit(emitType, emitPayload);
    }

    async send({
                   frameType,
                   expectedResponse,
                   payload = {},
                   expectAck = true,
                   timeout = 1000
               }: WaremaWMSFrameHandlerSendOptions) {
        // Create and send frame
        let frame;
        switch (frameType) {
            case WaremaWMSFrameHandler.FRAME_TYPE_NAME_REQUEST:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_NAME_REQUEST}`;
                break;
            case WaremaWMSFrameHandler.FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST:
                const channel = payload!.channel!.toString().padStart(2, '0');
                const panId = payload!.panId!.padStart(4, '0');
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST}%${channel}${panId}`;
                break;
            case WaremaWMSFrameHandler.FRAME_TYPE_VERSION_REQUEST:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_VERSION_REQUEST}`;
                break;
            /* c8 ignore next 2 */
            default:
                throw new Error(`Cannot create frame. Unknown frame type: ${frameType}`);
        }
        this.serialPort.write(`{${frame}}`);

        // Handle response
        let controller: AbortController;
        if (expectAck) {
            controller = new AbortController();
            await Promise.race([
                once(this, WaremaWMSFrameHandler.FRAME_TYPE_ACK).then(() => {
                    controller.abort();
                }),
                /* c8 ignore next 3 */
                setTimeout(timeout, false, {signal: controller.signal}).then(() => {
                    return Promise.reject(new Error('Timeout waiting for ACK'))
                }),
            ]);
        }
        if (expectedResponse) {
            controller = new AbortController();
            return Promise.race([
                once(this, expectedResponse).then(([response]) => {
                    controller.abort();
                    return response;
                }),
                setTimeout(timeout, false, {signal: controller.signal}).then(() => {
                    return Promise.reject(new Error('Timeout waiting for response'))
                }),
            ]);
        }
    }
}

export default WaremaWMSFrameHandler;
