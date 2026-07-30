import { Keypair } from "@solana/web3.js";
import { z } from "zod";
import { DEFAULTS, LINKS, isDryRun } from "../config.js";
import { draftFromProject } from "../draft.js";
import { createWallet, loadKeypair, readWalletFile, walletExists } from "../keystore.js";
import { buildCreateTx, uploadMetadata } from "../pumpportal.js";
import { postToSiteRegistry, recordLaunch } from "../registry.js";
import { EXPLORER, getConnection, getSolBalance, sendSigned, simulate } from "../solana.js";
import { APPROVAL_NOTE, defaultWalletName, errText, parsePubkey, sol, text } from "./common.js";

const CREATE_COST_EST = 0.025; // SOL network cost to put the coin on-chain with a first buy
const BUFFER = 0.01;

export const launchTool = {
  name: "launch",
  description:
    "Launch the current project as a coin on pump.fun's bonding curve. " +
    "First call WITHOUT confirm: drafts name/ticker/description/links from the repo (README, package.json, git remote) " +
    "and returns a full preview with costs. Show that preview to the user, apply any edits they want via the override " +
    "params, and only after they explicitly approve call again with confirm: true. The wallet is auto-created if missing " +
    "(encrypted, password stored in Keychain — no interactive step). Metadata is uploaded, the create transaction is " +
    "built by PumpPortal, signed locally, and submitted to your RPC. dry_run builds and simulates everything but never sends.",
  schema: {
    name: z.string().max(32).optional().describe("Override token name (on-chain limit 32 chars)"),
    symbol: z.string().max(10).optional().describe("Override ticker (on-chain limit 10 chars; 3-8 uppercase is the convention)"),
    description: z.string().max(1000).optional().describe("Override description shown on pump.fun (keep ≤ 500 chars)"),
    website: z.string().url().optional().describe("Live URL of the project — becomes the coin's website link"),
    twitter: z.string().optional().describe("Twitter/X link for the coin page (optional)"),
    telegram: z.string().optional().describe("Telegram link for the coin page (optional)"),
    github: z.string().url().optional().describe("GitHub repo URL — listed on vibecoin.fun/projects and appended to the description"),
    image_path: z.string().optional().describe("Path to a square logo (png/jpg/gif/webp ≤1.5MB). Defaults to a repo logo or a bundled placeholder"),
    dev_buy_sol: z.number().min(0).max(10).optional().describe("Initial dev buy in SOL (default 0). PumpPortal charges 0.5% on this"),
    wallet: z.string().optional().describe("Wallet name (default: project directory name — fresh wallet per project)"),
    project_dir: z.string().optional().describe("Project directory to draft from (default: current working directory)"),
    confirm: z.boolean().optional().describe("Set true ONLY after the user explicitly approved the preview"),
    dry_run: z.boolean().optional().describe("Build + simulate the create transaction without sending it"),
  },
  async handler(args: {
    name?: string;
    symbol?: string;
    description?: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    github?: string;
    image_path?: string;
    dev_buy_sol?: number;
    wallet?: string;
    project_dir?: string;
    confirm?: boolean;
    dry_run?: boolean;
  }) {
    try {
      const projectDir = args.project_dir ?? process.cwd();
      const walletName = args.wallet ?? defaultWalletName(projectDir);
      const draft = await draftFromProject(projectDir);
      const meta = {
        name: (args.name ?? draft.name).slice(0, 32),
        symbol: (args.symbol ?? draft.symbol).toUpperCase().slice(0, 10),
        description: args.description ?? draft.description,
        website: args.website ?? draft.website,
        twitter: args.twitter,
        telegram: args.telegram,
        github: args.github ?? draft.github,
        imagePath: args.image_path ?? draft.imagePath,
      };
      if (meta.github && !meta.description.includes(meta.github)) {
        meta.description = `${meta.description}\n\ngithub: ${meta.github}`.slice(0, 1000);
      }
      const devBuy = args.dev_buy_sol ?? 0;
      const dryRun = isDryRun(args.dry_run);
      const needed = CREATE_COST_EST + devBuy * 1.005 + BUFFER;

      if (!args.confirm) {
        const walletLine = walletExists(walletName)
          ? `"${walletName}" (exists — ${readWalletFile(walletName).publicKey})`
          : `"${walletName}" (will be auto-created and encrypted; no password prompt needed)`;
        let balanceLine = "unknown (RPC unreachable — will be checked again before sending)";
        if (walletExists(walletName)) {
          try {
            const bal = await getSolBalance(getConnection(), parsePubkey(readWalletFile(walletName).publicKey, "wallet"));
            balanceLine = `${sol(bal)}${bal < needed ? ` — ⚠ needs ~${sol(needed)} before launch` : " ✓ sufficient"}`;
          } catch {
            // keep default line
          }
        }
        return text(`## Launch preview — nothing sent yet

| field | value | goes where |
|---|---|---|
| name | ${meta.name} | on-chain token name (32 char max) |
| symbol | $${meta.symbol} | on-chain ticker (10 char max) |
| description | ${meta.description.slice(0, 200)}${meta.description.length > 200 ? "…" : ""} | pump.fun coin page |
| image | ${meta.imagePath} (${draft.imageSource === "repo" && !args.image_path ? "found in repo" : args.image_path ? "provided" : "bundled placeholder — pass image_path for a real logo"}) | coin avatar |
| website | ${meta.website ?? "—"} | coin page link (your live app) |
| github | ${meta.github ?? "—"} | vibecoin.fun/projects + appended to description |
| twitter / telegram | ${meta.twitter ?? "—"} / ${meta.telegram ?? "—"} | coin page links |

Drafted from: ${draft.sources.length > 0 ? draft.sources.join(", ") : "directory name only"}

## Costs
- Coin creation: free (pump.fun) — network cost ~${sol(CREATE_COST_EST)} to land it on-chain
- Dev buy: ${devBuy > 0 ? `${sol(devBuy)} + 0.5% PumpPortal fee` : "none (0 SOL)"}
- Recommended balance: ~${sol(needed)}
- You earn 0.30% of every bonding-curve trade, up to 0.95% after graduation to PumpSwap.

## Wallet
- ${walletLine}
- Balance: ${balanceLine}

${APPROVAL_NOTE} Overrides: name, symbol, description, website, twitter, telegram, github, image_path, dev_buy_sol.${dryRun ? "\n(dry_run is on: confirming will simulate without sending.)" : ""}`);
      }

      // ---- confirmed ----
      let created = false;
      if (!walletExists(walletName)) {
        await createWallet(walletName);
        created = true;
      }
      const file = readWalletFile(walletName);
      const creatorPk = parsePubkey(file.publicKey, "wallet");
      const conn = getConnection();

      if (!dryRun) {
        const bal = await getSolBalance(conn, creatorPk);
        if (bal < needed) {
          throw new Error(
            `wallet "${walletName}" holds ${sol(bal)} but this launch needs ~${sol(needed)}. ` +
              `Send SOL to ${file.publicKey} and run launch again.`,
          );
        }
      }

      const { metadataUri, imageUri } = await uploadMetadata(meta);
      const mintKeypair = Keypair.generate();
      const tx = await buildCreateTx({
        creator: creatorPk,
        mintPubkey: mintKeypair.publicKey,
        meta: { name: meta.name, symbol: meta.symbol },
        metadataUri,
        devBuySol: devBuy,
      });
      const creatorKp = await loadKeypair(walletName);
      tx.sign([mintKeypair, creatorKp]);
      const mint = mintKeypair.publicKey.toBase58();

      if (dryRun) {
        const sim = await simulate(conn, tx);
        return text(`## Dry run complete — NOTHING was sent

- Metadata uploaded: ${metadataUri}
- Unsigned create tx built by PumpPortal, signed locally with mint + creator keys
- Mint would be: ${mint}
- Mainnet simulation: ${sim.ok ? "✓ ok" : `✗ ${sim.err}`}
${sim.logs.slice(-5).map((l) => `  ${l}`).join("\n")}

Re-run with dry_run: false (and confirm: true) to launch for real.`);
      }

      const signature = await sendSigned(conn, tx);
      const record = {
        mint,
        name: meta.name,
        symbol: meta.symbol,
        description: meta.description,
        image: imageUri,
        github: meta.github,
        website: meta.website,
        creator: file.publicKey,
        wallet: walletName,
        signature,
        createdAt: new Date().toISOString(),
      };
      recordLaunch(record);
      const reg = await postToSiteRegistry(record);

      return text(`## 🚀 $${meta.symbol} is live on pump.fun

- Coin: ${LINKS.pumpCoin(mint)}
- Mint: ${mint}
- Tx: ${EXPLORER.tx(signature)}
- Projects page: ${LINKS.site}/projects${reg.ok ? "" : `\n- Registry note: ${reg.note}`}
${created ? `\nWallet "${walletName}" was auto-created for this launch — its address is ${file.publicKey}.` : ""}
You earn 0.30% of every trade on the curve (up to 0.95% after graduation). Claim anytime with collect-fees.`);
    } catch (e) {
      return errText(e);
    }
  },
};
