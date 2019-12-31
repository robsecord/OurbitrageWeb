// NPM Modules
import * as _ from 'lodash';
import getJSON from 'get-json';

// App Components
import { notify } from './notifier';
import { Helpers } from './helpers';
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
    constructor({ourbitrage, owner, privateKey}) {
        this.ourbitrage = ourbitrage;
        this.owner = owner;
        this.privateKey = privateKey;
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

        // Check for Arbitration Opportunities
        const requests = _.map(_arbitrationPairs, (arbData) => this._checkPriceArbitration(arbData));
        const results = await Promise.all(requests);

        // Perform Arbitration
        const opportunities = _.filter(results, opp => (opp.potentialGain > 0));
        if (!_.isEmpty(opportunities)) {
            const {method, fundingToken, profit, loss} = await this._performArbitration({opportunities});
            log.info('  ');
            log.info('Arbitration Results:');
            log.info(`  [${method}] Funding Token: ${fundingToken} | Profit: ${profit} | Loss: ${loss}`);
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
            const result = {method, fundingToken, potentialGain: 0, failing: true};
            try {
                const gasCostETH = _.round(estimatedGas.gas * this.gasPrice);

                if (estimatedGas.failing) {
                    log.error(`  ${method}  - Failed GAS Estimation!`);
                    return resolve(result);
                }

                const requests = _.map(pairs, (pricingReq) => this._getPriceWrapper(pricingReq));
                const pricing = await Promise.all(requests);

                // Check for Arb-Op
                const buyRateInFT = _.parseInt(pricing[0].rate, ARB_GLOBAL.NUM_BASE);
                const sellRateInFT = _.parseInt(pricing[1].rate, ARB_GLOBAL.NUM_BASE);
                const avgRateInFT = (buyRateInFT + sellRateInFT) / 2;
                const gasCostInFT = avgRateInFT * (gasCostETH / ARB_GLOBAL.ETHEREUM_UNIT);
                const potentialGain = sellRateInFT - (buyRateInFT + gasCostInFT);

                const buyAtDisplay = buyRateInFT / ARB_GLOBAL.ETHEREUM_UNIT;
                const sellAtDisplay = sellRateInFT / ARB_GLOBAL.ETHEREUM_UNIT;
                const gainDisplay = potentialGain / ARB_GLOBAL.ETHEREUM_UNIT;

                log.debug(`    ${fundingToken} ${method} with Est. Gas (${estimatedGas.gas}) Cost: ${gasCostETH / ARB_GLOBAL.ETHEREUM_UNIT} ETH (${gasCostInFT / ARB_GLOBAL.ETHEREUM_UNIT} ${fundingToken})`);
                log.verbose(`        buy:  ${buyAtDisplay} ${fundingToken}`);
                log.verbose(`        sell: ${sellAtDisplay} ${fundingToken}`);
                log.verbose(`        gain: ${gainDisplay} ${fundingToken}  (min: ${ARB_GLOBAL.MIN_PROFIT_PER_ARB})`);

                if (potentialGain < ARB_GLOBAL.MIN_PROFIT_PER_ARB) {
                    // No Arb-Op
                    log.verbose(`    - No Arbitration Opportunity.`);
                    log.debug(`       [A: No] [${fundingToken}] [D: ${potentialGain}] [B: ${buyRateInFT}] [S: ${sellRateInFT}] [GC: ${gasCostInFT}] [M: ${method}]`);
                    log.verbose('  ');
                    result.failing = false;
                    return resolve(result);
                }

                // Arb-Op!
                log.verbose(`+++++++ Arbitration Opportunity!`);
                log.info(`       [A: Yes] [${fundingToken}] [D: ${potentialGain}] [B: ${buyRateInFT}] [S: ${sellRateInFT}] [GC: ${gasCostInFT}] [M: ${method}]`);
                log.verbose('  ');

                result.potentialGain = potentialGain;
                result.buyAt = buyRateInFT;
                result.sellAt = sellRateInFT;
                result.gasCostFT = gasCostInFT;
                result.gasCostETH = gasCostETH;
                result.failing = false;
                resolve(result);
            } catch (err) {
                log.error(`    - Failed Tx; Reason: ${err}`);
                resolve(result);
            }
        });
    }

    /**
     *
     * @param opportunities
     * @returns {Promise<{loss: number, profit: number}>}
     * @private
     */
    async _performArbitration({opportunities}) {
        // Determine Best Opportunity
        const bestGain = Helpers.getLargestByField(opportunities, 'potentialGain');
        const bestOpp = _.find(opportunities, {potentialGain: bestGain});
        const { method, fundingToken } = bestOpp;
        log.info(`Performing Arb "${method}" with ${fundingToken} for a potential gain of ${bestGain}`);

        // Perform Arbitration
        const tx = {gas: ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI};
        const pendingTx = await this.ourbitrage.tryContractTx(method, this.privateKey, tx, fundingToken);
        log.debug('pendingTx', JSON.stringify(pendingTx, null, '\t'));
        log.debug('  ');

        const txReceipt = await this.ourbitrage.getTransactionReceipt(pendingTx.transactionHash);
        log.debug('txReceipt', JSON.stringify(txReceipt, null, '\t'));
        log.debug('  ');

        // TODO: Determine Profit/Loss
        let profit = 0;
        let loss = 0;

        // Return Results of Arbitration
        const result = {method, fundingToken, profit, loss};
        notify(result);
        return result;
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
