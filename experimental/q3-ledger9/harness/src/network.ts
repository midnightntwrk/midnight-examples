import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NETWORK_ID } from './config.js';

/** Process-wide setup every e2e suite needs before touching the network. */
export function initNetwork(): void {
  // The indexer client's GraphQL subscriptions need a global WebSocket in Node.
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
  setNetworkId(NETWORK_ID);
}
