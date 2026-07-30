import { Keypair } from "@solana/web3.js";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { KEYS_DIR, VIBECOIN_HOME, WALLETS_DIR } from "./config.js";

const SCRYPT = { N: 32768, r: 8, p: 1 };

export interface WalletCrypto {
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface WalletFile {
  version: 1;
  name: string;
  publicKey: string;
  createdAt: string;
  crypto: WalletCrypto;
}

export type PasswordMode = "env" | "param" | "keychain" | "keyfile";

// Wallet keys, if held in memory at all, live only for the process lifetime.
const sessionKeys = new Map<string, Uint8Array>();

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * 1024 * 1024,
  });
}

export function encryptSecretKey(secretKey: Uint8Array, password: string): WalletCrypto {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  return {
    kdf: "scrypt",
    ...SCRYPT,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSecretKey(c: WalletCrypto, password: string): Uint8Array {
  const key = crypto.scryptSync(password, Buffer.from(c.salt, "base64"), 32, {
    N: c.N,
    r: c.r,
    p: c.p,
    maxmem: 128 * 1024 * 1024,
  });
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(c.iv, "base64"));
  decipher.setAuthTag(Buffer.from(c.tag, "base64"));
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(c.ciphertext, "base64")), decipher.final()]);
    return new Uint8Array(plain);
  } catch {
    throw new Error("wallet decryption failed — wrong password?");
  }
}

function keychainAvailable(): boolean {
  return process.platform === "darwin" && !process.env.VIBECOIN_NO_KEYCHAIN;
}

function keychainStore(name: string, pw: string): boolean {
  try {
    execFileSync("security", ["add-generic-password", "-s", "vibecoin", "-a", name, "-w", pw, "-U"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function keychainRead(name: string): string | null {
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", "vibecoin", "-a", name, "-w"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pw = out.toString("utf8").replace(/\n$/, "");
    return pw.length > 0 ? pw : null;
  } catch {
    return null;
  }
}

function keyfilePath(name: string): string {
  return path.join(KEYS_DIR(), `${name}.key`);
}

export function storeGeneratedPassword(name: string, pw: string): "keychain" | "keyfile" {
  if (keychainAvailable() && keychainStore(name, pw)) return "keychain";
  fs.mkdirSync(KEYS_DIR(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyfilePath(name), pw, { mode: 0o600 });
  return "keyfile";
}

export function resolveStoredPassword(name: string): string | null {
  if (keychainAvailable()) {
    const pw = keychainRead(name);
    if (pw) return pw;
  }
  const kf = keyfilePath(name);
  if (fs.existsSync(kf)) return fs.readFileSync(kf, "utf8");
  return null;
}

function resolvePassword(name: string, param?: string): { pw: string; mode: PasswordMode } | null {
  const env = process.env.VIBECOIN_WALLET_PASSWORD;
  if (env && env.length > 0) return { pw: env, mode: "env" };
  if (param && param.length > 0) return { pw: param, mode: "param" };
  const stored = resolveStoredPassword(name);
  if (stored) return { pw: stored, mode: keychainAvailable() && keychainRead(name) ? "keychain" : "keyfile" };
  return null;
}

function assertValidName(name: string): void {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) {
    throw new Error(
      `invalid wallet name "${name}" — use 1-64 letters, digits, dot, dash or underscore (no path separators)`,
    );
  }
}

function walletPath(name: string): string {
  return path.join(WALLETS_DIR(), `${name}.json`);
}

export function walletExists(name: string): boolean {
  try {
    assertValidName(name);
  } catch {
    return false;
  }
  return fs.existsSync(walletPath(name));
}

export async function createWallet(
  name: string,
  password?: string,
): Promise<{ publicKey: string; passwordMode: PasswordMode }> {
  assertValidName(name);
  if (walletExists(name)) {
    throw new Error(`wallet "${name}" already exists at ${walletPath(name)}`);
  }
  const kp = Keypair.generate();
  let resolved = resolvePassword(name, password);
  let mode: PasswordMode;
  if (resolved) {
    mode = resolved.mode;
  } else {
    const generated = crypto.randomBytes(32).toString("base64url");
    mode = storeGeneratedPassword(name, generated);
    resolved = { pw: generated, mode };
  }
  const file: WalletFile = {
    version: 1,
    name,
    publicKey: kp.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    crypto: encryptSecretKey(kp.secretKey, resolved.pw),
  };
  fs.mkdirSync(VIBECOIN_HOME(), { recursive: true, mode: 0o700 });
  fs.mkdirSync(WALLETS_DIR(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(walletPath(name), JSON.stringify(file, null, 2), { mode: 0o600 });
  sessionKeys.set(name, kp.secretKey);
  return { publicKey: file.publicKey, passwordMode: mode };
}

export function readWalletFile(name: string): WalletFile {
  assertValidName(name);
  if (!fs.existsSync(walletPath(name))) {
    throw new Error(`wallet "${name}" not found — create one with the wallet tool (action: "create")`);
  }
  return JSON.parse(fs.readFileSync(walletPath(name), "utf8")) as WalletFile;
}

export async function loadKeypair(name: string, password?: string): Promise<Keypair> {
  const cached = sessionKeys.get(name);
  if (cached) return Keypair.fromSecretKey(cached);
  const file = readWalletFile(name);
  const resolved = resolvePassword(name, password);
  if (!resolved) {
    throw new Error(
      `no password available for wallet "${name}" — set VIBECOIN_WALLET_PASSWORD, pass a password, or restore its stored secret`,
    );
  }
  const secret = decryptSecretKey(file.crypto, resolved.pw);
  const kp = Keypair.fromSecretKey(secret);
  if (kp.publicKey.toBase58() !== file.publicKey) {
    throw new Error(`wallet "${name}" decrypted to an unexpected key — file may be corrupted`);
  }
  sessionKeys.set(name, secret);
  return kp;
}

export function listWallets(): { name: string; publicKey: string; createdAt: string }[] {
  const dir = WALLETS_DIR();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const file = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as WalletFile;
      return { name: file.name, publicKey: file.publicKey, createdAt: file.createdAt };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
