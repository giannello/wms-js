class WaremaWMSUtils {
    static hexToDec(numberHex: string): number {
        return parseInt(numberHex, 16);
    }

    static inclinationDecToHex(inclinationDec: number): string {
        return (inclinationDec + 127).toString(16).toUpperCase().padStart(2, '0');
    }

    static inclinationHexToDec(inclinationHex: string): number {
        return parseInt(inclinationHex, 16) - 127;
    }

    static isMovingHexToBoolean(isMovingHex: string): boolean {
        return Boolean(parseInt(isMovingHex, 16));
    }

    static positionDecToHex(positionDec: number): string {
        return (positionDec * 2).toString(16).toUpperCase().padStart(2, '0');
    }

    static positionHexToDec(positionHex: string): number {
        return parseInt(positionHex, 16) / 2;
    }

    static reverseHex(string: string): string {
        return string.match(/../g)!.reverse().join('');
    }

    static validateSerial(serial: string): void {
        if (!/^([0-9A-F]{6})$/.test(serial)) {
            throw new Error('Invalid serial provided');
        }
    }
}

export default WaremaWMSUtils;
