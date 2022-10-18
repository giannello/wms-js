import {DelimiterParser, SerialPort} from "serialport";

interface WaremaWMSFrameHandlerOptions {
    serialPort: SerialPort
}

class WaremaWMSFrameHandler {
    static readonly FRAME_DELIMITER = '}'

    readonly serialPort;

    constructor({serialPort}: WaremaWMSFrameHandlerOptions) {
        this.serialPort = serialPort;

        const parser = this.serialPort.pipe(
            new DelimiterParser({
                delimiter: WaremaWMSFrameHandler.FRAME_DELIMITER,
                includeDelimiter: true
            })
        );

        parser.on('data', async (frame) => {
            console.log(frame.toString());
        })
    }
}

export default WaremaWMSFrameHandler;
