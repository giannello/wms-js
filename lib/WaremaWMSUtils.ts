class WaremaWMSUtils {
    static hexToDec(numberHex: string): number {
        return parseInt(numberHex, 16);
    }

    static validateSerial(serial: string): void {
        if (!/^([0-9A-F]{6})$/.test(serial)) {
            throw new Error('Invalid serial provided');
        }
    }
}

export default WaremaWMSUtils;
