import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { executeSwap, quoteSolToUsdc } from "../src/jupiter.js";

function dummyTx(): VersionedTransaction {
  const kp = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: "9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oASxtWWvfrDsn",
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

describe("jupiter client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    delete process.env.JUP_API_KEY;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests an order with the documented query params", async () => {
    const taker = Keypair.generate().publicKey;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transaction: Buffer.from(dummyTx().serialize()).toString("base64"),
        requestId: "req-1",
        outAmount: "12500000",
        feeBps: 2,
        router: "metis",
      }),
    });
    const q = await quoteSolToUsdc({ taker, sol: 0.1 });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://api.jup.ag/swap/v2/order");
    expect(url.searchParams.get("inputMint")).toBe("So11111111111111111111111111111111111111112");
    expect(url.searchParams.get("outputMint")).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(url.searchParams.get("amount")).toBe("100000000");
    expect(url.searchParams.get("taker")).toBe(taker.toBase58());
    expect(q.outUsdcMinor).toBe(12500000);
    expect(q.feeBps).toBe(2);
    // no API key header when env is unset
    expect(fetchMock.mock.calls[0][1].headers["x-api-key"]).toBeUndefined();
  });

  it("throws the API's error message when no route exists", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transaction: "", errorCode: "-1001", errorMessage: "insufficient input" }),
    });
    await expect(quoteSolToUsdc({ taker: Keypair.generate().publicKey, sol: 0.1 })).rejects.toThrow(
      /insufficient input/,
    );
  });

  it("executes a signed swap and reports USDC out", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "Success", signature: "sig123", outputAmountResult: "2500000" }),
    });
    const out = await executeSwap({ signedTx: dummyTx(), requestId: "req-1" });
    expect(out.signature).toBe("sig123");
    expect(out.outUsdc).toBe(2.5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/swap/v2/execute");
    const body = JSON.parse(init.body);
    expect(body.requestId).toBe("req-1");
    expect(typeof body.signedTransaction).toBe("string");
  });

  it("throws on failed execution", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "Failed", error: "slippage exceeded" }),
    });
    await expect(executeSwap({ signedTx: dummyTx(), requestId: "r" })).rejects.toThrow(/slippage exceeded/);
  });
});
