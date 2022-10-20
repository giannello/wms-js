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

export interface WaremaWMSMessageBroadcastWeather extends WaremaWMSMessage {
    windSpeed: number
}

export interface WaremaWMSMessageDeviceStatus extends WaremaWMSMessage {
    type: string
    position: number
    inclination: number
    isMoving: boolean
}
