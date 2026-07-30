import type { Keypair } from "@solana/web3.js";
import { ENDPOINTS } from "./config.js";

export interface LockPlan {
  recipient: string;
  tokenId: string;
  start: number;
  cliff: number;
  amountRaw: bigint;
  cliffAmountRaw: bigint;
  period: number;
  amountPerPeriodRaw: bigint;
  name: string;
  unlockDate: string;
}

/**
 * Streamflow's documented irrevocable token-lock recipe:
 * start == cliff == unlock time, cliffAmount = amount - 1, period 1s releasing 1 raw unit,
 * every cancel/transfer/topup flag off.
 */
export function buildLockPlan(args: {
  mint: string;
  recipient: string;
  uiAmount: number;
  decimals: number;
  days: number;
  label: string;
  now?: number;
}): LockPlan {
  if (args.uiAmount <= 0) throw new Error("lock amount must be positive");
  if (args.days < 1) throw new Error("lock duration must be at least 1 day");
  const unlockTs = Math.floor((args.now ?? Date.now()) / 1000) + Math.round(args.days * 86400);
  const raw = BigInt(Math.floor(args.uiAmount * 10 ** args.decimals));
  if (raw <= 1n) throw new Error("lock amount is too small");
  return {
    recipient: args.recipient,
    tokenId: args.mint,
    start: unlockTs,
    cliff: unlockTs,
    amountRaw: raw,
    cliffAmountRaw: raw - 1n,
    period: 1,
    amountPerPeriodRaw: 1n,
    name: args.label.slice(0, 60),
    unlockDate: new Date(unlockTs * 1000).toISOString().slice(0, 10),
  };
}

export const LOCK_PROOF_URL = (metadataId: string) =>
  `https://app.streamflow.finance/contract/solana/mainnet/${metadataId}`;

/** Executes the lock via the Streamflow SDK (loaded lazily so the server starts fast). */
export async function executeLock(plan: LockPlan, sender: Keypair): Promise<{ txId: string; metadataId: string }> {
  let sdk: any;
  let BN: any;
  try {
    sdk = await import("@streamflow/stream");
    BN = (await import("bn.js")).default;
  } catch (e) {
    throw new Error(
      "the @streamflow/stream SDK is not installed or failed to load — reinstall vibecoin-mcp, or lock manually at https://app.streamflow.finance",
    );
  }
  const client = new sdk.StreamflowSolana.SolanaStreamClient(ENDPOINTS.rpc);
  const data = {
    recipient: plan.recipient,
    tokenId: plan.tokenId,
    start: plan.start,
    cliff: plan.cliff,
    amount: new BN(plan.amountRaw.toString()),
    cliffAmount: new BN(plan.cliffAmountRaw.toString()),
    period: plan.period,
    amountPerPeriod: new BN(plan.amountPerPeriodRaw.toString()),
    name: plan.name,
    canTopup: false,
    cancelableBySender: false,
    cancelableByRecipient: false,
    transferableBySender: false,
    transferableByRecipient: false,
    automaticWithdrawal: false,
  };
  const res = await client.create(data, { sender });
  return { txId: res.txId, metadataId: res.metadataId };
}
