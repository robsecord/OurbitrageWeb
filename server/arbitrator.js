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
        const tx = {from: this.owner, gasPrice: ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI};
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
        const tx = {gasPrice: ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI};
        const pendingTx = await this.ourbitrage.tryContractTx(method, this.privateKey, tx, fundingToken);
        log.debug('pendingTx', JSON.stringify(pendingTx, null, '\t'));
        log.debug('  ');
        // pendingTx = {
        //     "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //     "blockNumber": 9210094,
        //     "contractAddress": null,
        //     "cumulativeGasUsed": 671738,
        //     "from": "0x6d8f642a757541408b0500e255c29f6bad66bf69",
        //     "gasUsed": 391523,
        //     "logs": [
        //         {
        //             "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000000000000000000000000000028fe4225ef58e2f3",
        //             "logIndex": 2,
        //             "removed": false,
        //             "topics": [
        //                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d",
        //                 "0x00000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_54bcf427"
        //         },
        //         {
        //             "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000000000000000000000000000028fe4225ef58e2f3",
        //             "logIndex": 3,
        //             "removed": false,
        //             "topics": [
        //                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        //                 "0x00000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd",
        //                 "0x00000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_27bd3f6c"
        //         },
        //         {
        //             "address": "0x65bF64Ff5f51272f729BDcD7AcFB00677ced86Cd",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x000000000000000000000000000000000000000000000000004edce904931424",
        //             "logIndex": 4,
        //             "removed": false,
        //             "topics": [
        //                 "0x75f33ed68675112c77094e7c5b073890598be1d23e27cd7f6907b4a7d98ac619",
        //                 "0x00000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_c85150fe"
        //         },
        //         {
        //             "address": "0x63825c174ab367968EC60f061753D3bbD36A0D8F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f00000000000000000000000000000000000000000000000028fe4225ef58e2f3000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000004edce90493142400000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd",
        //             "logIndex": 5,
        //             "removed": false,
        //             "topics": [
        //                 "0xea9415385bae08fe9f6dc457b02577166790cde83bb18cc340aac6cb81b824de",
        //                 "0x00000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_4d851802"
        //         },
        //         {
        //             "address": "0x8007aa43792A392b221DC091bdb2191E5fF626d1",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f00000000000000000000000000000000000000000000000000873a781c663584",
        //             "logIndex": 6,
        //             "removed": false,
        //             "topics": [
        //                 "0xf838f6ddc89706878e3c3e698e9b5cbfbf2c0e3d3dcd0bd2e00f1ccf313e0185"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_3dd258f0"
        //         },
        //         {
        //             "address": "0x65bF64Ff5f51272f729BDcD7AcFB00677ced86Cd",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000028fe4225ef58e2f3000000000000000000000000000000000000000000000000004edce904931424000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d000000000000000000000000000000000000000000000000004edce90493142400000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000045045524d00000000000000000000000000000000000000000000000000000000",
        //             "logIndex": 7,
        //             "removed": false,
        //             "topics": [
        //                 "0xd30ca399cb43507ecec6a629a35cf45eb98cda550c27696dcb0d8c4a3873ce6c",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_b380edf6"
        //         },
        //         {
        //             "address": "0x818E6FECD516Ecc3849DAf6845e3EC868087B755",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000028fe4225ef58e2f3000000000000000000000000000000000000000000000000004edce904931424",
        //             "logIndex": 8,
        //             "removed": false,
        //             "topics": [
        //                 "0x1849bd6a030a1bca28b83437fd3de96f3d27a5d172fa7e9c78e7b61468928a39",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_b3a0b8bc"
        //         },
        //         {
        //             "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000000000000000000000000000028e7f968b97327cd",
        //             "logIndex": 9,
        //             "removed": false,
        //             "topics": [
        //                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        //                 "0x0000000000000000000000002a1530c4c41db0b0b2bb646cb5eb1a67b7158667",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_685e54b6"
        //         },
        //         {
        //             "address": "0x2a1530C4C41db0B0b2bB646CB5Eb1A67b7158667",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x",
        //             "logIndex": 10,
        //             "removed": false,
        //             "topics": [
        //                 "0xcd60aa75dea3072fbc07ae6d7d856b5dc5f4eee88854f5b4abf7b680ef8bc50f",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d",
        //                 "0x000000000000000000000000000000000000000000000000004edce904931424",
        //                 "0x00000000000000000000000000000000000000000000000028e7f968b97327cd"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_94af5846"
        //         }
        //     ],
        //     "logsBloom": "0x00000000000000000000000000000000208010000000000000000000000000000200000000000000000000000000000400000002000000000000800020000000400000000400000040008208000000000000000c00000040000000000000000010000000000000000000000000080000040000000000000000000010000000000000004040100000000000000000040000000000000000000000001008000000000020000000010004000020004000000000000400001000000200000020010000100002890000000020000000002000000002000000000800080010000010000000000000020000000000000002020000040000000000000000000000100800",
        //     "status": true,
        //     "to": "0xb9fd169f2885e5e71d9adb8e6e8505596fec339d",
        //     "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //     "transactionIndex": 2
        // }

        const txReceipt = await this.ourbitrage.getTransactionReceipt(pendingTx.transactionHash);
        log.debug('txReceipt', JSON.stringify(txReceipt, null, '\t'));
        log.debug('  ');
        // txReceipt = {
        //     "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //     "blockNumber": 9210094,
        //     "contractAddress": null,
        //     "cumulativeGasUsed": 671738,
        //     "from": "0x6d8f642a757541408b0500e255c29f6bad66bf69",
        //     "gasUsed": 391523,
        //     "logs": [
        //         {
        //             "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000000000000000000000000000028fe4225ef58e2f3",
        //             "logIndex": 2,
        //             "removed": false,
        //             "topics": [
        //                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d",
        //                 "0x00000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_54bcf427"
        //         },
        //         {
        //             "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000000000000000000000000000028fe4225ef58e2f3",
        //             "logIndex": 3,
        //             "removed": false,
        //             "topics": [
        //                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        //                 "0x00000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd",
        //                 "0x00000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_27bd3f6c"
        //         },
        //         {
        //             "address": "0x65bF64Ff5f51272f729BDcD7AcFB00677ced86Cd",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x000000000000000000000000000000000000000000000000004edce904931424",
        //             "logIndex": 4,
        //             "removed": false,
        //             "topics": [
        //                 "0x75f33ed68675112c77094e7c5b073890598be1d23e27cd7f6907b4a7d98ac619",
        //                 "0x00000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_c85150fe"
        //         },
        //         {
        //             "address": "0x63825c174ab367968EC60f061753D3bbD36A0D8F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f00000000000000000000000000000000000000000000000028fe4225ef58e2f3000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000004edce90493142400000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd",
        //             "logIndex": 5,
        //             "removed": false,
        //             "topics": [
        //                 "0xea9415385bae08fe9f6dc457b02577166790cde83bb18cc340aac6cb81b824de",
        //                 "0x00000000000000000000000065bf64ff5f51272f729bdcd7acfb00677ced86cd"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_4d851802"
        //         },
        //         {
        //             "address": "0x8007aa43792A392b221DC091bdb2191E5fF626d1",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f00000000000000000000000000000000000000000000000000873a781c663584",
        //             "logIndex": 6,
        //             "removed": false,
        //             "topics": [
        //                 "0xf838f6ddc89706878e3c3e698e9b5cbfbf2c0e3d3dcd0bd2e00f1ccf313e0185"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_3dd258f0"
        //         },
        //         {
        //             "address": "0x65bF64Ff5f51272f729BDcD7AcFB00677ced86Cd",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000028fe4225ef58e2f3000000000000000000000000000000000000000000000000004edce904931424000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d000000000000000000000000000000000000000000000000004edce90493142400000000000000000000000063825c174ab367968ec60f061753d3bbd36a0d8f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000045045524d00000000000000000000000000000000000000000000000000000000",
        //             "logIndex": 7,
        //             "removed": false,
        //             "topics": [
        //                 "0xd30ca399cb43507ecec6a629a35cf45eb98cda550c27696dcb0d8c4a3873ce6c",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_b380edf6"
        //         },
        //         {
        //             "address": "0x818E6FECD516Ecc3849DAf6845e3EC868087B755",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000028fe4225ef58e2f3000000000000000000000000000000000000000000000000004edce904931424",
        //             "logIndex": 8,
        //             "removed": false,
        //             "topics": [
        //                 "0x1849bd6a030a1bca28b83437fd3de96f3d27a5d172fa7e9c78e7b61468928a39",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_b3a0b8bc"
        //         },
        //         {
        //             "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x00000000000000000000000000000000000000000000000028e7f968b97327cd",
        //             "logIndex": 9,
        //             "removed": false,
        //             "topics": [
        //                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        //                 "0x0000000000000000000000002a1530c4c41db0b0b2bb646cb5eb1a67b7158667",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_685e54b6"
        //         },
        //         {
        //             "address": "0x2a1530C4C41db0B0b2bB646CB5Eb1A67b7158667",
        //             "blockHash": "0xde9e3b0a292fa1a0dc8097478681da601afcce8dc82282120dfe718d21b1be2c",
        //             "blockNumber": 9210094,
        //             "data": "0x",
        //             "logIndex": 10,
        //             "removed": false,
        //             "topics": [
        //                 "0xcd60aa75dea3072fbc07ae6d7d856b5dc5f4eee88854f5b4abf7b680ef8bc50f",
        //                 "0x000000000000000000000000b9fd169f2885e5e71d9adb8e6e8505596fec339d",
        //                 "0x000000000000000000000000000000000000000000000000004edce904931424",
        //                 "0x00000000000000000000000000000000000000000000000028e7f968b97327cd"
        //             ],
        //             "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //             "transactionIndex": 2,
        //             "id": "log_94af5846"
        //         }
        //     ],
        //     "logsBloom": "0x00000000000000000000000000000000208010000000000000000000000000000200000000000000000000000000000400000002000000000000800020000000400000000400000040008208000000000000000c00000040000000000000000010000000000000000000000000080000040000000000000000000010000000000000004040100000000000000000040000000000000000000000001008000000000020000000010004000020004000000000000400001000000200000020010000100002890000000020000000002000000002000000000800080010000010000000000000020000000000000002020000040000000000000000000000100800",
        //     "status": true,
        //     "to": "0xb9fd169f2885e5e71d9adb8e6e8505596fec339d",
        //     "transactionHash": "0x6d843870c736e8a770c012cfda14f955028ba36a2e0057247df1ee5035431e1a",
        //     "transactionIndex": 2
        // }

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
