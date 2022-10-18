import {SerialPortMock} from "serialport";

class WaremaWMSMock {
    readonly mockedPort: SerialPortMock;
    readonly path: string;

    timer: NodeJS.Timeout;

    static readonly SERIAL_PORT_BAUD_RATE = 128000;

    constructor() {
        this.path = `/dev/ttyMOCK${process.env['CUCUMBER_WORKER_ID']}`;
        SerialPortMock.binding.createPort(this.path);
        this.mockedPort = new SerialPortMock({
            path: this.path,
            baudRate: WaremaWMSMock.SERIAL_PORT_BAUD_RATE
        });
        this.timer = setInterval(() => {
            this.mockResponse()
        }, 50);
    }

    getMockPort(): SerialPortMock {
        return this.mockedPort;
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
    }

    mockResponse(): void {
        const receivedFrame = this.mockedPort.port?.lastWrite?.toString();
        if (!receivedFrame) {
            return
        }
        const frameType = receivedFrame.slice(1, 2);
        const framePayload = receivedFrame.slice(2, -1);
        let response;
        switch (frameType) {
            case 'G':
                response = 'gMock WMS USB-Stick';
                break;
            case 'K':
            case 'M':
                response = 'a';
                break;
            case 'V':
                response = 'v12345678   ';
                break;
            case 'R':
                const requestType = framePayload.substring(0, 2);
                const serial = framePayload.substring(2, 8);
                const messageType = framePayload.substring(8, 12);

                // Simulate stick and network timeout
                if (serial === 'DEAD01') {
                    return;
                }
                this.mockedPort.port?.emitData(`{a}`);
                if (serial === 'DEAD02') {
                    return;
                }
                const requestCombination = [requestType, messageType, serial].join('-');
                switch (requestCombination) {
                    case '06-7050-ABCDEF':
                        response = 'rABCDEF50ACABCD'
                        break;
                    default:
                        throw new Error(`Unhandled message combination: ${requestCombination}`);
                }
                break;
            default:
                throw new Error(`Unhandled frame type: ${frameType}`);
        }
        this.mockedPort.port?.emitData(`{${response}}`);
    }

    mockWeatherBroadcast(serial: string, windSpeed: string): void {
        this.mockedPort.port?.emitData(`{r${serial}7080FF${windSpeed}FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF}`);
    }
}

export default WaremaWMSMock;
