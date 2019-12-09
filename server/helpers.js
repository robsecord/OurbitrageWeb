// NPM Modules
import Web3 from 'web3';
import { hours, minutes, seconds, milliseconds } from 'time-convert';
import perf from 'execution-time';


// Helpers Object
export const Helpers = {};

Helpers.profiler = perf();

/**
 *
 * @returns {boolean}
 */
Helpers.isDev = () => {
    return (process.env.NODE_ENV !== 'production');
};

/**
 *
 * @param providerUrl
 * @returns {Promise}
 */
Helpers.initializeWeb3 = async (providerUrl) => {
    return new Promise((resolve) => {
        const web3provider = new Web3.providers.HttpProvider(providerUrl);
        const web3 = new Web3(web3provider);
        resolve({web3provider, web3});
    });
};

/**
 *
 * @param ms
 * @returns {*}
 */
Helpers.msToHms = (ms) => {
    return milliseconds.to(hours, minutes, seconds, milliseconds)(ms)
        .map(n => n < 10 ? '0' + n : n.toString()) // zero-pad
        .join(':')
};

/**
 *
 * @param time
 * @returns {Promise}
 */
Helpers.delay = (time) => {
    return new Promise((resolve) => {
        setTimeout(resolve, time);
    });
};

Helpers.getLargestByField = (items, field) => {
    let largest = items[0][field];
    for (let i = 1; i < items.length; i++) {
        if (items[i][field] > largest) {
            largest = items[i][field];
        }
    }
    return largest;
};
