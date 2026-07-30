import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCollectCreatorFeeTx, buildCreateTx, uploadMetadata } from "../src/pumpportal.js";

function dummySerializedTx(): Uint8Array {
  const kp = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: "9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oASxtWWvfrDsn",
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return new VersionedTransaction(msg).serialize();
}

describe("pumpportal client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    delete process.env.PINATA_JWT;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("builds a create tx with the exact documented body", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      arrayBuffer: async () => dummySerializedTx().buffer,
    });
    const creator = Keypair.generate();
    const mint = Keypair.generate();
    const tx = await buildCreateTx({
      creator: creator.publicKey,
      mintPubkey: mint.publicKey,
      meta: { name: "Test App", symbol: "TEST" },
      metadataUri: "https://vibecoin.fun/m/abc.json",
      devBuySol: 0.001,
    });
    expect(tx).toBeInstanceOf(VersionedTransaction);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://pumpportal.fun/api/trade-local");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      publicKey: creator.publicKey.toBase58(),
      action: "create",
      tokenMetadata: { name: "Test App", symbol: "TEST", uri: "https://vibecoin.fun/m/abc.json" },
      mint: mint.publicKey.toBase58(),
      denominatedInSol: "true",
      amount: 0.001,
      slippage: 10,
      priorityFee: 0.00005,
      pool: "pump",
    });
  });

  it("builds a collectCreatorFee tx with the minimal documented body", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      arrayBuffer: async () => dummySerializedTx().buffer,
    });
    const creator = Keypair.generate();
    await buildCollectCreatorFeeTx({ creator: creator.publicKey, priorityFee: 0.000001 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      publicKey: creator.publicKey.toBase58(),
      action: "collectCreatorFee",
      priorityFee: 0.000001,
    });
  });

  it("throws a useful error on non-200", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 400,
      ok: false,
      statusText: "Bad Request",
      text: async () => "invalid mint",
    });
    await expect(
      buildCollectCreatorFeeTx({ creator: Keypair.generate().publicKey }),
    ).rejects.toThrow(/collectCreatorFee failed: 400 Bad Request invalid mint/);
  });

  it("uploads metadata via the hosted endpoint by default", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-img-"));
    const img = path.join(tmp, "logo.png");
    fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ metadataUri: "https://vibecoin.fun/m/1.json", imageUri: "https://vibecoin.fun/m/1.png" }),
    });
    const out = await uploadMetadata({
      name: "Test App",
      symbol: "TEST",
      description: "A test",
      imagePath: img,
      website: "https://example.com",
      github: "https://github.com/u/r",
    });
    expect(out.metadataUri).toBe("https://vibecoin.fun/m/1.json");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://vibecoin.fun/api/metadata");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Test App");
    expect(body.github).toBe("https://github.com/u/r");
    expect(body.imageBase64).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
    expect(body.imageContentType).toBe("image/png");
  });

  it("uses Pinata two-upload flow when PINATA_JWT is set", async () => {
    process.env.PINATA_JWT = "jwt-token";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-img-"));
    const img = path.join(tmp, "logo.png");
    fs.writeFileSync(img, Buffer.from([1, 2, 3]));
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { cid: "imgcid" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { cid: "metacid" } }) });
    const out = await uploadMetadata({ name: "T", symbol: "T", description: "d", imagePath: img });
    expect(out.imageUri).toBe("https://ipfs.io/ipfs/imgcid");
    expect(out.metadataUri).toBe("https://ipfs.io/ipfs/metacid");
    expect(fetchMock.mock.calls[0][0]).toBe("https://uploads.pinata.cloud/v3/files");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt-token");
    // second call's file is the metadata JSON containing our provenance fields
    const metaForm: FormData = fetchMock.mock.calls[1][1].body;
    const file = metaForm.get("file") as File;
    const json = JSON.parse(await file.text());
    expect(json.image).toBe("https://ipfs.io/ipfs/imgcid");
    expect(json.showName).toBe("true");
    expect(json.createdOn).toBe("https://vibecoin.fun");
  });
});
