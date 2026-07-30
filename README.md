# vibecoin-mcp

Launch your vibe coded app on Solana without leaving Claude Code. This MCP server drafts a coin from your repo, deploys it to pump.fun's bonding curve via the PumpPortal Local Transaction API, and recycles your creator fees into an agent budget — with keys that never leave your machine.

Site: https://vibecoin.fun · Projects: https://vibecoin.fun/projects

## Install

### Claude Code

```bash
claude mcp add vibecoin -- npx github:thetriggeredkid-spec/vibecoin-mcp
```

### Manual (`~/.claude.json` or `.mcp.json`)

```json
{
  "mcpServers": {
    "vibecoin": {
      "command": "npx",
      "args": ["github:thetriggeredkid-spec/vibecoin-mcp"]
    }
  }
}
```

### From a clone

```bash
git clone https://github.com/thetriggeredkid-spec/vibecoin-mcp.git
cd vibecoin-mcp && npm install && npm run build
claude mcp add vibecoin -- node /absolute/path/to/vibecoin-mcp/dist/index.js
```

Restart Claude Code after adding it.

## One-prompt launch

Open Claude Code in your project and say **"launch this as a coin"**. The flow:

1. `launch` reads README.md, package.json and your git remote, then shows a preview: name, ticker, description, image, links, and the full cost breakdown.
2. You approve (or tweak any field — everything is overridable).
3. A wallet is auto-created for this project if none exists. Its encryption password is generated and stored in your macOS Keychain (or a `0600` key file elsewhere), so **no interactive password step ever blocks the launch** — and the password never appears in the chat.
4. Metadata (JSON + image) is uploaded, PumpPortal builds the unsigned create transaction, it's signed locally with the mint + creator keys, and submitted to your RPC.
5. The coin is live on pump.fun; the launch is recorded locally and registered on vibecoin.fun/projects.

Nothing is ever sent without an explicit preview → approve → `confirm: true` cycle. That applies to launches, transfers, fee claims, swaps and locks alike.

## Tools

| Tool | What it does |
|---|---|
| `wallet` | Create the project's encrypted wallet, check SOL/USDC balances, transfer SOL |
| `launch` | Draft a coin from the repo and deploy it to pump.fun's bonding curve |
| `my-coins` | List every coin launched from this machine with live market data |
| `collect-fees` | Claim accrued pump.fun creator fees (all coins at once) |
| `fund-agent` | Collect fees → swap SOL→USDC via Jupiter → hold the budget in the agent's wallet |
| `lock` | Lock a % of your own tokens via Streamflow; returns a shareable proof link |
| `info` | Fee table, config paths, wallet list, links |

## Token metadata field guide

What each field does, where it ends up, and who fills it. The `launch` preview shows this mapping before anything is sent; your agent can override any field via the tool parameters of the same name.

| Field | Ends up in | Function & limits | Default source |
|---|---|---|---|
| `name` | on-chain + metadata JSON | Display name everywhere. Hard on-chain limit 32 chars. | README `# Title` → package.json name → directory name |
| `symbol` | on-chain + metadata JSON | The $TICKER. Hard on-chain limit 10 chars; 3–8 uppercase is the convention. | Derived from name (initials for 3+ words, blended otherwise) |
| `description` | metadata JSON | Body text on the pump.fun coin page and aggregators. Keep ≤ ~500 chars. | First real README paragraph → package.json description |
| `image` (`image_path` param) | metadata JSON | Coin avatar. Square png/jpg/gif/webp, ≤ 1.5 MB. | `logo.png`/`icon.png`/`public/logo.png` etc., else a bundled placeholder |
| `website` | metadata JSON | Link box on the coin page — point it at the live app. | package.json `homepage` |
| `twitter` | metadata JSON | Optional social link on the coin page. | omitted unless provided |
| `telegram` | metadata JSON | Optional social link on the coin page. | omitted unless provided |
| `github` | vibecoin registry + appended to description | pump.fun metadata has no native repo field, so the repo URL lives in the vibecoin.fun registry (and /projects), and is appended to the description for visibility on pump.fun itself. | git `remote.origin.url`, normalized |
| `showName` | metadata JSON | Legacy pump.fun display flag; always `"true"` for compatibility. | fixed |
| `createdOn` | metadata JSON | Provenance stamp; coins launched here carry `https://vibecoin.fun`. | fixed |
| `dev_buy_sol` | create transaction | Optional initial buy at the very bottom of the curve (your creator bag). PumpPortal takes 0.5% of it. | `0` |

