// This file is part of stagenet-q2 (adapted from example-usdcx).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import http from 'node:http';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import * as path from 'node:path';

import * as Rx from 'rxjs';

import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import {
  NodeZkConfigProvider,
  nodeZkConfigRegistry,
} from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import type { NetworkConfig } from './config.js';
import type { WalletCtx } from './wallet.js';

// node-fetch v2 (via cross-fetch, the indexer provider's Apollo HttpLink
// transport) uses Node's http(s) globalAgent; on Node 24 its keep-alive
// sockets trigger the indexer's `Premature close`. Swap in keep-alive-off
// agents so finalization uses fresh sockets.
http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });

export interface Providers {
  privateStateProvider: ReturnType<typeof levelPrivateStateProvider>;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  zkConfigProvider: NodeZkConfigProvider<string>;
  proofProvider: ReturnType<typeof httpClientProofProvider>;
  walletProvider: unknown;
  midnightProvider: unknown;
}

/** Retry finalization when the indexer drops the connection with `Premature close`. */
function retryOnDrop<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn(...args);
      } catch (e) {
        if (attempt > 3 || !/Premature close/.test(String(e))) throw e;
        await delay(Math.min(3000, 500 * attempt));
      }
    }
  };
}

export async function createProviders(
  ctx: WalletCtx,
  contractDir: string,
  privateStateId: string,
  config: NetworkConfig,
): Promise<Providers> {
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  const signFn = (payload: Uint8Array) =>
    ctx.unshieldedKeystore.signDataAsync(payload);

  const walletProvider = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () =>
      state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx as Parameters<typeof ctx.wallet.balanceUnboundTransaction>[0],
        {
          shieldedSecretKeys: ctx.shieldedSecretKeys,
          dustSecretKey: ctx.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signed = await ctx.wallet.signRecipe(recipe, signFn);
      return ctx.wallet.finalizeRecipe(signed);
    },
    submitTx: (tx: unknown) =>
      ctx.wallet.submitTransaction(
        tx as Parameters<typeof ctx.wallet.submitTransaction>[0],
      ) as unknown,
  };

  const zkConfigProvider = new NodeZkConfigProvider<string>(contractDir);
  const zkConfigRegistry = await nodeZkConfigRegistry(path.dirname(contractDir));
  // The private-state store encryption password must contain at least 3 of:
  // uppercase, lowercase, digits, special characters (enforced by the SDK).
  const password =
    process.env['PRIVATE_STATE_PASSWORD'] ?? 'Example-usdcx-dev1!';

  const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
  pdp.watchForTxData = retryOnDrop('watchForTxData', pdp.watchForTxData.bind(pdp));
  pdp.watchForDeployTxData = retryOnDrop(
    'watchForDeployTxData',
    pdp.watchForDeployTxData.bind(pdp),
  );

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: `midnight-level-db-${ctx.role}-${privateStateId}`,
      privateStateStoreName: privateStateId,
      privateStoragePasswordProvider: () => password,
      accountId: state.shielded.encryptionPublicKey.toHexString().slice(0, 16),
    }),
    publicDataProvider: pdp,
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigRegistry),
    walletProvider,
    midnightProvider: walletProvider,
  };
}
