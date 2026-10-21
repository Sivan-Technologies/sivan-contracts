import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { ConnectKitProvider } from "connectkit";
import { Toaster } from "sonner";
import { wagmiConfig } from "./lib/wagmiConfig";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchInterval: 15_000 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="soft"
          customTheme={{
            "--ck-font-family": '"DM Sans", sans-serif',
            "--ck-border-radius": "14px",
            "--ck-connectbutton-background": "#0f1f3d",
            "--ck-connectbutton-color": "#fff",
            "--ck-connectbutton-hover-background": "#1a3260",
          }}
        >
          <App />
          <Toaster richColors position="top-right" />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
