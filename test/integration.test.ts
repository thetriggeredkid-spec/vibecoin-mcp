import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let client: Client;
let home: string;
let fixture: string;

function resultText(res: any): string {
  return (res.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
}

describe("vibecoin MCP server over stdio", () => {
  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-int-"));
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-proj-"));
    fs.writeFileSync(
      path.join(fixture, "README.md"),
      "# Moon Planner\n\nPlan lunar missions from your terminal with zero fuss.\n",
    );
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "moon-planner", homepage: "https://moon.example" }));

    client = new Client({ name: "test-client", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(process.cwd(), "dist", "index.js")],
      cwd: fixture,
      env: {
        ...process.env,
        VIBECOIN_HOME: home,
        VIBECOIN_NO_KEYCHAIN: "1",
        // unroutable RPC: balance lookups fail fast and tools must degrade gracefully
        SOLANA_RPC_URL: "http://127.0.0.1:9",
      },
      stderr: "ignore",
    });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists all 7 tools", async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual(["collect-fees", "fund-agent", "info", "launch", "lock", "my-coins", "wallet"].sort());
  });

  it("info reports platform + fee facts", async () => {
    const res = await client.callTool({ name: "info", arguments: {} });
    const text = resultText(res);
    expect(text).toContain("pump.fun");
    expect(text).toContain("0.30%");
    expect(text).toContain("PumpPortal");
  });

  it("creates a wallet with no password input", async () => {
    const res = await client.callTool({ name: "wallet", arguments: { action: "create", name: "int-test" } });
    const text = resultText(res);
    expect(text).toContain("Created wallet");
    expect(text).toMatch(/Address: [1-9A-HJ-NP-Za-km-z]{32,44}/);
    const walletFile = path.join(home, "wallets", "int-test.json");
    expect(fs.existsSync(walletFile)).toBe(true);
    expect(fs.statSync(walletFile).mode & 0o777).toBe(0o600);
  });

  it("previews a transfer without sending when confirm is absent", async () => {
    const res = await client.callTool({
      name: "wallet",
      arguments: { action: "transfer", name: "int-test", to: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS", sol: 0.1 },
    });
    const text = resultText(res);
    // balance lookup fails against the unroutable RPC → clean error, no send
    expect(text.toLowerCase()).toMatch(/preview|error/);
    expect(text).not.toContain("Sent");
  });

  it("launch phase 1 drafts from the project without any network", async () => {
    const res = await client.callTool({ name: "launch", arguments: {} });
    const text = resultText(res);
    expect(text).toContain("Launch preview");
    expect(text).toContain("Moon Planner");
    expect(text).toContain("$MOONPL");
    expect(text).toContain("lunar missions");
    expect(text).toContain("confirm: true");
    expect(text).toContain("moon.example");
    expect(text).toContain("nothing sent");
  });

  it("my-coins reports the empty state", async () => {
    const res = await client.callTool({ name: "my-coins", arguments: {} });
    expect(resultText(res)).toContain("No coins launched");
  });

  it("lock previews without touching the chain (dry_run)", async () => {
    const res = await client.callTool({
      name: "lock",
      arguments: { percent: 20, days: 90, wallet: "int-test", mint: "So11111111111111111111111111111111111111112", dry_run: true },
    });
    const text = resultText(res);
    // wallet holds nothing / RPC unreachable → must be a clean error or a preview, never a stack trace
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain("    at ");
  });
});
