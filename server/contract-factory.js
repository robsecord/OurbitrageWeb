// NPM Modules
import { _ } from 'lodash';

// App Components
import { ARB_GLOBAL } from './globals';


export const ContractFactory = {

    /**
     *
     * @param addressName
     * @param abi
     * @returns {{prepare: prepare, instance: (function(): *)}}
     */
    create({name, address, abi}) {
        let _instance;
        let _utils;

        function _createInstance() {
            return Object.create(_.assignIn({}, ContractFactory.objInterface, {
                contractName: name,
                contractAddress: address,
                contractAbi: abi,
                contractReady: false,
                contract: null,
                web3: null,
                log: _utils.logger || console.log,
            }));
        }

        return {
            /**
             *
             * @param web3
             * @param networkVersion
             * @param logger
             */
            prepare: ({web3, networkVersion, logger}) => {
                _utils = {web3, networkVersion, logger};
            },

            /**
             *
             * @returns {*}
             */
            instance: () => {
                if (!_instance) {
                    if (!_utils) {
                        throw new Error(`Contract Instance for "${address}" has not been prepared!`);
                    }
                    _instance = _createInstance();
                    _instance.connectToContract(_utils);
                }
                return _instance;
            }
        };
    },

    objInterface: {
        /**
         *
         * @returns {Promise<number>}
         */
        getNetworkVersion() {
            return this.web3.eth.net.getId();
        },

        /**
         *
         * @returns {Promise<string>}
         */
        getNetworkType() {
            return this.web3.eth.net.getNetworkType();
        },

        /**
         *
         * @returns {Promise<number>}
         */
        getNetworkPeerCount() {
            return this.web3.eth.net.getPeerCount();
        },

        /**
         *
         * @param web3
         * @param networkVersion
         */
        connectToContract({web3}) {
            this.web3 = web3;
            this.contract = new this.web3.eth.Contract(this.contractAbi, this.contractAddress);
            this.contractReady = (this.contract instanceof this.web3.eth.Contract);
        },

        /**
         *
         * @returns {boolean|*}
         */
        isReady() {
            return this.contractReady;
        },

        /**
         *
         * @param eventName
         * @param eventOptions
         * @returns {Promise<EventData[]>}
         */
        getEventsFromContract(eventName, eventOptions) {
            return this.contract.getPastEvents(eventName, eventOptions);
        },

        /**
         *
         * @param contractMethod
         * @param tx
         * @param args
         * @returns {*}
         */
        estimateGas(contractMethod, tx, ...args) {
            if (!this.contractReady) {
                return Promise.reject(`Web3 Provider not ready (calling "${this.contractName}.${contractMethod}.estimateGas")`);
            }
            return this.contract.methods[contractMethod](...args).estimateGas(tx);
        },

        /**
         *
         * @param contractMethod
         * @param args
         * @returns {*}
         */
        callContractFn(contractMethod, ...args) {
            if (!this.contractReady) {
                return Promise.reject(`Web3 Provider not ready (calling "${this.contractName}.${contractMethod}.call")`);
            }
            return this.contract.methods[contractMethod](...args).call();
        },

        /**
         *
         * @param contractMethod
         * @param tx
         * @param pk
         * @param args
         * @returns {boolean | void|*}
         */
        tryContractTx(contractMethod, pk, tx, ...args) {
            if (!this.contractReady) {
                return Promise.reject(`Web3 Provider not ready (calling "${this.contractName}.${contractMethod}.send")`);
            }
            return new Promise(async (resolve, reject) => {
                const chainId = await this.web3.eth.net.getId();
                const account = await this.web3.eth.accounts.privateKeyToAccount(pk);
                const nonce = await this.web3.eth.getTransactionCount(account.address);
                const encoded = this.contract.methods[contractMethod](...args).encodeABI();

                tx = {
                    to       : this.contractAddress,
                    from     : account.address,
                    data     : encoded,
                    nonce    : nonce,
                    gas      : `${ARB_GLOBAL.MAX_TX_GAS_LIMIT}`,
                    value    : '0',
                    chainId  : chainId,
                    ...(tx || {}),
                };
                console.log('tryContractTx', contractMethod, tx);
                // tx = {
                //     to       : '0xb9Fd169F2885E5e71d9aDb8E6e8505596feC339d',
                //     from     : '0x6D8F642A757541408B0500E255C29F6bad66BF69',
                //     data     : '0x76233833000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000035341490000000000000000000000000000000000000000000000000000000000',
                //     nonce    : 92,
                //     gasLimit : 500000,
                //     value    : 0,
                //     chainId  : 1,
                //     gas      : 10000000000
                // }

                try {
                    const signed = await this.web3.eth.accounts.signTransaction(tx, pk);
                    const receipt = await this.web3.eth.sendSignedTransaction(signed.rawTransaction);
                    // .on('receipt', resolve);
                    resolve(receipt);
                }
                catch (err) {
                    reject(err);
                }
            });
        },

        /**
         *
         * @param hash
         * @returns {Promise<TransactionReceipt>}
         */
        getReceipt(hash) {
            return this.web3.eth.getTransactionReceipt(hash);
        },

        /**
         *
         * @param hash
         * @returns {Promise<TransactionReceipt|Error>}
         */
        getTransactionReceipt(hash) {
            return new Promise((resolve, reject) => {
                const _getReceipt = () => {
                    this.getReceipt(hash)
                        .then(receipt => {
                            if (receipt === null) {
                                // Try again in 1 second
                                setTimeout(() => {
                                    _getReceipt();
                                }, ARB_GLOBAL.RECEIPT_INTERVAL);
                                return;
                            }
                            resolve(receipt);
                        })
                        .catch(reject);
                };
                _getReceipt();
            });
        }
    }
};
