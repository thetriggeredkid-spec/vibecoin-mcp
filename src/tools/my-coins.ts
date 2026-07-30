import { LINKS } from "../config.js";
import { fetchMarket, fmtUsd } from "../market.js";
import { listLaunches } from "../registry.js";
import { errText, text } from "./common.js";

export const myCoinsTool = {
  name: "my-coins",
  description: "List every coin launched from this machine, with live market data (price, market cap, 24h volume).",
  schema: {},
  async handler() {
    try {
      const launches = listLaunches();
      if (launches.length === 0) {
        return text("No coins launched from this machine yet. Run launch in a project to create one.");
      }
      const rows = await Promise.all(
        launches.map(async (l) => {
          let market = "no market data yet (just launched?)";
          try {
            const m = await fetchMarket(l.mint);
            if (m) {
              const chg = m.priceChange24h !== undefined ? ` (${m.priceChange24h > 0 ? "+" : ""}${m.priceChange24h}% 24h)` : "";
              market = `${fmtUsd(m.priceUsd)}${chg} · mcap ${fmtUsd(m.marketCapUsd)} · vol24h ${fmtUsd(m.volume24hUsd)}`;
            }
          } catch {
            market = "market data unavailable";
          }
          return `### $${l.symbol} — ${l.name}
- ${market}
- Mint: ${l.mint}
- Trade: ${LINKS.pumpCoin(l.mint)}
- ${[l.github, l.website].filter(Boolean).join(" · ") || "no links"}
- Launched ${l.createdAt.slice(0, 10)} from wallet "${l.wallet}"`;
        }),
      );
      return text(`# Your coins (${launches.length})\n\n${rows.join("\n\n")}`);
    } catch (e) {
      return errText(e);
    }
  },
};
