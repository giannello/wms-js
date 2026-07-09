export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
} as const

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

const levelNames: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  silent: LogLevel.SILENT,
}

function parseLevel(): LogLevel {
  if (typeof process !== "undefined" && process.env?.WMS_LOG_LEVEL) {
    const n = levelNames[process.env.WMS_LOG_LEVEL.toLowerCase()]
    if (n !== undefined) return n
  }
  return LogLevel.INFO
}

let currentLevel = parseLevel()

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

const label = (level: LogLevel): string => {
  switch (level) {
    case LogLevel.DEBUG: return "DBG"
    case LogLevel.INFO: return "INF"
    case LogLevel.WARN: return "WRN"
    case LogLevel.ERROR: return "ERR"
    default: return "???"
  }
}

const timestamp = (): string => new Date().toISOString()

export function log(level: LogLevel, tag: string, message: string, ...rest: unknown[]): void {
  if (level < currentLevel) return
  const fn = level >= LogLevel.ERROR ? console.error
    : level >= LogLevel.WARN ? console.warn
    : console.log
  fn(`[${timestamp()}] [${label(level)}] [${tag}] ${message}`, ...rest)
}

export function debug(tag: string, message: string, ...rest: unknown[]): void {
  log(LogLevel.DEBUG, tag, message, ...rest)
}

export function info(tag: string, message: string, ...rest: unknown[]): void {
  log(LogLevel.INFO, tag, message, ...rest)
}

export function warn(tag: string, message: string, ...rest: unknown[]): void {
  log(LogLevel.WARN, tag, message, ...rest)
}

export function error(tag: string, message: string, ...rest: unknown[]): void {
  log(LogLevel.ERROR, tag, message, ...rest)
}