## Fees (verified from official docs, July 2026)

- Creating a coin is **free**; ~0.025 SOL of network cost puts it on-chain (~0.04 SOL recommended balance incl. buffer).
- Bonding-curve trades cost 1.25%: **0.30% to you**, 0.95% to pump.fun.
- After graduation (~85 SOL raised → PumpSwap, LP burned) your share is tiered by market cap: up to **0.95%**, floor 0.05% above ~$20M.
- PumpPortal adds 0.5% on trades routed through its API (dev buys included; creation itself is not charged).
- `fund-agent` swaps via Jupiter (2 bps on SOL→USDC) and keeps the USDC **in your wallet**. It does not auto-pay any provider — Anthropic/OpenAI bill fiat cards only, and OpenRouter crypto top-ups are a manual checkout on their site.
- `lock` uses Streamflow: ~0.09–0.16 SOL + 0.19–0.5% of the locked tokens (their on-chain fee oracle sets the exact value).

## Security model

- Keypairs are generated locally and stored encrypted (scrypt N=2^15 + AES-256-GCM) under `~/.vibecoin/wallets/` with `0600` permissions.
- The encryption password is resolved in order: `VIBECOIN_WALLET_PASSWORD` env → explicit `password` param → auto-generated secret in the macOS Keychain (service `vibecoin`) or `~/.vibecoin/keys/<name>.key` (`0600`).
- Auto mode protects the wallet file at rest (a stolen `wallets/*.json` alone is useless). It does not protect against an attacker with full control of your logged-in user account — set `VIBECOIN_WALLET_PASSWORD` yourself and delete the stored secret if you want password-only custody.
- Transactions are built by PumpPortal/Jupiter as **unsigned** payloads, signed locally, and submitted to the RPC you configure. Private keys are never transmitted, logged, or included in tool output.
- Every value-moving action requires an explicit user-approved `confirm: true` second call. `dry_run` builds and simulates without sending.
- One fresh wallet per project by default — launches are pseudonymous until you link them.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | RPC for submission/balances. Use a paid endpoint (Helius, Triton…) for reliability. |
| `VIBECOIN_HOME` | `~/.vibecoin` | Where wallets/launches live. |
| `VIBECOIN_WALLET_PASSWORD` | — | Bring-your-own wallet password (skips the stored secret). |
| `VIBECOIN_DRY_RUN` | — | `1` = every action builds + simulates but never sends. |
| `PINATA_JWT` | — | Pin metadata to IPFS via your own Pinata account instead of vibecoin.fun's hosted endpoint. |
| `JUP_API_KEY` | — | Jupiter API key (keyless works at 0.5 req/s). |
| `VIBECOIN_METADATA_URL` | `https://vibecoin.fun/api/metadata` | Hosted metadata endpoint. |
| `VIBECOIN_REGISTRY_URL` | `https://vibecoin.fun/api/registry` | Launch registry endpoint. |
| `VIBECOIN_NO_KEYCHAIN` | — | `1` = skip macOS Keychain, use key files. |

## Notes

- pump.fun and PumpPortal have **no devnet** — `dry_run` (build + mainnet simulation, no send) is the safe rehearsal.
- pump.fun's terms restrict commercial transacting *on behalf of others*; vibecoin is a local tool — you sign for yourself, we never custody anything.
- Not financial advice; launching a token is not an investment contract with your users. Ship something real.

MIT
