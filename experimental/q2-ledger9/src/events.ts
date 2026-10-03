// This file is part of stagenet-q2 (adapted from compact-end-2-end/utils/events.ts).
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
//
// On-chain contract-event (MIP-0002 `log`) read-back over the indexer GraphQL
// API. Events.compact's transfer emits UnshieldedSpend + UnshieldedReceive,
// classified by the indexer as UNSHIELDED_SPEND / UNSHIELDED_RECEIVE; filtering
// on those two types + the transfer tx hash returns exactly those logs.

export interface ContractLogEvent {
  id: number;
  contractAddress: string;
  transactionId: number;
  /** Hex-encoded serialized event — VersionedLogItem: [version][tag][payload]. */
  raw: string;
}

const CONTRACT_LOG_QUERY = `
  query ContractLogEvents($address: HexEncoded!, $txHash: HexEncoded!) {
    contractEvents(
      filter: {
        contractAddress: $address
        transactionHash: $txHash
        types: [UNSHIELDED_SPEND, UNSHIELDED_RECEIVE]
      }
    ) {
      id
      raw
      contractAddress
      transactionId
    }
  }
`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/** Query the indexer for the UnshieldedSpend/Receive logs one transfer emitted. */
export async function queryContractLogEvents(
  indexerHttpUrl: string,
  contractAddress: string,
  txHash: string,
): Promise<ContractLogEvent[]> {
  const address = contractAddress.replace(/^0x/, '');
  const hash = txHash.replace(/^0x/, '');
  const res = await fetch(indexerHttpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: CONTRACT_LOG_QUERY, variables: { address, txHash: hash } }),
  });
  if (!res.ok) {
    throw new Error(`indexer GraphQL HTTP ${res.status} querying contract events for ${txHash}`);
  }
  const body = (await res.json()) as GraphQLResponse<{ contractEvents: ContractLogEvent[] }>;
  if (body.errors?.length) {
    throw new Error(
      `indexer rejected the contractEvents query: ${body.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return body.data?.contractEvents ?? [];
}

/** Normalize + compare two hex contract addresses (0x- and case-insensitive). */
export function sameContractAddress(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^0x/, '').toLowerCase();
  return norm(a) === norm(b);
}
