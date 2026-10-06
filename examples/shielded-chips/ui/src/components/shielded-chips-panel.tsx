// Shielded-chips roulette, built on the seed `yarn new:ui` generated for the
// roulette contract. It plays the round the Node test plays
// (src/test/roulette.test.ts), with the house in one browser profile and each
// player in their own:
//
//   house   deploy chips → deploy a table (winning number committed) →
//           mint chips to players' shielded addresses → deposit match coins →
//           reveal → sweep the pool
//   player  share shielded address → bet RED/BLACK → claim 2x or forfeit
//
// The chips token is the example's second contract. Its providers come from
// useMidnightProviders().providersFor, and its address is kept here (the
// template's useDeployment remembers only the table's). Everything the panel
// decides (role, what each player may do, the winning number) comes from the
// pure helpers in @/midnight/shielded-chips-api, which the circuits test
// checks against the real contracts.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeploymentCard } from "@/components/deployment-card";
import { WalletBalancesCard } from "@/components/wallet-balances-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment, type Deployment } from "@/hooks/use-deployment";
import { useWallet } from "@/hooks/use-wallet";
import { formatLedgerValue, type LedgerField } from "@/lib/ledger-format";
import { storage } from "@/lib/storage";
import type { Ledger, ShieldedChipsPrivateState } from "@/midnight/contract";
import { useMidnightProviders } from "@/providers/midnight-providers";
import {
  actionError,
  burnChips,
  burnFromTreasury,
  CHIPS_ZK_ASSETS_PATH,
  chipColor,
  chipsLedger$,
  claimWinnings,
  Color,
  colorOf,
  deployChips,
  deployShieldedChips,
  escrowRecorded,
  forfeit,
  houseClaimMatch,
  houseDeposit,
  joinShieldedChips,
  ledger$,
  matchKeyFor,
  MAX_NUMBER,
  mintChips,
  mintToTreasury,
  parseAmount,
  parseNumber,
  placeBet,
  playerView,
  randomBytes32,
  readHouseSecret,
  readPrivateState,
  recipientFromAddress,
  recoverWinningNumber,
  revealWinningNumber,
  roleOf,
  BetState,
  type ChipsCircuits,
  type ChipsProviders,
  type ShieldedChipsContract,
} from "@/midnight/shielded-chips-api";

/** Exported ledger fields and how they're stored, from contract-info.json. */
const LEDGER_FIELDS: LedgerField[] = [
  { name: "theHouse", storage: "Cell" },
  { name: "chipColor", storage: "Cell" },
  { name: "winningNumHash", storage: "Cell" },
  { name: "betState", storage: "Cell", enumValues: ["CLOSED", "OPEN"] },
  { name: "winningColor", storage: "Cell", enumValues: ["GREEN", "RED", "BLACK"] },
  { name: "bets", storage: "Map" },
  { name: "betCommits", storage: "Map" },
  { name: "betValues", storage: "Map" },
  { name: "paidWinners", storage: "Set" },
  { name: "houseCoins", storage: "Map" },
];

const COLOR_NAMES = ["GREEN", "RED", "BLACK"] as const;
const CHIPS_KEY_PREFIX = "shielded-chips-ui:chips-address:";

/** What the house's deploy form collects; the house key is read from the chips token's state. */
interface TableInput {
  chipsAddress: string;
  winningNumber: bigint;
}

type TableDeployment = Deployment<ShieldedChipsContract, TableInput>;
type Run = TableDeployment["run"];

/** The chips contract's providers bundle, rebuilt with the table's. */
function useChipsProviders(): ChipsProviders | null {
  const { providersFor } = useMidnightProviders();
  const [chipsProviders, setChipsProviders] = useState<ChipsProviders | null>(null);
  useEffect(() => {
    setChipsProviders(null);
    if (!providersFor) return;
    let cancelled = false;
    providersFor<ChipsCircuits>(CHIPS_ZK_ASSETS_PATH)
      .then((p) => !cancelled && setChipsProviders(p))
      .catch(() => !cancelled && setChipsProviders(null));
    return () => {
      cancelled = true;
    };
  }, [providersFor]);
  return chipsProviders;
}

