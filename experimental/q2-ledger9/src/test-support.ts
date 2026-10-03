// This file is part of stagenet-q2.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// Shared test setup: install the WebSocket global the wallet sync needs, pin
// the network id, and expose the resolved config + a logger + the sync timeout.

import { WebSocket } from 'ws';
import pino from 'pino';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { getConfig } from './config.js';
import { IS_REMOTE, NETWORK } from './secret.js';

// Required for the wallet's GraphQL subscription-based sync in Node.
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

export const config = getConfig();
setNetworkId(config.networkId);

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

export { IS_REMOTE, NETWORK };

// Remote sync can take a long time on a fresh wallet; local devnet is quick.
export const syncTimeoutMs = Number(
  process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (IS_REMOTE ? 60 * 60_000 : 10 * 60_000),
);
