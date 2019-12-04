// NPM Modules
import * as _ from 'lodash';
import getJSON from 'get-json';

// App Components
import { notify } from './notifier';
import { ARB_GLOBAL } from './globals';
import { logC } from './logging';
const log = logC.init('ARBITRATOR');


const _arbitrationPairs = [
    {
        method: 'arbEthFromKyberToUniswap',
        fundingToken: 'SAI',
        pairs: [
            {from: 'ETH', to: 'SAI', venue: 'BUY-KYBER-EXCHANGE'},
            {from: 'ETH', to: 'SAI', venue: 'SELL-UNISWAP-EXCHANGE'},
        ]
    },
    {
        method: 'arbEthFromUniswapToKyber',
        fundingToken: 'SAI',
        pairs: [
            {from: 'ETH', to: 'SAI', venue: 'BUY-UNISWAP-EXCHANGE'},
            {from: 'ETH', to: 'SAI', venue: 'SELL-KYBER-EXCHANGE'},
        ]
    },
    {
        method: 'arbEthFromKyberToUniswap',
        fundingToken: 'DAI',
        pairs: [
            {from: 'ETH', to: 'DAI', venue: 'BUY-KYBER-EXCHANGE'},
            {from: 'ETH', to: 'DAI', venue: 'SELL-UNISWAP-EXCHANGE'},
        ]
    },
    {
        method: 'arbEthFromUniswapToKyber',
        fundingToken: 'DAI',
        pairs: [
            {from: 'ETH', to: 'DAI', venue: 'BUY-UNISWAP-EXCHANGE'},
            {from: 'ETH', to: 'DAI', venue: 'SELL-KYBER-EXCHANGE'},
        ]
    },
];


export class Arbitrator {
    /**
     *
     * @param ourbitrage
     * @param owner
     * @param arbitrationPairs
     */
    constructor({ourbitrage, owner}) {
        this.ourbitrage = ourbitrage;
        this.owner = owner;
        this.gasPrice = 0;
    }

    /**
     *
     * @returns {Promise<void>}
     */
    async prepare() {
        // Get Gas Cost Estimates for Arbitration Methods
        const tx = {from: this.owner, gas: ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI};
        const requests = _.map(_arbitrationPairs, ({method, fundingToken}) => this._getEstimatedGasWrapper({tx, method, fundingToken}));
        const estimatedGas = await Promise.all(requests);
        _.forEach(_arbitrationPairs, (arbData, arbIndex) => {
            arbData.estimatedGas = estimatedGas[arbIndex];
        });
    }

    /**
     *
     * @returns {Promise<void>}
     */
    async monitorAll() {
        // Check Current Gas Price
        this.gasPrice = await this._getGasPrice();
        log.debug(`Using Gas Price: ${this.gasPrice / 1e9} GWEI`);
        log.verbose('  ');

        // Attempt Arbitration
        const requests = _.map(_arbitrationPairs, (arbData) => this._checkPriceArbitration(arbData));
        const results = await Promise.all(requests);

        // TODO: Store all results in DB for analytics

        // Check for Executed Arbitrations
        if (!_.isUndefined(_.find(results, 'executed'))) {
            log.info('  ');
            log.info('Arbitration Results:');
            _.forEach(results, res => {
                if (res.executed && !res.failing) {
                    log.info(`  ${res.method} -> Profit: ${res.profit}  |  Loss: ${res.loss}`);
                }
            });
        }
        log.verbose('-----');
        log.debug('  ');
    }

