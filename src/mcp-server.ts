#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createAuthenticatedConfig } from "./auth.js";
import { ShopifyClient } from "./shopify.js";
import { readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dirname, "../skills/clawpify");

// Load .env from ~/.clawpify/.env if it exists (for MCP server mode)
const configDir = join(homedir(), ".clawpify");
const envPath = join(configDir, ".env");
try {
  const envFile = Bun.file(envPath);
  if (await envFile.exists()) {
    const envContent = await envFile.text();
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=");
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
    console.error(`Loaded config from ${envPath}`);
  }
} catch {
  // Ignore errors, will use env vars from MCP config or current .env
}

// Cache the authenticated client
let shopifyClient: ShopifyClient | null = null;

async function getShopifyClient(): Promise<ShopifyClient> {
  if (!shopifyClient) {
    const config = await createAuthenticatedConfig();
    shopifyClient = new ShopifyClient({
      storeUrl: config.storeUrl,
      accessToken: config.accessToken,
    });
  }
  return shopifyClient;
}

// Create MCP server
const server = new Server(
  {
    name: "clawpify",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "shopify_graphql",
      description:
        "Execute GraphQL queries against Shopify Admin API. Use this to query products, orders, customers, inventory, and manage store data.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "GraphQL query or mutation",
          },
          variables: {
            type: "object",
            description: "GraphQL variables (optional)",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "shopify_graphql") {
    const { query, variables } = request.params.arguments as {
      query: string;
      variables?: Record<string, any>;
    };

    try {
      const client = await getShopifyClient();
      const result = await client.graphql(query, variables);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// List available resources (skill files)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const files = await readdir(skillsDir);
    const resources = files
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({
        uri: `shopify://skills/${f.replace(".md", "")}`,
        name: f.replace(".md", ""),
        mimeType: "text/markdown",
        description: `Shopify ${f.replace(".md", "")} skill documentation`,
      }));

    return { resources };
  } catch {
    return { resources: [] };
  }
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^shopify:\/\/skills\/(.+)$/);

  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const filename = `${match[1]}.md`;
  const filepath = join(skillsDir, filename);

  try {
    const content = await Bun.file(filepath).text();
    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: content,
        },
      ],
    };
  } catch {
    throw new Error(`Failed to read resource: ${filename}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Clawpify MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
