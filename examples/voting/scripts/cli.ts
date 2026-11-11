// This file is part of example-voting.
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

// The admin and voter CLI for the voting contract.
//
//   npm run vote -- <command> [options]          (MIDNIGHT_NETWORK=local|preview|preprod)
//
// Admin:
//   admin keygen [--force]        make .voting/admin.json: contract secret + X25519 ballot key
//   deploy --proposal MIP-0018    deploy a vote (runs scripts/deploy.ts as the admin)
//   add-admin-key [--key <hex>]   publish an X25519 key ballots get encrypted to (default: yours)
//   enrol <voterKey…> | --roster roster.json   enrol voter keys (a roster is [{name, key}])
//   open [--days 7 | --deadline <ISO time>]    freeze the list and open voting
//   close-early                   start counting once every enrolled voter has cast
//   count                         decrypt and count every uncounted ballot
// Voter:
//   voter keygen [--force]        make .voting/voter.json and print the key to send the admin
//   voter key                     print your voter key again
//   cast yes|no|abstain           cast your one ballot
//   self-count [yes|no|abstain]   count your own ballot if the admin hasn't (vote defaults to
//                                 the one this machine cast)
// Anyone:
//   status                        phase, deadline, turnout, uncounted ballots
//   result                        the tally and whether the proposal passes (yes > no)
//
// Options: --contract <address> (default: deployments/<network>.json), --wallet <ROLE>
// (the wallet that pays fees; default ALICE, from .env.<network> off local).
// VOTING_KEYS_DIR picks another key directory, to act as several people on one
// machine. The CLI keeps the circuit's private state (your secret) in memory
// for one run only, so voters sharing a fee wallet never share it. Voters who
// run at the same time should still each pay fees with their own --wallet.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEnv } from 'vite';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { CompiledVotingContract, ledger, zkConfigPath, type Ledger } from '../contract/index.js';
import { Phase } from '../contract/managed/voting/contract/index.js';
import { createVotingPrivateState, type VotingPrivateState } from '../contract/witnesses.js';
import {
  Vote,
  adminEncryptionPublicKey,
  ballotNullifier,
  checkOpening,
  isUsableAdminKey,
  keyFingerprint,
  openBallot,
  ownOpening,
  passes,
  proposalLabel,
  sealBallot,
  usableAdminKeys,
  voteInstance,
  voterKey,
} from '../src/crypto.js';
import { createAdminKeys, createVoterKeys, keysDir, readAdminKeys, readVoterKeys } from '../src/keys.js';
import { readDeployments } from '../src/deployments.js';
import { buildProviders, ledgerState, type VotingCircuits, type VotingProviders } from '../src/providers.js';
import { MidnightWalletProvider, resolveWallet, syncWallet, waitForDust, waitForNightThenDust } from '../src/wallet.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const HOUR = 3600;
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn', transport: { target: 'pino-pretty' } });

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
if (isRemote) {
  const dir = fileURLToPath(new URL('../../../', import.meta.url));
  for (const [k, v] of Object.entries(loadEnv(network, dir, ''))) if (process.env[k] === undefined) process.env[k] = v;
}

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    contract: { type: 'string' },
    wallet: { type: 'string', default: 'ALICE' },
    proposal: { type: 'string' },
    roster: { type: 'string' },
    key: { type: 'string' },
    days: { type: 'string' },
    deadline: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

const die = (msg: string): never => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const VOTES: Record<string, Vote> = { yes: Vote.YES, no: Vote.NO, abstain: Vote.ABSTAIN };
const VOTE_NAMES = ['yes', 'no', 'abstain'] as const;
const parseVote = (s: string | undefined): Vote => {
  const v = s === undefined ? undefined : VOTES[s.toLowerCase()];
  return v === undefined ? die('Vote must be yes, no or abstain') : v;
};

// Imported lazily: the network configs read the environment when they load.
const config = (await import('../src/config.js')).getConfig();
setNetworkId(config.networkId);

function contractAddress(): string {
  if (opts.contract) return opts.contract;
  const address = readDeployments(network)?.contracts['voting']?.address;
  return address ?? die(`No voting contract in deployments/${network}.json. Deploy one, or pass --contract <address>.`);
}

async function readLedger(address = contractAddress()): Promise<Ledger> {
  const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
  return ledger(ledgerState(await pdp.queryContractState(address)));
}

