/*eslint no-console: "off"*/
// NPM Modules
import fs from 'fs';
import util from 'util';
import { _ } from 'lodash';

const logFile = fs.createWriteStream('../ourbitrage_logs.txt', {flags: 'a'}); // Or 'w' to truncate the file every time the process starts.
const errorFile = fs.createWriteStream('../ourbitrage_errors.txt', {flags: 'a'}); // Or 'w' to truncate the file every time the process starts.
const logStdout = process.stdout;

const LOG_LEVEL_VERBOSE = 1;    // Writes to stdout
const LOG_LEVEL_DEV = 2;        // Writes to stdout + file
const LOG_LEVEL_PRD = 3;        // Writes to file

const _ignoredComponents = [
];

export class log {
    static now() {
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        };
        return (new Date()).toLocaleDateString('en-US', options);
    }
    static verbose(component, msg, ...args) {
        if (log.level > LOG_LEVEL_VERBOSE) { return; }
        this._output('V', component, msg, ...args);
    }
    static debug(component, msg, ...args) {
        if (log.level > LOG_LEVEL_DEV) { return; }
        this._output('D', component, msg, ...args);
    }
    static info(component, msg, ...args) {
        this._output('I', component, msg, ...args);
    }
    static warn(component, msg, ...args) {
        this._output('W', component, msg, ...args);
    }
    static error(component, msg, ...args) {
        this._output('E', component, msg, ...args);
    }
    static _output(type, component, msg, ...args) {
        if (this._isIgnored(component)) { return; }

        const now = log.now();
        const fnByType = {'V': 'log', 'D': 'log', 'L': 'log', 'I': 'info', 'W': 'warn', 'E': 'error'};
        const _fn = _.isFunction(console[fnByType[type]]) ? console[fnByType[type]] : console.log;
        _fn(`[${now}] [${type}] ${_.padEnd(`[${component}]`, 20, ' ')} ${msg}`, ...args);
    }
    static _isIgnored(component) {
        return _.includes(_ignoredComponents, component);
    }
}

export class logC {
    static init(componentName) {
        return {
            verbose : (msg, ...args) => log.verbose(componentName, msg, ...args),
            debug   : (msg, ...args) => log.debug(componentName, msg, ...args),
            info    : (msg, ...args) => log.info(componentName, msg, ...args),
            warn    : (msg, ...args) => log.warn(componentName, msg, ...args),
            error   : (msg, ...args) => log.error(componentName, msg, ...args)
        };
    }
}

//
//  SET LOGGING LEVEL
//
log.level = LOG_LEVEL_VERBOSE;


// Enforce Logging Level on Prod
if (process.env.NODE_ENV === 'production') {
    log.level = LOG_LEVEL_PRD;
}

// Override Logs to Output to file
console.log = (...args) => {
    if (log.level > LOG_LEVEL_VERBOSE) {
        logFile.write(util.format.apply(null, args) + '\n');
    }
    if (log.level < LOG_LEVEL_PRD) {
        logStdout.write(util.format.apply(null, args) + '\n');
    }
};
console.info = console.log;

console.error = (...args) => {
    if (log.level > LOG_LEVEL_VERBOSE) {
        errorFile.write(util.format.apply(null, args) + '\n');
    }
    if (log.level < LOG_LEVEL_PRD) {
        logStdout.write(util.format.apply(null, args) + '\n');
    }
};
console.warn = console.error;
