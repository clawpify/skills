# Clawpify

Shopify Agent SDK. Query and manage Shopify stores with AI agents and MCP.

## Install

```bash
npm install @clawpify/skills
```

## Quick Start

```ts
import { ShopifyClient } from "@clawpify/skills";

const client = new ShopifyClient({
  storeUrl: "my-store.myshopify.com",
  accessToken: "shpat_xxxxx",
});

const { data } = await client.graphql(`{
  products(first: 5) {
    nodes { id title }
  }
}`);
```

## AI Agent

Requires `@anthropic-ai/sdk`:

```ts
import { ShopifyClient } from "@clawpify/skills";
import { ShopifyAgent } from "@clawpify/skills/agent";
import { loadSkills } from "@clawpify/skills/skills";

const client = new ShopifyClient({ storeUrl, accessToken });
const agent = new ShopifyAgent({ shopify: client, skillContent: await loadSkills() });

const result = await agent.chat("List my products");
console.log(result.response);
```

## MCP Server

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "shopify": {
      "command": "npx",
      "args": ["@clawpify/skills"]
    }
  }
}
```

Create `~/.clawpify/.env`:

```bash
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=shpss_xxxxx
```

## What It Covers

Products, Orders, Customers, Inventory, Discounts, Collections, Gift Cards, Refunds, Draft Orders, Webhooks, and [more](./clawpify/references/).

## License

MIT
