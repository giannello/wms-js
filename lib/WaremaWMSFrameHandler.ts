import {DelimiterParser, SerialPort} from "serialport";
import {EventEmitter, once} from 'node:events';
import {setTimeout} from "timers/promises";
import type {WaremaWMSFrameName} from "./WaremaWMSFrame";

interface WaremaWMSFrameHandlerOptions {
    serialPort: SerialPort
}

interface WaremaWMSFrameHandlerSendOptions {
    frameType: string,
    expectedResponse?: string
    expectAck?: boolean,
    timeout?: number,
}

class WaremaWMSFrameHandler extends EventEmitter {
    static readonly FRAME_DELIMITER = '}'

    static readonly FRAME_TYPE_ACK = 'a';
    static readonly FRAME_TYPE_NAME_REQUEST = 'G';
    static readonly FRAME_TYPE_NAME_RESPONSE = 'g';

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
            case WaremaWMSFrameHandler.FRAME_TYPE_NAME_RESPONSE:
                emitPayload = <WaremaWMSFrameName>{
                    name: framePayload
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
                   expectAck = true,
                   timeout = 1000
               }: WaremaWMSFrameHandlerSendOptions) {
        // Create and send frame
        let frame;
        switch (frameType) {
            case WaremaWMSFrameHandler.FRAME_TYPE_NAME_REQUEST:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_NAME_REQUEST}`;
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
