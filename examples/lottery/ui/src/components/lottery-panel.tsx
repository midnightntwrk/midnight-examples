// The lottery, built on the seed `yarn new:ui` generated: step 1 is the
// template's <DeploymentCard> (deploy takes a ticket price and a ticket cap),
// then the lottery itself. Everything the panel decides (organizer or player,
// which tickets are yours, whether you won, which buttons are live and why)
// comes from lotteryView / actionError in @/midnight/lottery-api, which the
// circuits test checks against the real contract.
//
// No secret is ever typed in: the witnesses read this browser's encrypted
// private state. buyTicket gets a fresh random nonce per ticket, and
// claimPrize pays to the wallet's own unshielded address.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeploymentCard } from "@/components/deployment-card";
import { WalletBalancesCard } from "@/components/wallet-balances-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment } from "@/hooks/use-deployment";
import { useWallet } from "@/hooks/use-wallet";
import { walletUserAddress, type UserAddressValue } from "@/lib/addresses";
import { errorMessage } from "@/lib/errors";
import { formatLedgerValue, type LedgerField } from "@/lib/ledger-format";
import { cn } from "@/lib/utils";
import type { Ledger, LotteryPrivateState } from "@/midnight/contract";
import {
  actionError,
  buyTicket,
  claimPrize,
  closeSales,
  deployInputError,
  deployLottery,
  draw,
  joinLottery,
  ledger$,
  LotteryState,
  lotteryView,
  randomNonce,
  readPrivateState,
  UINT16_MAX,
  type LotteryCircuit,
  type LotteryContract,
  type LotteryDeployInput,
  type LotteryView,
} from "@/midnight/lottery-api";

/** Exported ledger fields and how they're stored, from contract-info.json. */
const LEDGER_FIELDS: LedgerField[] = [
  { name: "organizer", storage: "Cell" },
  { name: "seedCommitment", storage: "Cell" },
  { name: "ticketPrice", storage: "Cell" },
  { name: "maxTickets", storage: "Cell" },
  { name: "state", storage: "Cell", enumValues: ["OPEN", "CLOSED", "DRAWN", "PAID"] },
  { name: "tickets", storage: "Map" },
  { name: "ticketCount", storage: "Counter" },
  { name: "pot", storage: "Cell" },
  { name: "entropy", storage: "Cell" },
  { name: "winningTicket", storage: "Cell" },
  { name: "winner", storage: "Cell" },
];

const STATE_LABEL: Record<LotteryState, string> = {
  [LotteryState.OPEN]: "Tickets on sale",
  [LotteryState.CLOSED]: "Sales closed: waiting for the draw",
  [LotteryState.DRAWN]: "Drawn: waiting for the winner to claim",
  [LotteryState.PAID]: "Prize paid",
};

/** The buttons each role sees, in lottery order. */
const ACTIONS: Record<LotteryView["role"], { circuit: LotteryCircuit; label: string }[]> = {
  player: [
    { circuit: "buyTicket", label: "Buy a ticket" },
    { circuit: "claimPrize", label: "Claim the prize" },
  ],
  organizer: [
    { circuit: "closeSales", label: "Close sales" },
    { circuit: "draw", label: "Draw the winner" },
  ],
};

