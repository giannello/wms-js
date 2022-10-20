import {DelimiterParser, SerialPort} from "serialport";
import {EventEmitter, once} from 'node:events';
import {setTimeout} from "timers/promises";
import type {
    WaremaWMSFrameAck,
    WaremaWMSFrameName,
    WaremaWMSFrameVersion,
    WaremaWMSMessageAck,
    WaremaWMSMessageBroadcastNetworkParametersChange,
    WaremaWMSMessageBroadcastScan,
    WaremaWMSMessageBroadcastWeather,
    WaremaWMSMessageDeviceMoveToPosition,
    WaremaWMSMessageDeviceStatus,
} from "./WaremaWMSFrame";
import WaremaWMSUtils from "./WaremaWMSUtils.js";

interface WaremaWMSFrameHandlerOptions {
    serialPort: SerialPort
}

interface WaremaWMSFrameHandlerSendOptions {
    frameType: string,
    expectedResponse?: string
    expectAck?: boolean,
    payload?: {
        channel?: number,
        encryptionKey?: string,
        inclination?: number,
        panId?: string,
        position?: number,
        serial?: string,
    },
    timeout?: number,
}

class WaremaWMSFrameHandler extends EventEmitter {
    static readonly FRAME_DELIMITER = '}'

    static readonly FRAME_TYPE_ACK = 'a';
    static readonly FRAME_TYPE_ENCRYPTION_CONFIGURATION_REQUEST = 'K';
    static readonly FRAME_TYPE_NAME_REQUEST = 'G';
    static readonly FRAME_TYPE_NAME_RESPONSE = 'g';
    static readonly FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST = 'M';
    static readonly FRAME_TYPE_MESSAGE_REQUEST = 'R';
    static readonly FRAME_TYPE_MESSAGE_RESPONSE = 'r';
    static readonly FRAME_TYPE_VERSION_REQUEST = 'V';
    static readonly FRAME_TYPE_VERSION_RESPONSE = 'v';

