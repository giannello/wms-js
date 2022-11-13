export interface WaremaWMSFrame {
}

export interface WaremaWMSFrameAck extends WaremaWMSFrame {
}

export interface WaremaWMSFrameName extends WaremaWMSFrame {
    name: string
}

export interface WaremaWMSFrameVersion extends WaremaWMSFrame {
    version: string
}

export interface WaremaWMSMessage {
    serial: string
}

export interface WaremaWMSMessageAck extends WaremaWMSMessage {
}

export interface WaremaWMSMessageBroadcastNetworkParametersChange extends WaremaWMSMessage {
    channel: number
    panId: string
}

export interface WaremaWMSMessageBroadcastScan extends WaremaWMSMessage {
    panId: string
}

export interface WaremaWMSMessageBroadcastScanResponse extends WaremaWMSMessage {
    panId: string
    deviceType: number
}

export interface WaremaWMSMessageBroadcastWeather extends WaremaWMSMessage {
    windSpeed: number
}

export interface WaremaWMSMessageDeviceStatus extends WaremaWMSMessage {
    type: string
    position: number
    inclination: number
    isMoving: boolean
}

export interface WaremaWMSMessageDeviceMoveToPosition extends WaremaWMSMessage {
    type: string
    previousTargetPosition: number
    previousTargetInclination: number
}

export interface WaremaWMSMessageNetworkJoin extends WaremaWMSMessageBroadcastNetworkParametersChange {
    encryptionKey: string
}

export interface WaremaWMSMessageWaveRequest extends WaremaWMSMessage {
}
