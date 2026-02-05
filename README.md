# Clawpify

Agent Skill for Shopify GraphQL Admin API. Teaches Claude how to query and manage Shopify stores.

## Installation

```bash
bunx skills add clawpify/clawpify
```

## Setup

### 1. Get Shopify Credentials

1. Go to Shopify Admin → Settings → Apps → Develop apps
2. Create app and configure Admin API scopes
3. Install app and copy the Access Token

### 2. Install MCP Server

```bash
npm install -g clawpify
```

### 3. Configure

Create `~/.clawpify/.env`:
```bash
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Add to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "shopify": {
      "command": "npx",
      "args": ["clawpify"]
    }
  }
}
```

### 4. Restart Claude Code

## Usage

Just ask Claude naturally:
- "List my Shopify products"
- "Show recent orders"
- "Create a discount code"
- "Check inventory levels"

## What It Covers

- Products & Variants
- Orders & Fulfillments
- Customers
- Inventory & Locations
- Discounts & Promotions
- Collections
- Gift Cards
- Refunds
- Draft Orders
- Webhooks
- And more (25 Shopify domains)

## Safety

Claude will ask permission before:
- Creating refunds
- Cancelling orders
- Deleting products
- Adjusting inventory
- Activating discounts

## Documentation

See [clawpify/references/](./clawpify/references/) for detailed examples of each domain.

## License

MIT
