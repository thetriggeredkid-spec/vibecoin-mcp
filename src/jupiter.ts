import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ENDPOINTS, MINTS } from "./config.js";

export interface SwapQuote {
  requestId: string;
  txBase64: string;
  inLamports: number;
  outUsdcMinor: number;
  feeBps: number;
  router: string;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const key = process.env.JUP_API_KEY;
  if (key && key.length > 0) h["x-api-key"] = key;
  return h;
}

export async function quoteSolToUsdc(args: {
  taker: PublicKey;
  sol: number;
  slippageBps?: number;
}): Promise<SwapQuote> {
  const lamports = Math.floor(args.sol * 1e9);
  const params = new URLSearchParams({
    inputMint: MINTS.SOL,
    outputMint: MINTS.USDC,
    amount: String(lamports),
    taker: args.taker.toBase58(),
    slippageBps: String(args.slippageBps ?? 100),
  });
  const res = await fetch(`${ENDPOINTS.jupiterOrder}?${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`Jupiter order failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as {
    transaction?: string;
    requestId?: string;
    outAmount?: string;
    feeBps?: number;
    router?: string;
    errorCode?: string;
    errorMessage?: string;
  };
  if (!body.transaction || body.transaction === "") {
    throw new Error(`Jupiter could not build a swap: ${body.errorCode ?? ""} ${body.errorMessage ?? "no route"}`);
  }
  return {
    requestId: body.requestId ?? "",
    txBase64: body.transaction,
    inLamports: lamports,
    outUsdcMinor: Number(body.outAmount ?? 0),
    feeBps: body.feeBps ?? 0,
    router: body.router ?? "unknown",
  };
}

export async function executeSwap(args: {
  signedTx: VersionedTransaction;
  requestId: string;
}): Promise<{ signature: string; outUsdc: number }> {
  const res = await fetch(ENDPOINTS.jupiterExecute, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      signedTransaction: Buffer.from(args.signedTx.serialize()).toString("base64"),
      requestId: args.requestId,
    }),
  });
  const body = (await res.json()) as {
    status?: string;
    signature?: string;
    error?: string;
    totalOutputAmount?: string;
    outputAmountResult?: string;
  };
  if (body.status !== "Success") {
    throw new Error(`Jupiter swap failed: ${body.error ?? body.status ?? res.statusText}`);
  }
  const out = Number(body.outputAmountResult ?? body.totalOutputAmount ?? 0);
  return { signature: body.signature ?? "", outUsdc: out / 1e6 };
}
