---
name: clawpify
description: Query and manage Shopify stores via GraphQL Admin API. Use for products, orders, customers, inventory, discounts, and all Shopify data operations.
---

# Shopify GraphQL Admin API

## How to Use

1. Use `load_skill_reference` to load the relevant reference FIRST
2. Use `shopify_graphql` to execute queries based on the loaded reference
3. Check for `errors` and `userErrors` in responses
4. Format all IDs as: `gid://shopify/Resource/123`

## Critical Operations Requiring Permission

IMPORTANT: Before executing any of the following, you MUST ask for explicit user permission:

- Refunds, order cancellations, gift card deactivation
- Inventory adjustments, product deletions, discount activations

Always show what will be changed and wait for confirmation.

## Available References

Load the reference for your domain using `load_skill_reference` before writing queries:

**Store**: [shop](reference/shop.md) | [locations](reference/locations.md) | [markets](reference/markets.md)
**Catalog**: [products](reference/products.md) | [collections](reference/collections.md) | [inventory](reference/inventory.md)
**Sales**: [orders](reference/orders.md) | [draft-orders](reference/draft-orders.md) | [fulfillments](reference/fulfillments.md) | [refunds](reference/refunds.md)
**Customers**: [customers](reference/customers.md) | [segments](reference/segments.md) | [gift-cards](reference/gift-cards.md)
**Pricing**: [discounts](reference/discounts.md) | [subscriptions](reference/subscriptions.md)
**Content**: [pages](reference/pages.md) | [blogs](reference/blogs.md) | [menus](reference/menus.md) | [translations](reference/translations.md) | [files](reference/files.md)
**Custom data**: [metafields](reference/metafields.md)
**Automation**: [webhooks](reference/webhooks.md) | [bulk-operations](reference/bulk-operations.md)
**Growth**: [marketing](reference/marketing.md) | [shipping](reference/shipping.md)