export function LotteryPanel() {
  const deployment = useDeployment<LotteryContract, LotteryDeployInput>({
    deploy: deployLottery,
    // Reuses this browser's stored secrets for the lottery if it has them (a
    // reload, or the organizer coming back to draw); otherwise a fresh player.
    join: (providers, address) => joinLottery(providers, address),
  });
  const { providers, contract, address, busy, error, run } = deployment;
  const { connectedApi, networkId } = useWallet();

  const ledgerObservable = useMemo(
    () => (providers && address ? ledger$(providers, address) : null),
    [providers, address],
  );
  const { state, error: stateError } = useContractState(ledgerObservable);

  // This browser's secrets for the lottery. They only change on deploy/join;
  // re-reading per ledger update is cheap and matches the other panels.
  const [ps, setPs] = useState<LotteryPrivateState | null>(null);
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
  }, [providers, address, contract, state]);

  // The wallet's unshielded address: where claimPrize pays the pot.
  const [me, setMe] = useState<UserAddressValue | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  useEffect(() => {
    if (!connectedApi || !networkId) return;
    let cancelled = false;
    walletUserAddress(connectedApi, networkId)
      .then((a) => {
        if (cancelled) return;
        setMe(a);
        setMeError(null);
      })
      .catch((e: unknown) => !cancelled && setMeError(errorMessage(e, "unknown error")));
    return () => {
      cancelled = true;
    };
  }, [connectedApi, networkId]);

  const view = state && ps && address ? lotteryView(state, address, ps.secretKey) : null;

  const submit = (circuit: LotteryCircuit) =>
    void run(circuit, async () => {
      if (!contract) return;
      switch (circuit) {
        case "buyTicket":
          await buyTicket(contract, randomNonce());
          break;
        case "closeSales":
          await closeSales(contract);
          break;
        case "draw":
          await draw(contract);
          break;
        case "claimPrize":
          if (me) await claimPrize(contract, me);
          break;
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard
        deployment={deployment}
        deployForm={
          <LotteryForm
            busy={busy === "deploying"}
            disabled={busy !== null}
            onSubmit={(input) => void deployment.deploy(input)}
          />
        }
      />

      {providers && address && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. The lottery</CardTitle>
              <CardDescription>
                Tickets are public: anyone can see which player key holds each one. The draw mixes
                the organizer's committed secret seed with every ticket's random nonce, and the
                proof shows it was done honestly without revealing the seed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {state === null || view === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading the lottery...
                </p>
              ) : (
                <>
                  <LotterySummary state={state} view={view} />
                  <div className="flex flex-col gap-3">
                    {ACTIONS[view.role].map(({ circuit, label }) => {
                      const reason =
                        actionError(circuit, state, view) ??
                        (circuit === "claimPrize" && !me
                          ? `Couldn't read your wallet address${meError ? `: ${meError}` : "."}`
                          : null);
                      return (
                        <div key={circuit} className="flex flex-wrap items-center gap-3">
                          <Button
                            onClick={() => submit(circuit)}
                            disabled={busy !== null || !contract || reason !== null}
                          >
                            {busy === circuit && <Loader2 className="animate-spin" />}
                            {label}
                            {circuit === "buyTicket" && ` (${state.ticketPrice} STAR)`}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {reason ?? actionHint(circuit, state)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {stateError && <p className="text-xs text-destructive">{stateError.message}</p>}
            </CardContent>
          </Card>

          {/* busy flips when a call starts and ends, so it doubles as a refresh key. */}
          <WalletBalancesCard title="3. Your wallet" refreshKey={busy} />

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

/** What pressing an enabled button does, beyond its label. */
function actionHint(circuit: LotteryCircuit, state: Ledger): string {
  switch (circuit) {
    case "buyTicket":
      return `Your wallet pays ${state.ticketPrice} STAR into the pot. Buy as many as you like.`;
    case "closeSales":
      return "Stops ticket sales so you can draw.";
    case "draw":
      return "Picks the winning ticket from your committed seed and every ticket's nonce.";
    case "claimPrize":
      return `Sends the whole pot, ${state.pot} STAR, to your wallet's unshielded address.`;
  }
}

function LotterySummary({ state, view }: { state: Ledger; view: LotteryView }) {
  const drawn = state.state === LotteryState.DRAWN || state.state === LotteryState.PAID;
  const you =
    view.role === "organizer"
      ? "You are the organizer. Draw from this browser: it holds the seed."
      : view.won
        ? "Your ticket won!"
        : view.myTickets.length === 0
          ? "You have no tickets."
          : `Your tickets: ${view.myTickets.map((n) => `#${n}`).join(", ")}.`;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{STATE_LABEL[state.state]}</Badge>
        <span>{you}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Tickets sold</dt>
        <dd>
          {state.ticketCount.toString()} of {state.maxTickets.toString()}
        </dd>
        <dt className="text-muted-foreground">Ticket price</dt>
        <dd>{state.ticketPrice.toString()} STAR</dd>
        <dt className="text-muted-foreground">Pot</dt>
        <dd>{state.pot.toString()} STAR</dd>
        {drawn && (
          <>
            <dt className="text-muted-foreground">Winning ticket</dt>
            <dd>#{state.winningTicket.toString()}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Ticket price and cap, pre-checked the way the constructor checks them. */
function LotteryForm(props: { busy: boolean; disabled: boolean; onSubmit: (input: LotteryDeployInput) => void }) {
  const [price, setPrice] = useState("");
  const [max, setMax] = useState("");
  const parse = (t: string) => (/^\d+$/.test(t.trim()) ? BigInt(t.trim()) : null);
  const ticketPrice = parse(price);
  const maxTickets = parse(max);
  const input = ticketPrice !== null && maxTickets !== null ? { price: ticketPrice, maxTickets } : null;
  const reason = input ? deployInputError(input) : null;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (input && reason === null) props.onSubmit(input);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Ticket price"
          inputMode="numeric"
          placeholder="Ticket price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-32"
        />
        <Input
          aria-label="Max tickets"
          inputMode="numeric"
          placeholder="Max tickets"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          className="w-32"
        />
        <Button type="submit" disabled={props.disabled || !input || reason !== null}>
          {props.busy && <Loader2 className="animate-spin" />}
          Deploy new lottery
        </Button>
      </div>
      <p className={cn("text-xs", reason ? "text-destructive" : "text-muted-foreground")}>
        {reason ??
          `Ticket price in STAR (1 NIGHT = 1,000,000 STAR) and how many tickets to sell (2 to ${UINT16_MAX}). ` +
            "You become the organizer: a new secret key and draw seed are kept, encrypted, in this browser. " +
            "Lose them and the lottery can never be drawn."}
      </p>
    </form>
  );
}
