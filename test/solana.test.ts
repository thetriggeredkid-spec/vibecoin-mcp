import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ataFor,
  buildSolTransfer,
  getUsdcBalance,
} from "../src/solana.js";
import { MINTS } from "../src/config.js";

describe("solana helpers", () => {
  it("derives the canonical associated token account", () => {
    const owner = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
    const mint = new PublicKey(MINTS.USDC);
    const expected = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
    expect(ataFor(owner, mint).toBase58()).toBe(expected.toBase58());
  });

  it("builds a v0 transfer with the right lamports", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fakeConn = {
      getLatestBlockhash: async () => ({ blockhash: "9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oASxtWWvfrDsn", lastValidBlockHeight: 1 }),
    } as unknown as Connection;
    const tx = await buildSolTransfer(fakeConn, from, to, 0.25);
    const msg = tx.message;
    // last instruction is the system transfer
    const ix = msg.compiledInstructions[msg.compiledInstructions.length - 1];
    expect(msg.staticAccountKeys[ix.programIdIndex].equals(SystemProgram.programId)).toBe(true);
    const data = Buffer.from(ix.data);
    expect(data.readUInt32LE(0)).toBe(2); // SystemInstruction::Transfer
    expect(Number(data.readBigUInt64LE(4))).toBe(250000000);
  });

  it("returns 0 USDC when the token account does not exist", async () => {
    const fakeConn = {
      getTokenAccountBalance: async () => {
        throw new Error("could not find account");
      },
    } as unknown as Connection;
    const balance = await getUsdcBalance(fakeConn, Keypair.generate().publicKey);
    expect(balance).toBe(0);
  });
});
