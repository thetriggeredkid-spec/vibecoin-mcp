#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { collectFeesTool } from "./tools/collect-fees.js";
import { fundAgentTool } from "./tools/fund-agent.js";
import { infoTool } from "./tools/info.js";
import { launchTool } from "./tools/launch.js";
import { lockTool } from "./tools/lock.js";
import { myCoinsTool } from "./tools/my-coins.js";
import { walletTool } from "./tools/wallet.js";

const server = new McpServer(
  { name: "vibecoin", version: "0.1.0" },
  {
    instructions:
      "vibecoin launches the user's current project as a coin on pump.fun (Solana) with local-only keys. " +
      "Golden rule: every action that costs money (launch, transfer, collect-fees, fund-agent, lock) is two-phase — " +
      "call once to get a preview, show it to the user, and only call again with confirm: true after they explicitly approve. " +
      "Never set confirm: true on your own initiative.",
  },
);

const tools = [infoTool, walletTool, launchTool, myCoinsTool, collectFeesTool, fundAgentTool, lockTool];
for (const t of tools) {
  server.registerTool(
    t.name,
    { description: t.description, inputSchema: t.schema },
    t.handler as Parameters<typeof server.registerTool>[2],
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