    /**
     *
     * @param method
     * @param pairs
     * @param fundingToken
     * @param estimatedGas
     * @returns {Promise}
     * @private
     */
    _checkPriceArbitration({method, pairs, fundingToken, estimatedGas}) {
        return new Promise(async (resolve) => {
            try {
                const gasCost = _.round(estimatedGas.gas * this.gasPrice);

                if (estimatedGas.failing) {
                    log.error(`  ${method}  - Failed GAS Estimation!`);
                    return resolve({method, profit: 0, loss: 0, executed: false, failing: true});
                }

                const requests = _.map(pairs, (pricingReq) => this._getPriceWrapper(pricingReq));
                const pricing = await Promise.all(requests);

                // Check for Arb-Op
                const input = _.parseInt(pricing[0].rate, ARB_GLOBAL.NUM_BASE);
                const output = _.parseInt(pricing[1].rate, ARB_GLOBAL.NUM_BASE);
                const buyAt = input + gasCost;
                const sellAt = output;
                const diff = sellAt - buyAt;
                const buyAtEth = buyAt / ARB_GLOBAL.ETHEREUM_UNIT;
                const sellAtEth = sellAt / ARB_GLOBAL.ETHEREUM_UNIT;
                const diffEth = diff / ARB_GLOBAL.ETHEREUM_UNIT;

                log.debug(`    ${fundingToken} ${method} with Est. Gas Cost: ${gasCost} WEI`);
                log.verbose(`        buy:  ${buyAtEth} ETH`);
                log.verbose(`        sell: ${sellAtEth} ETH`);
                log.verbose(`        diff: ${diffEth} ETH  (min: ${ARB_GLOBAL.MIN_PROFIT_PER_ARB} WEI)`);

                if (buyAt > sellAt + ARB_GLOBAL.MIN_PROFIT_PER_ARB) {
                    // No Arb-Op
                    log.debug(`    - No Arbitration Opportunity.`);
                    log.verbose('  ');
                    return resolve({method, profit: 0, loss: 0, executed: false, failing: false});
                }

                // Arb-Op!
                const {profit, loss} = await this._performArbitration({method, fundingToken});
                resolve({method, profit, loss, executed: true, failing: false});
            } catch (err) {
                log.error(`    - Failed Tx; Reason: ${err}`);
                resolve({method, profit: 0, loss: 0, executed: false, failing: true});
            }
        });
    }

    /**
     *
     * @param method
     * @param fundingToken
     * @returns {Promise<{loss: number, profit: number}>}
     * @private
     */
    async _performArbitration({method, fundingToken}) {
        log.verbose(`+++++++ Arbitration Opportunity!`);
        log.verbose('  ');

        const pendingTx = await this.ourbitrage.callContractFn(method, fundingToken);
        log.debug('pendingTx', JSON.stringify(pendingTx, null, '\t'));
        log.debug('  ');

        const txReceipt = await this.ourbitrage.getTransactionReceipt(pendingTx.transactionHash);
        log.debug('txReceipt', JSON.stringify(txReceipt, null, '\t'));
        log.debug('  ');

        let profit = 0;
        let loss = 0;

        // TODO: Determine Profit/Loss

        notify({method, fundingToken, profit, loss});
        return {profit, loss};
    }

    /**
     *
     * @returns {Promise<number>}
     * @private
     */
    async _getGasPrice() {
        const gasPrices = await getJSON('https://ethgasstation.info/json/ethgasAPI.json');
        let gasPrice = _.parseInt(gasPrices.safeLow, ARB_GLOBAL.NUM_BASE);
        if (_.parseInt(gasPrices.safeLowWait, ARB_GLOBAL.NUM_BASE) > ARB_GLOBAL.MAX_GAS_PER_ARB) {
            gasPrice = _.parseInt(gasPrices.average, ARB_GLOBAL.NUM_BASE);
        }
        const r = _.random(1, 9);
        return (_.round(gasPrice) * ARB_GLOBAL.GSN_UNIT) + (r * ARB_GLOBAL.GSN_UNIT);
    }

    /**
     *
     * @param from
     * @param to
     * @param venue
     * @returns {Promise}
     * @private
     */
    _getPriceWrapper({from, to, venue}) {
        return new Promise(async (resolve) => {
            try {
                const rate = await this.ourbitrage.callContractFn('getPrice', from, to, venue, `${ARB_GLOBAL.ETHEREUM_UNIT}`);
                resolve({rate, from, to, venue});
            } catch (err) {
                resolve({rate: 0, from, to, venue});
            }
        });
    }

    /**
     *
     * @param tx
     * @param method
     * @param fundingToken
     * @returns {Promise}
     * @private
     */
    _getEstimatedGasWrapper({tx, method, fundingToken}) {
        return new Promise(async (resolve) => {
            try {
                const gas = await this.ourbitrage.estimateGas(method, tx, fundingToken);
                resolve({gas, failing: (gas === ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI)});
            } catch (err) {
                resolve({gas: ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI, failing: true});
            }
        });
    }
}
