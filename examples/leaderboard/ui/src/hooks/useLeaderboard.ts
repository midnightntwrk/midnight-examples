// This file is part of example-leaderboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// useLeaderboard reads the leaderboard's on-chain state from the indexer, with
// no wallet. It sends the indexer's `contractAction` GraphQL query with a plain
// fetch() and decodes the state with the compiled contract's ledger().

import { useState, useEffect, useCallback } from 'react';
import { ContractState, fromHex } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { ledger } from '../../../contract/index';
import { deriveState, type LeaderboardEntry } from '../../../api/index';

// Blockfrost serves the Preprod indexer, and every request needs a Midnight
// Preprod project ID. Vite builds the ID into the browser bundle, where anyone
// who loads the page can read it, so use one you are prepared to treat as public.
const BLOCKFROST_PROJECT_ID = import.meta.env.VITE_BLOCKFROST_PROJECT_ID ?? '';
const INDEXER_URL = `${import.meta.env.VITE_INDEXER_URL ?? 'https://midnight-preprod.blockfrost.io/api/v0'}?project_id=${encodeURIComponent(BLOCKFROST_PROJECT_ID)}`;

const CONTRACT_STATE_QUERY = `
  query ContractState($address: HexEncoded!) {
    contractAction(address: $address) {
      state
    }
  }
`;

export function useLeaderboard(contractAddress: string | null, refreshInterval = 15_000) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!contractAddress || !/^[0-9a-fA-F]{64}$/.test(contractAddress)) return;

    try {
      setLoading(true);
      const res = await fetch(INDEXER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: CONTRACT_STATE_QUERY, variables: { address: contractAddress } }),
      });

      const gql = await res.json();
      if (gql.errors) {
        throw new Error(gql.errors[0]?.message ?? 'Indexer query failed');
      }

      const stateHex = gql.data?.contractAction?.state;
      if (!stateHex) {
        throw new Error('Contract not found');
      }

      const state = deriveState(ledger(ContractState.deserialize(fromHex(stateHex)).data));
      setEntries(state.entries);
      setEntryCount(state.entryCount);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contractAddress]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    if (!contractAddress) return;
    const interval = setInterval(fetchLeaderboard, refreshInterval);
    return () => clearInterval(interval);
  }, [contractAddress, refreshInterval, fetchLeaderboard]);

  return { entries, entryCount, loading, error, refresh: fetchLeaderboard };
}
