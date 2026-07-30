import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createWallet,
  decryptSecretKey,
  encryptSecretKey,
  listWallets,
  loadKeypair,
  walletExists,
} from "../src/keystore.js";

describe("keystore", () => {
  beforeEach(() => {
    process.env.VIBECOIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-test-"));
    process.env.VIBECOIN_NO_KEYCHAIN = "1";
    delete process.env.VIBECOIN_WALLET_PASSWORD;
  });

  it("roundtrips a secret key", () => {
    const kp = Keypair.generate();
    const enc = encryptSecretKey(kp.secretKey, "hunter2");
    expect(decryptSecretKey(enc, "hunter2")).toEqual(kp.secretKey);
  });

  it("fails cleanly on wrong password", () => {
    const enc = encryptSecretKey(Keypair.generate().secretKey, "right");
    expect(() => decryptSecretKey(enc, "wrong")).toThrow(/wrong password/);
  });

  it("creates a wallet with auto password, 0600 perms, and loads it back", async () => {
    const { publicKey, passwordMode } = await createWallet("proj");
    expect(passwordMode).toBe("keyfile");
    const walletPath = path.join(process.env.VIBECOIN_HOME!, "wallets", "proj.json");
    expect(fs.statSync(walletPath).mode & 0o777).toBe(0o600);
    const keyPath = path.join(process.env.VIBECOIN_HOME!, "keys", "proj.key");
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    const kp = await loadKeypair("proj");
    expect(kp.publicKey.toBase58()).toBe(publicKey);
  });

  it("uses env password when provided and does not write a keyfile", async () => {
    process.env.VIBECOIN_WALLET_PASSWORD = "envsecret";
    const { publicKey, passwordMode } = await createWallet("envwallet");
    expect(passwordMode).toBe("env");
    expect(fs.existsSync(path.join(process.env.VIBECOIN_HOME!, "keys", "envwallet.key"))).toBe(false);
    const kp = await loadKeypair("envwallet");
    expect(kp.publicKey.toBase58()).toBe(publicKey);
  });

  it("refuses duplicate wallet names", async () => {
    await createWallet("dup");
    await expect(createWallet("dup")).rejects.toThrow(/exists/);
  });

  it("lists wallets and checks existence", async () => {
    expect(listWallets()).toEqual([]);
    expect(walletExists("a")).toBe(false);
    const { publicKey } = await createWallet("a");
    expect(walletExists("a")).toBe(true);
    const list = listWallets();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("a");
    expect(list[0].publicKey).toBe(publicKey);
  });

  it("rejects wallet names with path separators", async () => {
    await expect(createWallet("../evil")).rejects.toThrow(/name/i);
  });
});
