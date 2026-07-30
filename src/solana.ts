import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ENDPOINTS, MINTS } from "./config.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function getConnection(): Connection {
  return new Connection(ENDPOINTS.rpc, "confirmed");
}

export function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

export async function getSolBalance(conn: Connection, pubkey: PublicKey): Promise<number> {
  const lamports = await conn.getBalance(pubkey);
  return lamports / 1e9;
}

export async function getTokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  try {
    const res = await conn.getTokenAccountBalance(ataFor(owner, mint));
    return res.value.uiAmount ?? 0;
  } catch {
    // No token account yet — balance is zero.
    return 0;
  }
}

export async function getUsdcBalance(conn: Connection, owner: PublicKey): Promise<number> {
  return getTokenBalance(conn, owner, new PublicKey(MINTS.USDC));
}

export async function buildSolTransfer(
  conn: Connection,
  from: PublicKey,
  to: PublicKey,
  sol: number,
): Promise<VersionedTransaction> {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }),
      SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Math.round(sol * 1e9) }),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export async function sendSigned(conn: Connection, tx: VersionedTransaction): Promise<string> {
  const signature = await conn.sendTransaction(tx, { maxRetries: 3 });
  const latest = await conn.getLatestBlockhash("confirmed");
  const conf = await conn.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`transaction ${signature} failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }
  return signature;
}

export async function simulate(
  conn: Connection,
  tx: VersionedTransaction,
): Promise<{ ok: boolean; logs: string[]; err?: string }> {
  const res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  return {
    ok: res.value.err === null,
    logs: res.value.logs ?? [],
    err: res.value.err === null ? undefined : JSON.stringify(res.value.err),
  };
}

export const EXPLORER = {
  tx: (sig: string) => `https://solscan.io/tx/${sig}`,
  addr: (a: string) => `https://solscan.io/account/${a}`,
  token: (m: string) => `https://solscan.io/token/${m}`,
};

export function keypairFromSecret(secret: Uint8Array): Keypair {
  return Keypair.fromSecretKey(secret);
}
