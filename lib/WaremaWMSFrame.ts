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

export interface WaremaWMSMessageBroadcastWeather extends WaremaWMSMessage {
    windSpeed: number
}