/** Where this machine remembers the vote it cast, for self-count. Not secret from its owner, but private. */
const castRecord = (address: string) => `${keysDir()}/cast-${network}-${address}.json`;

type Session = { providers: VotingProviders; stop: () => Promise<void> };

async function session(): Promise<Session> {
  const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };
  const setup = resolveWallet(network, opts.wallet);
  const wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret);
  await wallet.start();
  const timeout = Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 120 : 10) * 60_000);
  console.log(`… syncing the ${setup.role} wallet on ${network}`);
  await syncWallet(logger, wallet.wallet, timeout);
  if (isRemote) {
    await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, envConfig, config.faucet, {
      label: setup.role,
    });
  } else {
    await waitForDust(logger, wallet.wallet, 1, timeout, config.indexer);
  }
  // In memory: each call sets the private state it needs, and nothing outlives
  // this process, so two identities on one fee wallet can't read or overwrite
  // each other's secret.
  const providers = buildProviders(wallet, zkConfigPath, config, 'memory');
  return { providers, stop: () => wallet.stop() };
}

/** Submits one circuit call as `who`, whose private state is set first. */
async function call(s: Session, address: string, who: VotingPrivateState, circuitId: VotingCircuits, args: unknown[]) {
  const id = 'VotingCliState';
  await s.providers.privateStateProvider.forContract(address).set(id, who);
  console.log(`… ${circuitId}: proving and submitting`);
  const tx = await submitCallTx(s.providers, {
    compiledContract: CompiledVotingContract,
    contractAddress: address,
    privateStateId: id,
    circuitId,
    args,
  } as never);
  console.log(`✔ ${circuitId} in block ${tx.public.blockHeight} (tx ${tx.public.txId})`);
}

async function withSession(fn: (s: Session, address: string) => Promise<void>): Promise<void> {
  const address = contractAddress();
  const s = await session();
  try {
    await fn(s, address);
  } finally {
    await s.stop().catch(() => undefined);
  }
}

const now = () => Math.floor(Date.now() / 1000);
const iso = (secs: bigint) => new Date(Number(secs) * 1000).toISOString();
const uncounted = (l: Ledger) => [...l.ballots].map(([n]) => n).filter((n) => !l.counted.member(n));

