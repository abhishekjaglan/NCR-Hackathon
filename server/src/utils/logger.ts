import { createLogger, format, transports } from "winston";
const { combine, timestamp, printf, colorize, simple, label } = format;

const myFormat = printf(({ label, level, message, timestamp }) => {
    return `${label} - ${timestamp} - ${level}: ${message}`;
});

export const logger = createLogger({
    level: 'info',
    format: combine(
        colorize(),
        simple(),
        label({ label: 'catm-arcs-fccs-aim' }),
        // timestamp({ format: 'HH:mm:ss'}),
        timestamp(),
        myFormat
    ),
    transports: [
        //
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `combined.log`
        //
        new transports.Console(),
        new transports.File({ filename: 'logs/combined.log' }),
        new transports.File({ filename: 'logs/error.log', level: 'error' }),
    ],
    exceptionHandlers: [
        new transports.File({ filename: 'logs/exceptions.log' }),
    ],
    exitOnError: false,
});