    static readonly MESSAGE_TYPE_ACK = '50AC'
    static readonly MESSAGE_TYPE_BROADCAST_NETWORK_PARAMETERS_CHANGE = '5060'
    static readonly MESSAGE_TYPE_BROADCAST_WEATHER = '7080'
    static readonly MESSAGE_TYPE_DEVICE_MOVE_TO_POSITION_REQUEST = '7070'
    static readonly MESSAGE_TYPE_DEVICE_MOVE_TO_POSITION_RESPONSE = '7071'
    static readonly MESSAGE_TYPE_DEVICE_STATUS_REQUEST = '8010'
    static readonly MESSAGE_TYPE_DEVICE_STATUS_RESPONSE = '8011'
    static readonly MESSAGE_TYPE_SCAN_REQUEST = '7020'
    static readonly MESSAGE_TYPE_SCAN_RESPONSE = '7021'
    static readonly MESSAGE_TYPE_WAVE_REQUEST = '7050'

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
        let emitType = frameType;
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
            case WaremaWMSFrameHandler.FRAME_TYPE_MESSAGE_RESPONSE:
                const serial = framePayload.slice(0, 6);
                const messageType = framePayload.slice(6, 10);
                const messagePayload = framePayload.slice(10);
                emitType = messageType;
                switch (messageType) {
                    case WaremaWMSFrameHandler.MESSAGE_TYPE_ACK:
                        emitPayload = <WaremaWMSMessageAck>{}
                        break
                    case WaremaWMSFrameHandler.MESSAGE_TYPE_BROADCAST_NETWORK_PARAMETERS_CHANGE:
                        emitPayload = <WaremaWMSMessageBroadcastNetworkParametersChange>{
                            serial,
                            panId: messagePayload.slice(0, 4),
                            channel: WaremaWMSUtils.hexToDec(messagePayload.slice(6, 8)),
                        }
                        break
                    case WaremaWMSFrameHandler.MESSAGE_TYPE_BROADCAST_WEATHER:
                        // TODO: implement missing message fields
                        emitPayload = <WaremaWMSMessageBroadcastWeather>{
                            serial,
                            windSpeed: WaremaWMSUtils.hexToDec(messagePayload.slice(2, 4)),
                        }
                        break
                    case WaremaWMSFrameHandler.MESSAGE_TYPE_SCAN_REQUEST:
                        emitPayload = <WaremaWMSMessageBroadcastScan>{
                            serial,
                            panId: messagePayload.slice(0, 4),
                        }
                        break
                    case WaremaWMSFrameHandler.MESSAGE_TYPE_DEVICE_MOVE_TO_POSITION_RESPONSE:
                        // TODO: implement missing message fields
                        emitPayload = <WaremaWMSMessageDeviceMoveToPosition>{
                            serial,
                            previousTargetPosition: WaremaWMSUtils.positionHexToDec(messagePayload.slice(10, 12)),
                            previousTargetInclination: WaremaWMSUtils.inclinationHexToDec(messagePayload.slice(12, 14)),
                        }
                        break
                    case WaremaWMSFrameHandler.MESSAGE_TYPE_DEVICE_STATUS_RESPONSE:
                        // TODO: implement missing message fields
                        emitPayload = <WaremaWMSMessageDeviceStatus>{
                            serial,
                            type: messagePayload.slice(6, 8),
                            position: WaremaWMSUtils.positionHexToDec(messagePayload.slice(8, 10)),
                            inclination: WaremaWMSUtils.inclinationHexToDec(messagePayload.slice(10, 12)),
                            isMoving: WaremaWMSUtils.isMovingHexToBoolean(messagePayload.slice(16, 18)),
                        }
                        break
                    /* c8 ignore next 2 */
                    default:
                        throw new Error(`Cannot handle. Unknown message type for frame: ${frame.toString()}`);
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
            case WaremaWMSFrameHandler.FRAME_TYPE_ENCRYPTION_CONFIGURATION_REQUEST:
                const encryptionKey = payload!.encryptionKey!.toUpperCase();
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_ENCRYPTION_CONFIGURATION_REQUEST}401${encryptionKey}`;
                break;
            case WaremaWMSFrameHandler.FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST:
                const channel = payload!.channel!.toString().padStart(2, '0');
                const panId = payload!.panId!.padStart(4, '0').toUpperCase();
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_NETWORK_CONFIGURATION_REQUEST}%${channel}${panId}`;
                break;
            case WaremaWMSFrameHandler.FRAME_TYPE_VERSION_REQUEST:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_VERSION_REQUEST}`;
                break;
            case WaremaWMSFrameHandler.MESSAGE_TYPE_DEVICE_MOVE_TO_POSITION_REQUEST:
                const position = WaremaWMSUtils.positionDecToHex(payload!.position!);
                const inclination = WaremaWMSUtils.inclinationDecToHex(payload!.inclination!);
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_MESSAGE_REQUEST}06${payload!.serial!}${WaremaWMSFrameHandler.MESSAGE_TYPE_DEVICE_MOVE_TO_POSITION_REQUEST}03${position}${inclination}FFFF`;
                break;
            case WaremaWMSFrameHandler.MESSAGE_TYPE_DEVICE_STATUS_REQUEST:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_MESSAGE_REQUEST}06${payload!.serial!}${WaremaWMSFrameHandler.MESSAGE_TYPE_DEVICE_STATUS_REQUEST}01000005`;
                break;
            case WaremaWMSFrameHandler.MESSAGE_TYPE_SCAN_RESPONSE:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_MESSAGE_REQUEST}01${payload!.serial!}${WaremaWMSFrameHandler.MESSAGE_TYPE_SCAN_RESPONSE}FFFF02`;
                break;
            case WaremaWMSFrameHandler.MESSAGE_TYPE_WAVE_REQUEST:
                frame = `${WaremaWMSFrameHandler.FRAME_TYPE_MESSAGE_REQUEST}06${payload!.serial!}${WaremaWMSFrameHandler.MESSAGE_TYPE_WAVE_REQUEST}`;
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
