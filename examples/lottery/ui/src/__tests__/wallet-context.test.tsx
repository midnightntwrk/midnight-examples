import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletProvider } from "../providers/wallet-context";
import { useWallet } from "../hooks/use-wallet";
import { WalletWidget } from "../components/wallet-widget";

function TestConsumer() {
  const { status, shieldedAddress, networkId, error, connect, disconnect, setRequestedNetworkId } =
    useWallet();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="address">{shieldedAddress ?? "none"}</span>
      <span data-testid="network">{networkId ?? "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button onClick={() => setRequestedNetworkId("preprod")}>use preprod</button>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
    </div>
  );
}

const win = window as unknown as { midnight?: Record<string, unknown> };

function installWallet(connect: ReturnType<typeof vi.fn>) {
  win.midnight = {
    "5f1c0d3e-uuid": {
      name: "Midnight Wallet",
      apiVersion: "4.0.1",
      icon: "",
      rdns: "com.example.wallet",
      connect,
    },
  };
}

function mockConnectedApi(networkId: string) {
  return {
    getConfiguration: vi.fn().mockResolvedValue({
      indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
      indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
      substrateNodeUri: "http://127.0.0.1:9944",
      networkId,
    }),
    getShieldedAddresses: vi.fn().mockResolvedValue({
      shieldedAddress: "mn_shield-addr_test1abc123",
      shieldedCoinPublicKey: "coinpub",
      shieldedEncryptionPublicKey: "encpub",
    }),
  };
}

function renderWallet() {
  render(
    <WalletProvider>
      <TestConsumer />
      <WalletWidget />
    </WalletProvider>,
  );
}

describe("WalletContext", () => {
  beforeEach(() => {
    localStorage.clear();
    delete win.midnight;
  });

  it("starts disconnected", () => {
    renderWallet();
    expect(screen.getByTestId("status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("reports a missing wallet extension", async () => {
    renderWallet();
    await userEvent.click(screen.getByText("connect"));
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent("No Midnight wallet extension found");
  });

  it("connects with the requested network id and reads the wallet's config", async () => {
    const connect = vi.fn().mockResolvedValue(mockConnectedApi("preprod"));
    installWallet(connect);
    renderWallet();

    await userEvent.click(screen.getByText("use preprod"));
    await userEvent.click(screen.getByText("connect"));

    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));
    expect(connect).toHaveBeenCalledWith("preprod");
    expect(screen.getByTestId("network")).toHaveTextContent("preprod");
    expect(screen.getByTestId("address")).toHaveTextContent("mn_shield-addr_test1abc123");
  });

  it("surfaces DApp Connector errors by their reason", async () => {
    installWallet(
      vi.fn().mockRejectedValue({
        type: "DAppConnectorAPIError",
        code: "Rejected",
        reason: "User rejected the connection",
      }),
    );
    renderWallet();

    await userEvent.click(screen.getByText("connect"));

    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("User rejected the connection (Rejected)");
  });

  // Two wallets plus an alias of the second, in `window.midnight` order. No
  // vendor is preferred: the first one found is the default.
  function installTwoWallets() {
    const a = {
      name: "Wallet A",
      apiVersion: "4.0.1",
      icon: "",
      rdns: "com.example.a",
      connect: vi.fn().mockResolvedValue(mockConnectedApi("undeployed")),
    };
    const b = {
      name: "Wallet B",
      apiVersion: "4.0.1",
      icon: "",
      rdns: "com.example.b",
      connect: vi.fn().mockResolvedValue(mockConnectedApi("undeployed")),
    };
    win.midnight = {
      "a-uuid": a,
      "b-uuid": b,
      bAlias: b, // alias pointing at the same object
    };
    return { a, b };
  }

  it("defaults to the first wallet found when several are installed, and dedupes aliases", async () => {
    const { a, b } = installTwoWallets();
    renderWallet();

    const picker = await screen.findByLabelText("Wallet");
    expect(picker).toHaveValue("a-uuid");
    expect(picker.querySelectorAll("option")).toHaveLength(2);

    await userEvent.click(screen.getByText("connect"));
    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));
    expect(a.connect).toHaveBeenCalledWith("undeployed");
    expect(b.connect).not.toHaveBeenCalled();
  });

  it("connects to the wallet the user picked, and remembers the pick", async () => {
    const { a, b } = installTwoWallets();
    const { unmount } = render(
      <WalletProvider>
        <TestConsumer />
        <WalletWidget />
      </WalletProvider>,
    );

    await userEvent.selectOptions(await screen.findByLabelText("Wallet"), "b-uuid");
    await userEvent.click(screen.getByText("connect"));
    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));
    expect(b.connect).toHaveBeenCalledWith("undeployed");
    expect(a.connect).not.toHaveBeenCalled();

    // A fresh page load (disconnected first, so it doesn't auto-connect)
    // starts from the remembered pick, not the first wallet found.
    await userEvent.click(screen.getByText("disconnect"));
    unmount();
    renderWallet();
    expect(await screen.findByLabelText("Wallet")).toHaveValue("b-uuid");
  });

  it("disconnects and clears state", async () => {
    installWallet(vi.fn().mockResolvedValue(mockConnectedApi("undeployed")));
    renderWallet();
    await userEvent.click(screen.getByText("connect"));
    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));

    await userEvent.click(screen.getByText("disconnect"));

    expect(screen.getByTestId("status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });
});
