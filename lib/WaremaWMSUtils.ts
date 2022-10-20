class WaremaWMSUtils {
    static hexToDec(numberHex: string): number {
        return parseInt(numberHex, 16);
    }

    static inclinationHexToDec(inclinationHex: string): number {
        return parseInt(inclinationHex, 16) - 127;
    }

    static isMovingHexToBoolean(isMovingHex: string): boolean {
        return Boolean(parseInt(isMovingHex, 16));
    }

    static positionHexToDec(positionHex: string): number {
        return parseInt(positionHex, 16) / 2;
    }

    static validateSerial(serial: string): void {
        if (!/^([0-9A-F]{6})$/.test(serial)) {
            throw new Error('Invalid serial provided');
        }
    }
}

export default WaremaWMSUtils;
