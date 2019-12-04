// NPM Modules
// import minimist from 'minimist';

// App Components
import { Arbitrator } from './arbitrator';
import { ContractFactory } from './contract-factory';
import { Helpers } from './helpers';
import { ARB_GLOBAL } from './globals';
import { logC } from './logging';
const log = logC.init('APP');

// Contract
import { OurbitrageABI } from './abi/ourbitrage.abi';

// Environment Settings
import env from 'dotenv';
env.config();

/**
 *
 * @returns {Promise<void>}
 */
async function main() {
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    //
    // Script Preparation
    //
    // const commandArgs = minimist(process.argv.slice(2), {alias: {f: 'fresh', c: 'clean'}});
    const owner = process.env.OWNER_PUBLIC_KEY;
    const providerUrl = process.env.WEB3_PROVIDER_URL;
    const networkVersion = process.env.WEB3_NETWORK_VERSION;
    const { web3 } = await Helpers.initializeWeb3(providerUrl);

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    //
    // Contract Preparation
    //
    const addressName = 'OURBITRAGE';
    const contractAddress = ARB_GLOBAL.CONTRACT_ADDRESS[networkVersion][addressName];
    const Ourbitrage = ContractFactory.create({addressName,  abi: OurbitrageABI});
    Ourbitrage.prepare({web3, networkVersion, logger: log.debug});

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    //
    // Network/Environment Logging
    //
    log.info(' ');
    log.info('-----');
    log.info('Ourbitrage Contract Monitor');
    log.info('-----');
    log.info(' ');

    const ourbitrage = Ourbitrage.instance();
    const ourbitrageVersion = await ourbitrage.callContractFn('getVersion');
    const netVersion = await ourbitrage.getNetworkVersion();
    const netType = await ourbitrage.getNetworkType();
    const peerCount = await ourbitrage.getNetworkPeerCount();

    log.info(`Environment:        ${Helpers.isDev() ? 'Development' : 'Production'}`);
    log.info(`Contract Version:   ${ourbitrageVersion}`);
    log.info(`Contract Address:   ${contractAddress}`);
    log.info(`Contract Owner:     ${owner}`);
    log.info(`Network Version:    ${netVersion}`);
    log.info(`Network Type:       ${netType}`);
    log.info(`Network Peer Count: ${peerCount}`);

    // // Reset Database on Fresh Runs
    // if ((commandArgs.fresh || commandArgs.clean) && Helpers.isDev()) {
    //     log.info(' ');
    //     log.info('Fresh Run - Resetting Database Collections...');
    //     await Helpers.resetDatabase(dbs, commandArgs.fresh);
    // }

    log.info(' ');
    log.info('-----');
    log.info('Monitoring started...');
    log.info('-----');
    log.info(' ');


    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    //
    // Script Execution Loop
    //   - will only exit if an error is thrown
    //
    const arbitrator = new Arbitrator({ourbitrage, owner});
    await arbitrator.prepare();

    let profilerResults;
    while ( true ) {
        Helpers.profiler.start('monitorAll');
        await arbitrator.monitorAll();

        profilerResults = Helpers.profiler.stop('monitorAll');
        log.debug(`Script Execution Time: ${Helpers.msToHms(profilerResults.time)}`);
        log.verbose('----------');

        if (profilerResults.time < ARB_GLOBAL.EXEC_INTERVAL) {
            await Helpers.delay(ARB_GLOBAL.EXEC_INTERVAL - profilerResults.time);
        }
        log.debug(' ');
    }
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//
// Script Execution
//
main()
    .catch((err) => {
        log.info(' ');
        log.info('-----');
        log.info('Application quit unexpectedly, error thrown:');
        log.info(err);
        log.info('-----');
        log.info(' ');
        process.exit(1);
    });
