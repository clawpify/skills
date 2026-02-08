/**
 * Clawpify - Shopify Agent SDK
 *
 * Query and manage Shopify stores via GraphQL Admin API with AI agents.
 *
 * @example
 * ```ts
 * import { ShopifyClient } from "clawpify";
 *
 * const client = new ShopifyClient({
 *   storeUrl: "my-store.myshopify.com",
 *   accessToken: "shpat_xxxxx",
 * });
 *
 * const { data } = await client.graphql(`{
 *   products(first: 5) {
 *     nodes { id title }
 *   }
 * }`);
 * ```
 *
 * @example Using the AI agent (requires @anthropic-ai/sdk)
 * ```ts
 * import { ShopifyClient } from "clawpify";
 * import { ShopifyAgent } from "clawpify/agent";
 * import { loadSkills } from "clawpify/skills";
 *
 * const client = new ShopifyClient({ storeUrl, accessToken });
 * const skills = await loadSkills();
 * const agent = new ShopifyAgent({ shopify: client, skillContent: skills });
 *
 * const result = await agent.chat("List my products");
 * console.log(result.response);
 * ```
 */

// Core client
export { ShopifyClient, createShopifyClient } from "./shopify";

// Authentication
export {
  createAuthenticatedConfig,
  getAccessToken,
  type AccessTokenResponse,
  type ClientCredentialsConfig,
} from "./auth";

// AI Agent (requires @anthropic-ai/sdk peer dependency)
export { ShopifyAgent, DEFAULT_SYSTEM_INSTRUCTION } from "./agent";
export type {
  AgentConfig,
  AgentHooks,
  AgentPlugin,
  ChatResult,
  ModelPricing,
  StreamEvent,
  ThinkingConfig,
  TokenUsage,
} from "./agent";

// Memory
export { InMemoryStore } from "./memory";
export type { MemoryStore } from "./memory";

// Skills loader
export {
  loadSkills,
  loadSkillMetadata,
  loadSkillReference,
  listSkillReferences,
} from "./skills";

// Re-export types for convenience
export type { ShopifyClientConfig, GraphQLResponse } from "./shopify";
