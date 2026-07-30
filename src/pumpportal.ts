import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { DEFAULTS, ENDPOINTS, fallbackUrlFor } from "./config.js";

/** POST that retries once against the vercel.app origin when vibecoin.fun DNS isn't set up yet. */
export async function fetchWithFallback(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const fallback = fallbackUrlFor(url);
    if (!fallback) throw e;
    return fetch(fallback, init);
  }
}

export interface TokenMeta {
  name: string;
  symbol: string;
  description: string;
  imagePath?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  github?: string;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function readImage(imagePath?: string): { base64: string; contentType: string } | null {
  if (!imagePath) return null;
  const ext = path.extname(imagePath).toLowerCase();
  const contentType = IMAGE_TYPES[ext];
  if (!contentType) {
    throw new Error(`unsupported image type "${ext}" — use png, jpg, gif or webp`);
  }
  const bytes = fs.readFileSync(imagePath);
  if (bytes.byteLength > 1.5 * 1024 * 1024) {
    throw new Error(`image ${imagePath} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB — keep it under 1.5MB`);
  }
  return { base64: bytes.toString("base64"), contentType };
}

async function uploadViaPinata(
  meta: TokenMeta,
  jwt: string,
): Promise<{ metadataUri: string; imageUri?: string }> {
  const pinataUrl = "https://uploads.pinata.cloud/v3/files";
  let imageUri: string | undefined;
  const image = readImage(meta.imagePath);
  if (image) {
    const form = new FormData();
    form.append("network", "public");
    form.append(
      "file",
      new File([Buffer.from(image.base64, "base64")], `${meta.symbol.toLowerCase()}.png`, { type: image.contentType }),
    );
    const res = await fetch(pinataUrl, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
    if (!res.ok) throw new Error(`Pinata image upload failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { data: { cid: string } };
    imageUri = `https://ipfs.io/ipfs/${body.data.cid}`;
  }
  const metadataJson = {
    name: meta.name,
    symbol: meta.symbol,
    description: meta.description,
    ...(imageUri ? { image: imageUri } : {}),
    ...(meta.website ? { website: meta.website } : {}),
    ...(meta.twitter ? { twitter: meta.twitter } : {}),
    ...(meta.telegram ? { telegram: meta.telegram } : {}),
    showName: "true",
    createdOn: "https://vibecoin.fun",
  };
  const form = new FormData();
  form.append("network", "public");
  form.append("file", new File([JSON.stringify(metadataJson)], "metadata.json", { type: "application/json" }));
  const res = await fetch(pinataUrl, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
  if (!res.ok) throw new Error(`Pinata metadata upload failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data: { cid: string } };
  return { metadataUri: `https://ipfs.io/ipfs/${body.data.cid}`, imageUri };
}

/**
 * Uploads token metadata and returns the URI to put on-chain.
 * Default path posts to vibecoin.fun's hosted metadata endpoint (no account needed).
 * Setting PINATA_JWT switches to direct IPFS pinning via Pinata.
 */
export async function uploadMetadata(meta: TokenMeta): Promise<{ metadataUri: string; imageUri?: string }> {
  const jwt = process.env.PINATA_JWT;
  if (jwt && jwt.length > 0) return uploadViaPinata(meta, jwt);

  const image = readImage(meta.imagePath);
  const res = await fetchWithFallback(ENDPOINTS.metadataUpload, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: meta.name,
      symbol: meta.symbol,
      description: meta.description,
      website: meta.website,
      twitter: meta.twitter,
      telegram: meta.telegram,
      github: meta.github,
      imageBase64: image?.base64,
      imageContentType: image?.contentType,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `metadata upload failed: ${res.status} ${res.statusText} ${text.slice(0, 200)} — ` +
        `set PINATA_JWT to pin via your own Pinata account instead`,
    );
  }
  const body = (await res.json()) as { metadataUri: string; imageUri?: string };
  if (!body.metadataUri) throw new Error("metadata endpoint returned no metadataUri");
  return body;
}

async function tradeLocal(body: Record<string, unknown>): Promise<VersionedTransaction> {
  const res = await fetch(ENDPOINTS.pumpPortal, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PumpPortal ${body.action} failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    throw new Error("PumpPortal returned data that is not a serialized transaction — API may have changed");
  }
}

export async function buildCreateTx(args: {
  creator: PublicKey;
  mintPubkey: PublicKey;
  meta: { name: string; symbol: string };
  metadataUri: string;
  devBuySol: number;
  slippage?: number;
  priorityFee?: number;
}): Promise<VersionedTransaction> {
  return tradeLocal({
    publicKey: args.creator.toBase58(),
    action: "create",
    tokenMetadata: { name: args.meta.name, symbol: args.meta.symbol, uri: args.metadataUri },
    mint: args.mintPubkey.toBase58(),
    denominatedInSol: "true",
    amount: args.devBuySol,
    slippage: args.slippage ?? DEFAULTS.slippage,
    priorityFee: args.priorityFee ?? DEFAULTS.priorityFee,
    pool: DEFAULTS.pool,
  });
}

export async function buildCollectCreatorFeeTx(args: {
  creator: PublicKey;
  priorityFee?: number;
}): Promise<VersionedTransaction> {
  return tradeLocal({
    publicKey: args.creator.toBase58(),
    action: "collectCreatorFee",
    priorityFee: args.priorityFee ?? DEFAULTS.priorityFee,
  });
}
