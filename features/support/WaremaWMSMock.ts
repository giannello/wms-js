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
        let response;
        switch (frameType) {
            case 'G':
                response = 'gMock WMS USB-Stick';
                break;
            default:
                throw new Error(`Unhandled frame type: ${frameType}`);
        }
        this.mockedPort.port?.emitData(`{${response}}`);
    }
}

export default WaremaWMSMock;