/** The house's chips contract address on this network, kept in localStorage. */
function useChipsAddress(networkId: string | null) {
  const key = `${CHIPS_KEY_PREFIX}${networkId ?? "unknown"}`;
  const [address, setAddress] = useState<string | null>(() => storage.get(key));
  useEffect(() => setAddress(storage.get(key)), [key]);
  return {
    address,
    remember: (a: string) => {
      storage.set(key, a);
      setAddress(a);
    },
    forget: () => {
      storage.remove(key);
      setAddress(null);
    },
  };
}

export function ShieldedChipsPanel() {
  const chipsProviders = useChipsProviders();
  const deployment = useDeployment<ShieldedChipsContract, TableInput>({
    // The table is deployed with the house key the chips token was deployed
    // with, so both contracts know the same house.
    deploy: async (providers, { chipsAddress, winningNumber }) => {
      if (!chipsProviders) throw new Error("The chips token's providers aren't ready yet.");
      const sk = await readHouseSecret(chipsProviders, chipsAddress);
      if (!sk) throw new Error("This browser didn't deploy that chips token, so it has no house key for it.");
      return deployShieldedChips(providers, { sk, chipColor: chipColor(chipsAddress).bytes, winningNumber });
    },
    // Reuses this browser's stored private state for the table if it has one
    // (a reload, or the house coming back); otherwise a new player's key.
    join: joinShieldedChips,
  });
  const { providers, contract, address, busy, error, run, networkId } = deployment;
  const chips = useChipsAddress(networkId);

  const ledgerObservable = useMemo(
    () => (providers && address ? ledger$(providers, address) : null),
    [providers, address],
  );
  const { state, error: stateError } = useContractState(ledgerObservable);

  // This browser's private state. Re-read on every ledger update and after
  // each call: placeBet writes the escrow, and midnight-js stores a call's
  // resulting state once the tx is final.
  const [ps, setPs] = useState<ShieldedChipsPrivateState | null>(null);
  useEffect(() => {
    if (!providers || !address || !contract) {
      setPs(null);
      return;
    }
    let cancelled = false;
    readPrivateState(providers, address)
      .then((p) => !cancelled && setPs(p))
      .catch(() => !cancelled && setPs(null));
    return () => {
      cancelled = true;
    };
  }, [providers, address, contract, state, busy]);

  const role = state ? roleOf(state, ps) : null;
  const colorHex = state ? toHex(state.chipColor) : null;

  return (
    <div className="flex flex-col gap-6">
      {networkId === "mainnet" && <MainnetNote />}

      <DeploymentCard
        deployment={deployment}
        deployForm={
          <HouseSetup
            chipsProviders={chipsProviders}
            chips={chips}
            busy={busy}
            run={run}
            onDeploy={(input) => void deployment.deploy(input)}
          />
        }
      />

      <ShareAddressCard />

      {providers && address && (
        <>
          <WalletBalancesCard
            title="Your chips"
            description="Your wallet's balances. Chips are a shielded token: only you (and the house, for the coins it minted you) can see them."
            labels={colorHex ? { [colorHex]: "CHIP" } : {}}
            refreshKey={busy}
          />

          {state === null || role === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading the table...
            </p>
          ) : role === "house" ? (
            <>
              <HouseCard
                state={state}
                ps={ps!}
                contract={contract}
                colorHex={colorHex!}
                chipsProviders={chipsProviders}
                chipsAddress={chips.address}
                busy={busy}
                run={run}
              />
              <TokenAdminCard
                chipsProviders={chipsProviders}
                chipsAddress={chips.address}
                colorHex={colorHex!}
                busy={busy}
                run={run}
              />
            </>
          ) : (
            <PlayerCard
              state={state}
              ps={ps!}
              deployment={deployment}
              colorHex={colorHex!}
            />
          )}
          {stateError && <p className="text-xs text-destructive">{stateError.message}</p>}

          {state && (
            <details className="rounded-md border px-4 py-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Raw public ledger</summary>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {LEDGER_FIELDS.map((field) => (
                  <div key={field.name} className="contents">
                    <dt className="font-mono text-muted-foreground">{field.name}</dt>
                    <dd className="break-all font-mono">
                      {formatLedgerValue(field, state[field.name as keyof Ledger])}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function MainnetNote() {
  return (
    <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
      <strong>Mainnet.</strong> Every deploy and call spends real DUST, and everything on the
      ledger is public and permanent. Chips have no value. Use small amounts; a table plays one
      round.
    </p>
  );
}

/** Deploy form for the house: the chips token first, then a table bound to its color. */
function HouseSetup(props: {
  chipsProviders: ChipsProviders | null;
  chips: ReturnType<typeof useChipsAddress>;
  busy: string | null;
  run: Run;
  onDeploy: (input: TableInput) => void;
}) {
  const { chipsProviders, chips, busy, run, onDeploy } = props;
  const [number, setNumber] = useState(() => randomNumber().toString());
  const parsed = parseNumber(number);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        Players: paste the house's table address below to join. The house deploys:
      </p>
      <div className="flex flex-col gap-2">
        <span className="font-medium">a. The chips token</span>
        {chips.address ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1">{chips.address}</code>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={chips.forget}>
              Use a new one
            </Button>
          </div>
        ) : (
          <div>
            <Button
              disabled={busy !== null || !chipsProviders}
              onClick={() =>
                void run("deploying chips", async () => {
                  if (!chipsProviders) return;
                  chips.remember(await deployChips(chipsProviders, randomBytes32()));
                })
              }
            >
              {busy === "deploying chips" && <Loader2 className="animate-spin" />}
              Deploy chips token
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium">b. A table, with its winning number</span>
        <p className="text-muted-foreground">
          Only a hash of the number and the house's key goes on chain. This browser recovers the
          number from its key when you reveal.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-24"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            aria-label="Winning number"
          />
          <Button variant="outline" size="sm" onClick={() => setNumber(randomNumber().toString())}>
            Random
          </Button>
          <span className="text-muted-foreground">
            {parsed === null ? `0 to ${MAX_NUMBER}` : COLOR_NAMES[colorOf(parsed)]}
          </span>
          <Button
            disabled={busy !== null || !chips.address || !chipsProviders || parsed === null}
            onClick={() =>
              chips.address && parsed !== null && onDeploy({ chipsAddress: chips.address, winningNumber: parsed })
            }
          >
            {busy === "deploying" && <Loader2 className="animate-spin" />}
            Deploy table
          </Button>
        </div>
      </div>
    </div>
  );
}

/** What a player sends the house so it can mint them chips. */
function ShareAddressCard() {
  const { shieldedAddress } = useWallet();
  if (!shieldedAddress) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your shielded address</CardTitle>
        <CardDescription>
          Players: send this to the house, which mints your chips to it. It carries your coin key
          and the encryption key your wallet needs to find the coin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CopyLine value={shieldedAddress} />
      </CardContent>
    </Card>
  );
}

function HouseCard(props: {
  state: Ledger;
  ps: ShieldedChipsPrivateState;
  contract: ShieldedChipsContract | null;
  colorHex: string;
  chipsProviders: ChipsProviders | null;
  chipsAddress: string | null;
  busy: string | null;
  run: Run;
}) {
  const { state, ps, contract, colorHex, chipsProviders, chipsAddress, busy, run } = props;
  const { networkId, shieldedAddress } = useWallet();
  const [mintTo, setMintTo] = useState("");
  const [mintAmount, setMintAmount] = useState("100");
  const [depositAmount, setDepositAmount] = useState("100");
  const disabled = busy !== null || !contract;
  const winning = recoverWinningNumber(state, ps.sk);
  // The table's chips token, if it's the one this browser remembers.
  const chipsOk = chipsAddress !== null && chipColor(chipsAddress).hex === colorHex;
  const open = state.betState === BetState.OPEN;

  return (
    <Card>
      <CardHeader>
        <CardTitle>The house</CardTitle>
        <CardDescription>
          {open ? "Betting is open." : `Revealed: ${COLOR_NAMES[state.winningColor]}.`}{" "}
          {state.betCommits.size().toString()} bet(s) in escrow,{" "}
          {state.houseCoins.size().toString()} coin(s) in the pool.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <Section title="Mint chips">
          {chipsOk ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-0 flex-1"
                  placeholder="mn_shield-addr_…"
                  value={mintTo}
                  onChange={(e) => setMintTo(e.target.value)}
                  aria-label="Recipient shielded address"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!shieldedAddress}
                  onClick={() => shieldedAddress && setMintTo(shieldedAddress)}
                >
                  Me
                </Button>
              </div>
              <AmountAction
                amount={mintAmount}
                setAmount={setMintAmount}
                label="Mint"
                busy={busy === "minting"}
                disabled={disabled || !chipsProviders || mintTo.trim() === ""}
                onClick={(amount) =>
                  void run("minting", async () => {
                    if (!chipsProviders || !chipsAddress || !networkId) return;
                    const recipient = recipientFromAddress(mintTo, networkId);
                    await mintChips(chipsProviders, chipsAddress, recipient, amount);
                  })
                }
              />
            </>
          ) : (
            <p className="text-muted-foreground">
              This browser doesn't hold the chips token for this table, so it can't mint.
            </p>
          )}
        </Section>

        <Section title="Deposit a match coin">
          <p className="text-muted-foreground">
            Each winner is paid their bet plus one pool coin of the same value. Your wallet funds it
            from the chips it holds.
          </p>
          <AmountAction
            amount={depositAmount}
            setAmount={setDepositAmount}
            label="Deposit"
            busy={busy === "depositing"}
            disabled={disabled}
            onClick={(amount) =>
              void run("depositing", async () => {
                if (contract) await houseDeposit(contract, colorHex, amount);
              })
            }
          />
        </Section>

        <Section title="Reveal">
          {winning === null ? (
            <p className="text-destructive">This browser's key doesn't open the committed number.</p>
          ) : open ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Committed number: <strong>{winning.toString()}</strong> ({COLOR_NAMES[colorOf(winning)]})
              </span>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void run("revealing", async () => {
                    if (contract) await revealWinningNumber(contract, winning);
                  })
                }
              >
                {busy === "revealing" && <Loader2 className="animate-spin" />}
                Reveal and close betting
              </Button>
            </div>
          ) : (
            <p>
              Revealed {winning.toString()} ({COLOR_NAMES[state.winningColor]}).
            </p>
          )}
        </Section>

        <Section title="Pool">
          {state.houseCoins.isEmpty() ? (
            <p className="text-muted-foreground">Empty.</p>
          ) : (
            <>
              {open && (
                <p className="text-muted-foreground">
                  Sweeping before the reveal leaves winners nothing to claim.
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {[...state.houseCoins].map(([key, coin]) => (
                  <li key={toHex(key)} className="flex flex-wrap items-center gap-2">
                    <span>{coin.value.toString()} chips</span>
                    <code className="text-xs text-muted-foreground">{toHex(key).slice(0, 12)}…</code>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        void run("sweeping", async () => {
                          if (contract) await houseClaimMatch(contract, key);
                        })
                      }
                    >
                      Sweep to my wallet
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

/** MIP-0011 metadata, supply, and the house's burn and treasury circuits. */
function TokenAdminCard(props: {
  chipsProviders: ChipsProviders | null;
  chipsAddress: string | null;
  colorHex: string;
  busy: string | null;
  run: Run;
}) {
  const { chipsProviders, chipsAddress, colorHex, busy, run } = props;
  const observable = useMemo(
    () =>
      chipsProviders && chipsAddress && chipColor(chipsAddress).hex === colorHex
        ? chipsLedger$(chipsProviders, chipsAddress)
        : null,
    [chipsProviders, chipsAddress, colorHex],
  );
  const { state } = useContractState(observable);
  const [burnAmount, setBurnAmount] = useState("10");
  const [treasuryAmount, setTreasuryAmount] = useState("10");
  const [treasuryBurn, setTreasuryBurn] = useState("5");
  if (!observable) return null;
  const disabled = busy !== null || !chipsProviders || !chipsAddress;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chips token</CardTitle>
        <CardDescription className="break-all">{chipsAddress}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {state === null ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Token</dt>
            <dd>
              {state._name} ({state._symbol}), {state._decimals.toString()} decimals
            </dd>
            <dt className="text-muted-foreground">Minted / burned</dt>
            <dd>
              {state._totalMinted.toString()} / {state._totalBurned.toString()} (supply{" "}
              {(state._totalMinted - state._totalBurned).toString()})
            </dd>
            <dt className="text-muted-foreground">Color</dt>
            <dd className="break-all font-mono text-xs">{colorHex}</dd>
          </dl>
        )}

        <Section title="Burn from my wallet">
          <AmountAction
            amount={burnAmount}
            setAmount={setBurnAmount}
            label="Burn"
            busy={busy === "burning"}
            disabled={disabled}
            onClick={(amount) =>
              void run("burning", async () => {
                if (chipsProviders && chipsAddress)
                  await burnChips(chipsProviders, chipsAddress, colorHex, amount);
              })
            }
          />
        </Section>

        <Section title="Treasury">
          <AmountAction
            amount={treasuryAmount}
            setAmount={setTreasuryAmount}
            label="Mint to treasury"
            busy={busy === "minting to treasury"}
            disabled={disabled}
            onClick={(amount) =>
              void run("minting to treasury", async () => {
                if (chipsProviders && chipsAddress)
                  await mintToTreasury(chipsProviders, chipsAddress, amount);
              })
            }
          />
          {state && !state._treasury.isEmpty() && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Burn amount</span>
                <Input
                  className="w-28"
                  value={treasuryBurn}
                  onChange={(e) => setTreasuryBurn(e.target.value)}
                  aria-label="Treasury burn amount"
                />
              </div>
              <ul className="flex flex-col gap-1">
                {[...state._treasury].map(([key, coin]) => {
                  const amount = parseAmount(treasuryBurn);
                  return (
                    <li key={toHex(key)} className="flex flex-wrap items-center gap-2">
                      <span>{coin.value.toString()} chips</span>
                      <code className="text-xs text-muted-foreground">{toHex(key).slice(0, 12)}…</code>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled || amount === null || amount > coin.value}
                        onClick={() =>
                          void run("burning from treasury", async () => {
                            if (chipsProviders && chipsAddress && amount !== null)
                              await burnFromTreasury(chipsProviders, chipsAddress, key, amount);
                          })
                        }
                      >
                        Burn {amount?.toString() ?? "?"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function PlayerCard(props: {
  state: Ledger;
  ps: ShieldedChipsPrivateState;
  deployment: TableDeployment;
  colorHex: string;
}) {
  const { state, ps, deployment, colorHex } = props;
  const { providers, contract, address, busy, run } = deployment;
  const { connectedApi } = useWallet();
  const [amount, setAmount] = useState("100");
  const view = playerView(state, ps);
  const recorded = escrowRecorded(ps);
  const disabled = busy !== null || !contract;
  const value = parseAmount(amount);
  const open = state.betState === BetState.OPEN;

  const bet = (color: Color) =>
    void run("betting", async () => {
      if (!contract || !providers || !address || !connectedApi || value === null) return;
      const { indexerUri } = await connectedApi.getConfiguration();
      await placeBet(contract, providers, address, indexerUri, colorHex, value, color);
    });

  const claimError = actionError("claim", state, ps, { escrowRecorded: recorded });
  const forfeitError = actionError("forfeit", state, ps, { escrowRecorded: recorded });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your bet</CardTitle>
        <CardDescription>
          Your key for this table and your escrowed coin stay in this browser, encrypted. The table
          only holds a salted commitment to the coin, so nobody else can claim it, and nobody can
          link it to your wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {view.bet === null ? (
          open ? (
            <>
              <AmountInput amount={amount} setAmount={setAmount} label="Bet amount" />
              <div className="flex flex-wrap gap-2">
                {[Color.RED, Color.BLACK].map((c) => {
                  const reason = value === null ? "Enter a whole number of chips" : actionError("bet", state, ps, { betColor: c });
                  return (
                    <Button
                      key={c}
                      variant={c === Color.RED ? "destructive" : "default"}
                      disabled={disabled || reason !== null}
                      title={reason ?? undefined}
                      onClick={() => bet(c)}
                    >
                      {busy === "betting" && <Loader2 className="animate-spin" />}
                      Bet {value?.toString() ?? "?"} on {COLOR_NAMES[c]}
                    </Button>
                  );
                })}
              </div>
              <p className="text-muted-foreground">
                One bet per player. Your wallet pays it from the chips it holds.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Betting is closed, and you didn't bet.</p>
          )
        ) : (
          <>
            <p>
              You bet{view.escrowValue !== null ? ` ${view.escrowValue.toString()} chips` : ""} on{" "}
              <strong>{COLOR_NAMES[view.bet]}</strong>.{" "}
              {open
                ? "Waiting for the house to reveal."
                : `The result is ${COLOR_NAMES[state.winningColor]}.`}
            </p>
            {!recorded && !view.paid && view.escrowValue !== null && (
              <p className="text-destructive">
                This browser has no Merkle index for your escrowed coin, so it can't claim or forfeit.
                The bet was placed from another browser, or the page closed right after betting.
              </p>
            )}
            {view.paid && <p>Paid. The 2x payout is in your wallet.</p>}
            {!open && !view.paid && (
              <div className="flex flex-wrap gap-2">
                {view.bet === state.winningColor ? (
                  <Button
                    disabled={disabled || claimError !== null}
                    title={claimError ?? undefined}
                    onClick={() =>
                      void run("claiming", async () => {
                        const key = view.escrowValue === null ? null : matchKeyFor(state, view.escrowValue);
                        if (contract && key) await claimWinnings(contract, key);
                      })
                    }
                  >
                    {busy === "claiming" && <Loader2 className="animate-spin" />}
                    Claim 2x
                  </Button>
                ) : (
                  view.escrowValue !== null && (
                    <Button
                      variant="outline"
                      disabled={disabled || forfeitError !== null}
                      title={forfeitError ?? undefined}
                      onClick={() =>
                        void run("forfeiting", async () => {
                          if (contract) await forfeit(contract);
                        })
                      }
                    >
                      {busy === "forfeiting" && <Loader2 className="animate-spin" />}
                      Forfeit to the house
                    </Button>
                  )
                )}
                {(view.bet === state.winningColor ? claimError : forfeitError) && (
                  <span className="text-muted-foreground">
                    {view.bet === state.winningColor ? claimError : forfeitError}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- small pieces --------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">{title}</span>
      {children}
    </div>
  );
}

function AmountInput(props: { amount: string; setAmount: (v: string) => void; label: string }) {
  return (
    <Input
      className="w-28"
      value={props.amount}
      onChange={(e) => props.setAmount(e.target.value)}
      aria-label={props.label}
    />
  );
}

function AmountAction(props: {
  amount: string;
  setAmount: (v: string) => void;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: (amount: bigint) => void;
}) {
  const value = parseAmount(props.amount);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AmountInput amount={props.amount} setAmount={props.setAmount} label={`${props.label} amount`} />
      <Button
        size="sm"
        disabled={props.disabled || value === null}
        onClick={() => value !== null && props.onClick(value)}
      >
        {props.busy && <Loader2 className="animate-spin" />}
        {props.label} {value?.toString() ?? ""}
      </Button>
      {value === null && <span className="text-muted-foreground">Enter a whole number of chips.</span>}
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{value}</code>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy"
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        <Copy />
      </Button>
    </div>
  );
}

function randomNumber(): bigint {
  // Rejection sampling keeps every number equally likely.
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < 37 * 6) return BigInt(buf[0]! % 37);
  }
}
