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
                const panId = framePayload.substring(12, 16);

                // Simulate stick and network timeout
                if (serial === 'DEAD01' || (messageType === '7020' && panId === 'DED1')) {
                    return;
                }
                this.mockedPort.port?.emitData(`{a}`);
                if (serial === 'DEAD02') {
                    return;
                }
                const requestCombination = [requestType, messageType, serial].join('-');
                switch (requestCombination) {
                    case '04-7020-FFFFFF':
                        break;
                    case '06-7050-ABCDEF':
                    case '01-7021-ABCDEF':
                        response = 'rABCDEF50ACABCD'
                        break;
                    case '06-7070-ABCDEF':
                        response = 'rABCDEF70710010023F02007FFFFF0C0DFFFF'
                        break;
                    case '06-7070-FEDCBA':
                        response = 'rFEDCBA70710010023F02C87FFFFF0C0DFFFF'
                        break;
                    case '06-8010-ABCDEF':
                        response = 'rABCDEF801101000003007FFFFF00'
                        break;
                    case '06-8010-FEDCBA':
                        response = 'rFEDCBA801101000003C87FFFFF01'
                        break;
                    default:
                        throw new Error(`Unhandled message combination: ${requestCombination}`);
                }
                break;
            default:
                throw new Error(`Unhandled frame type: ${frameType}`);
        }
        if (response) {
            this.mockedPort.port?.emitData(`{${response}}`);
        }
    }

    mockNetworkJoin(serial: string, channel: string, panId: string, encryptionKey: string): void {
        this.mockedPort.port?.emitData(`{r${serial}5018${panId}${encryptionKey}FF${channel}}`);
    }

    mockNetworkParametersChangeBroadcast(serial: string, channel: string, panId: string): void {
        this.mockedPort.port?.emitData(`{r${serial}5060${panId}02${channel}00}`);
    }

    mockReceivedScanRequest(serial: string, panId: string): void {
        this.mockedPort.port?.emitData(`{r${serial}7020${panId}02}`);
    }

    mockReceivedWaveRequest(serial: string): void {
        this.mockedPort.port?.emitData(`{r${serial}7050}`);
    }

    mockWeatherBroadcast(serial: string, windSpeed: string): void {
        this.mockedPort.port?.emitData(`{r${serial}7080FF${windSpeed}FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF}`);
    }

    mockReceivedScanResponse(serial: string, deviceType: number, panId: string): void {
        this.mockedPort.port?.emitData(`{r${serial}7021${panId}${deviceType}8C2F000300000000000000000A04000100C1000000000000}`);
    }
}

export default WaremaWMSMock;
