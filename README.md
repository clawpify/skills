# Clawpify - Shopify Agent Skill

An [Anthropic Agent Skill](https://skill.md) that teaches Claude how to query and manage Shopify stores via the GraphQL Admin API.

## Installation

### Claude Code

Install directly using the skills command:

```bash
bunx skills add clawpify/shopify
```

Or if you want to add this repository as a marketplace:

```bash
/plugin marketplace add clawpify/skills
/plugin install shopify@clawpify-skills
```

### Claude.ai

1. Go to Skills settings in Claude.ai
2. Click "Add Custom Skill"
3. Upload the `shopify` folder or link to this repository
4. Enable the skill

### Claude API

Use the Skills API to programmatically add this skill:

```python
import anthropic

client = anthropic.Anthropic()

# Upload skill files
skill = client.beta.skills.create(
    name="shopify",
    files=[
        "shopify/SKILL.md",
        "shopify/references/products.md",
        "shopify/references/orders.md",
        # ... other reference files
    ]
)
```

## Prerequisites

You need a Shopify store with Admin API access:

1. Go to **Shopify Admin** → **Settings** → **Apps and sales channels** → **Develop apps**
2. Click **Create an app** or select an existing app
3. Configure **Admin API scopes**:
   - `read_products`, `write_products` - For product management
   - `read_orders`, `write_orders` - For order operations
   - `read_customers`, `write_customers` - For customer data
   - `read_inventory`, `write_inventory` - For inventory management
   - (Add others as needed for your use case)
4. Click **Install app** and copy the **Admin API access token**

## Configuration

### Option 1: MCP Server (Recommended)

Install the clawpify MCP server to provide the `shopify_graphql` tool that this skill uses:

**1. Install MCP Server:**
```bash
npm install -g clawpify
```

**2. Configure credentials** in `~/.clawpify/.env`:
```bash
mkdir -p ~/.clawpify
cat > ~/.clawpify/.env << 'EOF'
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF
```

**3. Add to Claude Code** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "shopify": {
      "command": "npx",
      "args": ["clawpify"],
      "description": "Shopify Admin API access"
    }
  }
}
```

**4. Restart Claude Code** to load the MCP server

### Option 2: Custom Function

If you have your own implementation of the `shopify_graphql` tool, this skill will work with it automatically. The tool should accept:
- `query` (string) - GraphQL query or mutation
- `variables` (object, optional) - GraphQL variables

## Usage Examples

Once installed, just ask Claude naturally about your Shopify store:

**Products:**
- "List my Shopify products"
- "Show products with low inventory"
- "Search for products tagged 'sale'"
- "Create a new product called 'Summer T-Shirt'"

**Orders:**
- "Show my recent orders"
- "Find orders from last week"
- "Get details for order #1234"
- "Cancel order #5678"

**Customers:**
- "List customers who spent over $100"
- "Find customer by email john@example.com"
- "Show VIP customers"

**Inventory:**
- "Check inventory for product X"
- "Which products are out of stock?"
- "Adjust inventory for SKU-123"

**Discounts:**
- "Create a 20% off discount code"
- "List active discount codes"
- "Deactivate discount SUMMER20"

## What This Skill Covers

This skill provides comprehensive Shopify GraphQL knowledge across all major domains:

### Core Commerce
- **Products** - List, search, create, update, delete products and variants
- **Orders** - View orders, cancel, process fulfillments
- **Customers** - List and manage customer data
- **Inventory** - Check stock levels, adjust quantities across locations
- **Collections** - Organize products into collections

### Marketing & Promotions
- **Discounts** - Create discount codes, automatic discounts, BXGY promotions
- **Marketing** - Marketing activities and events
- **Segments** - Customer segmentation for targeting

### International
- **Translations** - Translate products, pages, and content
- **Markets** - Multi-market setup and localized content

### Content & Storefront
- **Pages** - Create and update store pages
- **Blogs** - Blog and article management
- **Menus** - Navigation menu configuration
- **Files** - File uploads and media library
- **Metafields** - Custom data fields and metaobjects

### Fulfillment & Shipping
- **Fulfillments** - Create fulfillments, add tracking
- **Shipping** - Delivery profiles, zones, and rates
- **Locations** - Manage inventory locations

### Financial
- **Draft Orders** - Create orders on behalf of customers
- **Refunds** - Process refunds with restocking
- **Gift Cards** - Create, credit, and debit gift cards
- **Subscriptions** - Subscription contract management

### Store Management
- **Shop** - Store information and settings
- **Webhooks** - Event subscriptions for integrations
- **Bulk Operations** - Large async queries and mutations

See the [shopify/references/](./shopify/references/) folder for detailed documentation on each domain.

## Safety Features

The skill includes built-in safety warnings for dangerous operations:

**Critical Operations Requiring Permission:**
- Refunds (permanent financial transactions)
- Order cancellations (may trigger refunds)
- Gift card deactivation (irreversible)
- Inventory adjustments (affects stock levels)
- Product deletions (permanent removal)
- Discount activations (changes customer pricing)

Claude will automatically ask for your confirmation before executing these operations.

## Troubleshooting

### Skill not activating

- Ensure the skill is properly installed
- Check that the `shopify_graphql` tool is available (via MCP server or custom function)
- Try mentioning "Shopify" explicitly in your request

### Authentication errors

- Verify your `SHOPIFY_ACCESS_TOKEN` in `~/.clawpify/.env`
- Check that your Shopify app has the required API scopes
- Ensure the access token hasn't expired

### MCP server not connecting

- Restart Claude Code after adding MCP configuration
- Check MCP server logs for errors
- Verify the MCP server is installed: `npx clawpify --version`

## Examples in Action

### Create a Product

**You:** "Create a new product called 'Organic Cotton T-Shirt' priced at $29.99"

**Claude will:**
1. Activate the Shopify skill
2. Use the `shopify_graphql` tool to execute a `productCreate` mutation
3. Check for errors
4. Return the created product ID and details

### Check Low Stock

**You:** "Show me products with less than 10 units in stock"

**Claude will:**
1. Query products with inventory data
2. Filter for low stock items
3. Present a formatted list with current quantities

### Process a Refund

**You:** "Refund order #1234"

**Claude will:**
1. Ask for your confirmation (dangerous operation)
2. Fetch the order details to show you
3. Wait for your "yes" or "confirm"
4. Execute the refund if confirmed
5. Confirm the refund was processed

## Architecture

This skill works with the Model Context Protocol (MCP):

```
┌─────────────┐
│   Claude    │
│  (with skill)│
└──────┬──────┘
       │ Uses shopify_graphql tool
       ↓
┌─────────────┐
│ MCP Server  │
│  (clawpify) │
└──────┬──────┘
       │ Executes GraphQL
       ↓
┌─────────────┐
│   Shopify   │
│ Admin API   │
└─────────────┘
```

The skill teaches Claude HOW to use Shopify's GraphQL API, while the MCP server provides the actual connection to your Shopify store.

## Related Packages

- **MCP Server**: `npm install -g clawpify` - Provides the `shopify_graphql` tool
- **SDK**: Available for building custom Shopify AI applications

## License

MIT

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add your changes
4. Submit a pull request

## Support

- [GitHub Issues](https://github.com/clawpify/skills/issues)
- [Anthropic Skills Documentation](https://support.anthropic.com/en/articles/12512198-how-to-create-custom-skills)
- [Shopify GraphQL Admin API Docs](https://shopify.dev/docs/api/admin-graphql)
