# Clawpify

MCP server for Shopify GraphQL Admin API. Deploy your own instance to use with Claude Code or OpenClaw.

## Install

```bash
git clone https://github.com/yourname/clawpify.git
cd clawpify
bun install
```

## Configure

Create `~/.clawpify/.env` with your Shopify credentials:

```bash
mkdir -p ~/.clawpify
cat > ~/.clawpify/.env << 'EOF'
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
EOF
```

Get credentials from: Shopify Admin → Settings → Apps → Develop apps → Your App

## Add to MCP Client

**Claude Code** - add to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "shopify": {
      "command": "bun",
      "args": ["run", "/full/path/to/clawpify/src/mcp-server.ts"]
    }
  }
}
```
 
**OpenClaw** - add to `~/.clawdbot/mcp.json`:
```json
{
  "mcpServers": {
    "shopify": {
      "command": "bun",
      "args": ["run", "/full/path/to/clawpify/src/mcp-server.ts"]
    }
  }
}
```

Restart Claude Code / OpenClaw after adding config.

## Test

```bash
bun run mcp
```

## Tool

The server exposes one tool:

- `shopify_graphql(query, variables)` - Execute GraphQL queries/mutations against Shopify Admin API
