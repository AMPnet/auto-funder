const path = require('path')
const { createLogger, format, transports } = require('winston')
const { combine, timestamp, splat, printf } = format
const DailyRotateFile = require('winston-daily-rotate-file')

const config = require('../config')
const enums = require('../enums')
 
const mainLogger = createLogger({
    level: 'debug',
    format: combine(
        timestamp(),
        splat(),
        printf(info => `${info.timestamp} ${info.level}: [${info.callingModule}] ${info.message}`)
    ),
    transports: getTransports()
})

function getFilenameLabel(callingModule) {
    var parts = callingModule.filename.split(path.sep)
    let result = path.join(parts[parts.length - 2], parts.pop())
    return result
}

function getTransports() {
    let loggerTransports = [
        new transports.Console({
            level: 'info',
        })
    ]
    if (config.env === enums.ServiceEnv.PROD) {
        loggerTransports.push(new DailyRotateFile({
            filename: 'auto-funder-%DATE%.log',
            dirname: '/var/log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '7d',
            level: 'info'
        }))
        loggerTransports.push(new DailyRotateFile({
            filename: 'auto-funder-%DATE%-DEBUG.log',
            dirname: '/var/log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '7d',
            level: 'debug'
        }))
    }
    return loggerTransports
}

module.exports = function(mod) {
    if (!mod) {
        throw new Error('Must provide calling module param when requiring logger!')
    }
    let callingModule = getFilenameLabel(mod)
    return mainLogger.child({ callingModule })
}