const commands: Record<string, () => Promise<void>> = {
  async 'admin keygen'() {
    const { keys, file } = createAdminKeys(opts.force);
    console.log(`✔ Wrote ${file}. Back it up: without it you can't administer or count this vote.`);
    console.log(`  Ballot encryption key (published by add-admin-key): ${toHex(keys.encPublicKey)}`);
  },

  async 'voter keygen'() {
    const { keys, file } = createVoterKeys(opts.force);
    console.log(`✔ Wrote ${file}. Back it up: it is the only way to vote, or to count your own ballot.`);
    console.log(`  Your voter key (send this to the admin): ${toHex(voterKey(keys.secretKey))}`);
  },

  async 'voter key'() {
    console.log(toHex(voterKey(readVoterKeys().secretKey)));
  },

  async deploy() {
    if (!opts.proposal) die('deploy needs --proposal <label>, for example --proposal MIP-0018');
    readAdminKeys();
    const r = spawnSync('npx', ['vite-node', 'scripts/deploy.ts', 'voting'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: 'inherit',
      env: { ...process.env, VOTING_PROPOSAL: opts.proposal },
    });
    if (r.status !== 0) die('deploy failed');
    console.log(`Next: npm run vote -- add-admin-key, then enrol the voters.`);
  },

  async 'add-admin-key'() {
    const admin = readAdminKeys();
    const key = opts.key ? fromHex(opts.key) : adminEncryptionPublicKey(admin.encSecretKey);
    if (key.length !== 32) die('--key must be a 32-byte X25519 public key in hex');
    if (!isUsableAdminKey(key)) die('--key is not a usable X25519 public key (low-order): ballots could not be encrypted to it');
    console.log(`  Publishing admin key ${keyFingerprint(key)}: announce this fingerprint so voters can check it.`);
    await withSession((s, a) => call(s, a, createVotingPrivateState(admin.secretKey), 'addAdminKey', [key]));
  },

  async enrol() {
    const admin = readAdminKeys();
    let keys = positionals.slice(1);
    if (opts.roster) {
      const roster = JSON.parse(fs.readFileSync(opts.roster, 'utf8')) as { name: string; key: string }[];
      keys = keys.concat(roster.map((r) => r.key));
    }
    if (keys.length === 0) die('enrol needs voter keys, or --roster roster.json');
    const before = await readLedger();
    const todo = keys.map(fromHex).filter((k) => {
      if (k.length !== 32) die(`Not a 32-byte voter key: ${toHex(k)}`);
      return !before.voterKeys.member(k);
    });
    if (todo.length < keys.length) console.log(`  ${keys.length - todo.length} already enrolled; skipping them`);
    await withSession(async (s, a) => {
      for (const k of todo) await call(s, a, createVotingPrivateState(admin.secretKey), 'enrol', [k]);
    });
    const l = await readLedger();
    console.log(`✔ ${l.enrolled} voters enrolled. Voter tree root (publish it with the roster): ${l.voters.root().field.toString(16)}`);
  },

  async open() {
    const admin = readAdminKeys();
    const deadline = opts.deadline
      ? Math.floor(Date.parse(opts.deadline) / 1000)
      : now() + Math.round(Number(opts.days ?? '7') * 24 * HOUR);
    if (!Number.isFinite(deadline) || deadline <= now()) die('The deadline must be a valid time in the future');
    // Opening freezes the admin keys and there is no way to remove one, so
    // refuse to open with a key voters' clients would have to skip.
    const { unusable } = usableAdminKeys([...(await readLedger()).adminEncKeys]);
    if (unusable.length > 0)
      die(`Unusable admin key(s) ${unusable.map(keyFingerprint).join(', ')} are published: redeploy without them before opening`);
    await withSession((s, a) => call(s, a, createVotingPrivateState(admin.secretKey), 'open', [BigInt(deadline)]));
    console.log(`✔ Voting is open until ${iso(BigInt(deadline))}. Counting closes 48 hours after that.`);
  },

  async cast() {
    const vote = parseVote(positionals[1]);
    const voter = readVoterKeys();
    const address = contractAddress();
    const l = await readLedger(address);
    const v = voteInstance(l.proposalId, address);
    if (l.phase !== Phase.OPEN || l.closedEarly || BigInt(now()) >= l.deadline) die('Voting is not open');
    if (!l.voterKeys.member(voterKey(voter.secretKey))) die('Your voter key is not enrolled in this vote');
    if (l.ballots.member(ballotNullifier(voter.secretKey, v))) die('You have already voted');
    const left = Number(l.deadline) - now();
    if (left < 10 * 60) console.warn(`! Only ${left}s left: a cast that lands after the deadline is rejected.`);
    const { usable: adminKeys, unusable } = usableAdminKeys([...l.adminEncKeys]);
    for (const k of unusable) console.warn(`! Skipping unusable admin key ${keyFingerprint(k)}`);
    if (adminKeys.length === 0) die('No usable admin key to encrypt your ballot to; ask the admin');
    // The proof doesn't cover these keys (they come from the indexer): check the
    // fingerprints against the ones the admin announced.
    console.log(`  Encrypting to admin key(s): ${adminKeys.map(keyFingerprint).join(', ')}`);
    const blob = sealBallot(ownOpening(voter.secretKey, v, vote), adminKeys, v);
    await withSession((s, a) => call(s, a, createVotingPrivateState(voter.secretKey, vote), 'cast', [blob]));
    // Kept only so self-count can default to the vote cast here. It is your
    // vote in plain text: delete the file if that matters to you.
    fs.writeFileSync(castRecord(address), `${JSON.stringify({ vote: VOTE_NAMES[vote] })}\n`, { mode: 0o600 });
    console.log(`✔ Voted on ${proposalLabel(l.proposalId)}. Your ballot is encrypted to ${adminKeys.length} admin key(s).`);
  },

  async 'close-early'() {
    const admin = readAdminKeys();
    const l = await readLedger();
    if (l.castCount !== l.enrolled) die(`Only ${l.castCount} of ${l.enrolled} voters have cast`);
    await withSession((s, a) => call(s, a, createVotingPrivateState(admin.secretKey), 'closeEarly', []));
    console.log(`✔ Counting is open. It still ends at ${iso(l.countingEnds)}, 48 hours after the original deadline.`);
  },

  async count() {
    const admin = readAdminKeys();
    const address = contractAddress();
    const l = await readLedger(address);
    const v = voteInstance(l.proposalId, address);
    // Every opening is checked against its commitment before it is submitted:
    // a voter's client can write a blob that decrypts but doesn't match, and
    // that must not stop the other ballots being counted.
    const good: { n: Uint8Array; vote: Vote; salt: Uint8Array }[] = [];
    for (const n of uncounted(l)) {
      const opening = openBallot(l.encBallots.lookup(n), admin.encSecretKey, v);
      if (opening === undefined) console.warn(`! Can't decrypt ballot ${toHex(n)}: its voter can self-count it.`);
      else if (!checkOpening(opening, l.ballots.lookup(n)))
        console.warn(`! Ballot ${toHex(n)} decrypts to an opening that doesn't match: its voter can self-count it.`);
      else good.push({ n, ...opening });
    }
    if (good.length === 0) return void console.log('Nothing to count.');
    let failed = 0;
    await withSession(async (s, a) => {
      for (const { n, vote, salt } of good) {
        try {
          await call(s, a, createVotingPrivateState(admin.secretKey), 'count', [n, vote, salt]);
        } catch (err) {
          failed++;
          console.warn(`! count failed for ${toHex(n)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
    if (failed > 0) console.warn(`! ${failed} ballot(s) not counted; run count again to retry them.`);
    await commands['result']!();
  },

  async 'self-count'() {
    const voter = readVoterKeys();
    const address = contractAddress();
    let name = positionals[1];
    if (!name && fs.existsSync(castRecord(address))) name = JSON.parse(fs.readFileSync(castRecord(address), 'utf8')).vote;
    const vote = parseVote(name);
    const l = await readLedger(address);
    const v = voteInstance(l.proposalId, address);
    const n = ballotNullifier(voter.secretKey, v);
    if (!l.ballots.member(n)) die('You have no ballot in this vote');
    if (l.counted.member(n)) return void console.log('Your ballot is already counted.');
    const { salt } = ownOpening(voter.secretKey, v, vote);
    await withSession((s, a) => call(s, a, createVotingPrivateState(voter.secretKey), 'count', [n, vote, salt]));
  },

  async status() {
    const l = await readLedger();
    const t = BigInt(now());
    const state =
      l.phase === Phase.ENROLMENT
        ? 'enrolment'
        : !l.closedEarly && t < l.deadline
          ? 'voting open'
          : t < l.countingEnds
            ? 'counting'
            : 'final';
    console.log(`Proposal:      ${proposalLabel(l.proposalId)}`);
    console.log(`State:         ${state}${l.closedEarly ? ' (closed early)' : ''}`);
    if (l.phase === Phase.OPEN) {
      console.log(`Deadline:      ${iso(l.deadline)}`);
      console.log(`Counting ends: ${iso(l.countingEnds)}`);
    }
    console.log(`Enrolled:      ${l.enrolled} (check these against the published roster)`);
    for (const k of l.voterKeys) console.log(`  voter key:   ${toHex(k)}`);
    console.log(`Voter root:    ${l.voters.root().field.toString(16)}`);
    console.log(`Admin keys:    ${[...l.adminEncKeys].map(keyFingerprint).join(', ') || 'none'}`);
    console.log(`Cast:          ${l.castCount}`);
    console.log(`Counted:       ${l.counted.size()}`);
    for (const n of uncounted(l)) console.log(`  uncounted:   ${toHex(n)}`);
  },

  async result() {
    const l = await readLedger();
    const final = BigInt(now()) >= l.countingEnds && l.phase === Phase.OPEN;
    console.log(`${proposalLabel(l.proposalId)}: yes ${l.yes}, no ${l.no}, abstain ${l.abstain}`);
    console.log(`  ${uncounted(l).length} cast but uncounted (left out of the result)`);
    console.log(`  ${passes(l) ? 'PASSES' : 'FAILS'} (yes > no)${final ? '' : ' so far; counting is still open'}`);
  },
};

const name = positionals[0] === 'admin' || positionals[0] === 'voter' ? positionals.slice(0, 2).join(' ') : positionals[0];
if (name === 'admin keygen' || name === 'voter keygen' || name === 'voter key') positionals.splice(0, 1);
const cmd = name ? commands[name] : undefined;
if (!cmd) {
  console.log(`Commands: ${Object.keys(commands).join(', ')}. See the header of scripts/cli.ts.`);
  process.exit(name ? 1 : 0);
}
try {
  await cmd();
  process.exit(0);
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
