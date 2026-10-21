import { createConfig, http } from "wagmi";
import { getDefaultConfig } from "connectkit";
import { arcTestnet } from "./constants";

// ConnectKit wraps wagmi config; WalletConnect project ID is optional for testnet
// (MetaMask and injected wallets work without it).
export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [arcTestnet],
    transports: { [arcTestnet.id]: http("https://rpc.testnet.arc.io") },
    walletConnectProjectId: (import.meta as { env?: Record<string, string> }).env?.VITE_WC_PROJECT_ID ?? "",
    appName: "Sivan Claim Vault — Arc Testnet",
    appDescription: "Testnet UI for SivanClaimVault v1 on Arc (chain 5042002)",
    appUrl: typeof window !== "undefined" ? window.location.origin : "",
  }),
);
