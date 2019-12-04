
export const ARB_GLOBAL = {};

ARB_GLOBAL.MIN_PROFIT_PER_ARB = 50000;   // WEI
ARB_GLOBAL.MAX_GAS_PER_ARB    = 10;      // GWEI

ARB_GLOBAL.ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
ARB_GLOBAL.PUBLIC_ADDRESS_LENGTH = 42;
ARB_GLOBAL.STARTING_BLOCK = {
    '1'    : 7310000, // Mainnet
    '42'   : 4400000, // Kovan
    '5777' : 0        // Local
};
ARB_GLOBAL.MAX_LATEST_BLOCKS  = 50;

ARB_GLOBAL.NUM_BASE           = 10;
ARB_GLOBAL.HEX_BASE           = 16;
ARB_GLOBAL.ETHEREUM_UNIT      = 1e18;
ARB_GLOBAL.ETHEREUM_PRECISION = 18;
ARB_GLOBAL.GAS_UNIT           = 1e9;
ARB_GLOBAL.GAS_PRECISION      = 9;
ARB_GLOBAL.GSN_UNIT           = 1e8;
ARB_GLOBAL.GSN_PRECISION      = 8;

ARB_GLOBAL.EXEC_INTERVAL = 5000;         // Milli-seconds
ARB_GLOBAL.RECEIPT_INTERVAL = 3000;

ARB_GLOBAL.CONTRACT_ADDRESS = {
    // Main Network
    '1' : {
        OURBITRAGE  : '0xb9Fd169F2885E5e71d9aDb8E6e8505596feC339d'
    },

    // Kovan Test Network
    '42' : {
        OURBITRAGE  : ''
    },

    // Ganache Private Test Network
    '5777' : {
        OURBITRAGE  : ''
    }
};

ARB_GLOBAL.TX = {
    TYPE: {
        ARBITRAGE :  1,
    },
    EVENT: {
        ARBITRAGE : 'Arbitrage',
    },
    STATUS: {
        PENDING   : 1,
        CONFIRMED : 2,
        REMOVED   : 3,
        FAILED    : 4,
        POSTED    : 5
    },
};

ARB_GLOBAL.TX_TYPE_LABELS = [
    '',
    'Arbitrage',
];

ARB_GLOBAL.MAX_GAS_PER_ARB_GWEI = ARB_GLOBAL.MAX_GAS_PER_ARB * ARB_GLOBAL.GAS_UNIT;
