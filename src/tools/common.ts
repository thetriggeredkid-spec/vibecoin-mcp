import { PublicKey } from "@solana/web3.js";
import path from "node:path";
import { walletExists } from "../keystore.js";

export function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export function errText(e: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

export function defaultWalletName(projectDir?: string): string {
  return path.basename(projectDir ?? process.cwd()).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "default";
}

export function parsePubkey(s: string, label: string): PublicKey {
  try {
    return new PublicKey(s);
  } catch {
    throw new Error(`${label} is not a valid Solana address: ${s}`);
  }
}

export function requireWallet(name: string): void {
  if (!walletExists(name)) {
    throw new Error(
      `wallet "${name}" does not exist yet — run the wallet tool with action "create" first, or let launch auto-create it`,
    );
  }
}

export const APPROVAL_NOTE =
  'Show this preview to the user and get their explicit approval before calling again with confirm: true.';

export function sol(n: number): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`;
}
