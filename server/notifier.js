// NPM Modules
import Player from 'play-sound';

// App Components
import { Helpers } from './helpers';
import { logC } from './logging';
const log = logC.init('NOTIFIER');

const player = Player({});


/**
 *
 * @param method
 * @param fundingToken
 * @param profit
 * @param loss
 * @returns {null}
 */
export const notify = ({method, fundingToken, profit, loss}) => {
    // Ring Bell in Dev
    if (Helpers.isDev()) {
        return player.play('/System/Library/Sounds/Glass.aiff', (err) => {
            if (err) {
                log.error('Failed to play sound!');
            }
        });
    }

    // Do Something in Prod
};


