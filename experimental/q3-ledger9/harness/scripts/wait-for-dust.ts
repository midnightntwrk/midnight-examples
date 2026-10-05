// yarn wait:dust — blocks until the genesis wallet is synced and holds DUST,
// so the first e2e transaction does not race the fresh devnet.
import { initNetwork, logger, startWallet } from '../src/index.js';

initNetwork();
const wallet = await startWallet('ALICE');
const state = await wallet.wallet.waitForSyncedState();
logger.info(`ALICE synced; DUST balance ${state.dust.balance(new Date())}`);
await wallet.stop();
process.exit(0);
