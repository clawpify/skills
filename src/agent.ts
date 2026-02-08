import Anthropic from "@anthropic-ai/sdk";
import { ShopifyClient } from "./shopify";
import type { MemoryStore } from "./memory";
import { loadSkillReference } from "./skills";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Accumulated token usage and estimated cost for a single chat() call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Estimated USD cost based on the configured pricing. */
  totalCost: number;
}

/** Per-model pricing in USD per million tokens. */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

/** A user-provided tool + handler that extends the agent's capabilities. */
export interface AgentPlugin {
  tool: Anthropic.Tool;
  handler: (input: Record<string, any>) => Promise<string>;
}

/** Lifecycle hooks for observability and custom behavior. */
export interface AgentHooks {
  /** Fires before a chat request is processed. */
  onRequest?: (
    message: string,
    history: Anthropic.MessageParam[]
  ) => void | Promise<void>;

  /** Fires before each Anthropic API call (including retries in the loop). */
  onApiCall?: (params: {
    model: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
  }) => void | Promise<void>;

  /** Fires before a tool handler is executed. */
  onToolCall?: (
    toolName: string,
    input: Record<string, any>
  ) => void | Promise<void>;

  /** Fires after a tool handler returns. */
  onToolResult?: (
    toolName: string,
    result: string,
    isError: boolean
  ) => void | Promise<void>;

  /** Fires after the final text response is assembled. */
  onResponse?: (
    response: string,
    usage: TokenUsage
  ) => void | Promise<void>;

  /** Fires when an error is caught during the chat loop. */
  onError?: (error: Error) => void | Promise<void>;
}

/** Extended thinking configuration. */
export interface ThinkingConfig {
  /** Token budget for thinking. Must be >= 1024. */
  budgetTokens: number;
}

/** Full configuration accepted by the ShopifyAgent constructor. */
export interface AgentConfig {
  shopify: ShopifyClient;
  skillContent: string;
  model?: string;
  /** Override the default system instruction sent to the model. */
  systemInstruction?: string;
  /** Override default Claude Sonnet pricing. */
  pricing?: ModelPricing;
  /** Register plugins at construction time. */
  plugins?: AgentPlugin[];
  /** Lifecycle hooks for observability. */
  hooks?: AgentHooks;
  /** Enable extended thinking so the model plans before executing. */
  thinking?: ThinkingConfig;
  /** Maximum tool-use loop iterations before the agent stops. Defaults to 20. */
  maxIterations?: number;
  /** Persistent memory store for conversation history across sessions. */
  memory?: MemoryStore;
}

/** Return value of a single chat() invocation. */
export interface ChatResult {
  response: string;
  history: Anthropic.MessageParam[];
  usage: TokenUsage;
  /** Concatenated thinking text when extended thinking is enabled. */
  thinking?: string;
  /** Number of tool-use loop iterations used in this call. */
  iterationsUsed: number;
}

/** Events yielded by chatStream(). */
export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, any> }
  | { type: "tool_result"; name: string; result: string; isError: boolean }
  | {
      type: "done";
      response: string;
      thinking?: string;
      usage: TokenUsage;
      iterationsUsed: number;
      history: Anthropic.MessageParam[];
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_INSTRUCTION =
  "You're Clawpify. You help run a Shopify store. The merchant texts you to get stuff done";

const SHOPIFY_GRAPHQL_TOOL: Anthropic.Tool = {
  name: "shopify_graphql",
  description:
    "Execute a GraphQL query against the Shopify Admin API. Use this to interact with products, orders, customers, inventory, and other Shopify resources.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The GraphQL query or mutation to execute",
      },
      variables: {
        type: "object",
        description: "Optional variables for the GraphQL query",
      },
    },
    required: ["query"],
  },
};

const LOAD_SKILL_REFERENCE_TOOL: Anthropic.Tool = {
  name: "load_skill_reference",
  description:
    "Load a Shopify GraphQL reference document for a specific domain. Available: products, orders, customers, inventory, discounts, collections, fulfillments, refunds, draft-orders, gift-cards, webhooks, locations, marketing, markets, menus, metafields, pages, blogs, files, shipping, shop, subscriptions, translations, segments, bulk-operations. Use this BEFORE writing GraphQL queries to get the correct syntax.",
  input_schema: {
    type: "object" as const,
    properties: {
      reference: {
        type: "string",
        description:
          "Name of the reference to load (e.g. 'orders', 'products', 'inventory')",
      },
    },
    required: ["reference"],
  },
};

/** Default pricing for claude-sonnet-4-5 (USD per million tokens). */
const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheWritePerMillion: 3.75,
  cacheReadPerMillion: 0.3,
};

const DEFAULT_MAX_ITERATIONS = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely invoke an async hook, swallowing errors so they never break the main flow. */
async function safeHook<T extends (...args: any[]) => void | Promise<void>>(
  hook: T | undefined,
  ...args: Parameters<T>
): Promise<void> {
  if (!hook) return;
  try {
    await hook(...args);
  } catch {
    // hooks must never break the agent loop
  }
}

function computeCost(usage: TokenUsage, pricing: ModelPricing): number {
  return (
    (usage.inputTokens * pricing.inputPerMillion) / 1_000_000 +
    (usage.outputTokens * pricing.outputPerMillion) / 1_000_000 +
    (usage.cacheCreationInputTokens * pricing.cacheWritePerMillion) /
      1_000_000 +
    (usage.cacheReadInputTokens * pricing.cacheReadPerMillion) / 1_000_000
  );
}

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCost: 0,
  };
}

function accumulateUsage(
  total: TokenUsage,
  raw: Anthropic.Usage,
  pricing: ModelPricing
): void {
  total.inputTokens += raw.input_tokens;
  total.outputTokens += raw.output_tokens;
  total.cacheCreationInputTokens += raw.cache_creation_input_tokens ?? 0;
  total.cacheReadInputTokens += raw.cache_read_input_tokens ?? 0;
  total.totalCost = computeCost(total, pricing);
}

/** Extract text and thinking content from an Anthropic Message. */
function extractContent(response: Anthropic.Message): {
  text: string;
  thinking: string;
} {
  let text = "";
  let thinking = "";
  for (const block of response.content) {
    if (block.type === "text") {
      text += (text ? "\n" : "") + block.text;
    } else if (block.type === "thinking") {
      thinking +=
        (thinking ? "\n" : "") + (block as Anthropic.ThinkingBlock).thinking;
    }
  }
  return { text, thinking };
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ShopifyAgent {
  private anthropic: Anthropic;
  private shopify: ShopifyClient;
  private skillContent: string;
  private systemInstruction: string;
  private model: string;
  private pricing: ModelPricing;
  private plugins: Map<string, AgentPlugin> = new Map();
  private hooks: AgentHooks;
  private thinkingConfig: ThinkingConfig | undefined;
  private maxIterations: number;
  private memory: MemoryStore | undefined;

  constructor(config: AgentConfig) {
    this.anthropic = new Anthropic();
    this.shopify = config.shopify;
    this.skillContent = config.skillContent;
    this.systemInstruction =
      config.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION;
    this.model = config.model ?? "claude-sonnet-4-5";
    this.pricing = config.pricing ?? DEFAULT_PRICING;
    this.hooks = config.hooks ?? {};
    this.thinkingConfig = config.thinking;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.memory = config.memory;

    // Register initial plugins
    if (config.plugins) {
      for (const plugin of config.plugins) {
        this.registerPlugin(plugin);
      }
    }
  }

  /** Register a plugin at runtime. Throws if a tool with the same name already exists. */
  registerPlugin(plugin: AgentPlugin): void {
    const name = plugin.tool.name;
    if (name === "shopify_graphql" || name === "load_skill_reference") {
      throw new Error(
        `Cannot register plugin with reserved tool name "${name}"`
      );
    }
    if (this.plugins.has(name)) {
      throw new Error(`Plugin with tool name "${name}" is already registered`);
    }
    this.plugins.set(name, plugin);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Build the system prompt array with prompt caching. */
  private buildSystemPrompt(): Anthropic.TextBlockParam[] {
    return [
      { type: "text", text: this.systemInstruction },
      {
        type: "text",
        text: this.skillContent,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  /** Build the tools list with cache_control on the last tool. */
  private buildTools(): Anthropic.Tool[] {
    const allTools: Anthropic.Tool[] = [
      SHOPIFY_GRAPHQL_TOOL,
      LOAD_SKILL_REFERENCE_TOOL,
      ...[...this.plugins.values()].map((p) => p.tool),
    ];
    if (allTools.length > 0) {
      const last = allTools[allTools.length - 1];
      allTools[allTools.length - 1] = Object.assign({}, last, {
        cache_control: { type: "ephemeral" } as const,
      });
    }
    return allTools;
  }

  /** Compute max_tokens accounting for thinking budget. */
  private getMaxTokens(): number {
    return this.thinkingConfig
      ? this.thinkingConfig.budgetTokens + 4096
      : 4096;
  }

  /** Build optional thinking param for the API call. */
  private getThinkingParam():
    | { thinking: Anthropic.ThinkingConfigParam }
    | {} {
    if (!this.thinkingConfig) return {};
    return {
      thinking: {
        type: "enabled" as const,
        budget_tokens: this.thinkingConfig.budgetTokens,
      },
    };
  }

  /** Execute a single tool call by name. Returns content and error flag. */
  private async executeTool(
    name: string,
    input: Record<string, any>
  ): Promise<{ content: string; isError: boolean }> {
    await safeHook(this.hooks.onToolCall, name, input);

    if (name === "shopify_graphql") {
      try {
        const result = await this.shopify.graphql(input.query, input.variables);
        const content = JSON.stringify(result, null, 2);
        await safeHook(this.hooks.onToolResult, name, content, false);
        return { content, isError: false };
      } catch (error) {
        const content = `Error: ${error instanceof Error ? error.message : String(error)}`;
        await safeHook(this.hooks.onToolResult, name, content, true);
        return { content, isError: true };
      }
    }

    if (name === "load_skill_reference") {
      try {
        const content = await loadSkillReference(input.reference);
        await safeHook(this.hooks.onToolResult, name, content, false);
        return { content, isError: false };
      } catch (error) {
        const content = `Error: ${error instanceof Error ? error.message : String(error)}`;
        await safeHook(this.hooks.onToolResult, name, content, true);
        return { content, isError: true };
      }
    }

    if (this.plugins.has(name)) {
      const plugin = this.plugins.get(name)!;
      try {
        const content = await plugin.handler(input);
        await safeHook(this.hooks.onToolResult, name, content, false);
        return { content, isError: false };
      } catch (error) {
        const content = `Error: ${error instanceof Error ? error.message : String(error)}`;
        await safeHook(this.hooks.onToolResult, name, content, true);
        return { content, isError: true };
      }
    }

    // Unknown tool
    const content = `Error: Unknown tool "${name}"`;
    await safeHook(this.hooks.onToolResult, name, content, true);
    return { content, isError: true };
  }

  /** Process all tool_use blocks from a response, returning tool results. */
  private async processToolCalls(
    response: Anthropic.Message
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const input = toolUse.input as Record<string, any>;
      const { content, isError } = await this.executeTool(toolUse.name, input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
    }
    return toolResults;
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  /**
   * Send a message and get a complete response (non-streaming).
   * Runs the agentic tool-use loop until the model produces a final text response.
   */
  async chat(
    userMessage: string,
    conversationHistory: Anthropic.MessageParam[] = []
  ): Promise<ChatResult> {
    const usage = emptyUsage();
    let iterationsUsed = 0;
    let allThinking = "";

    const systemPrompt = this.buildSystemPrompt();
    const allTools = this.buildTools();
    const maxTokens = this.getMaxTokens();
    const thinkingParam = this.getThinkingParam();

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    await safeHook(this.hooks.onRequest, userMessage, conversationHistory);

    try {
      await safeHook(this.hooks.onApiCall, {
        model: this.model,
        messages,
        tools: allTools,
      });

      let response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: allTools,
        messages,
        ...thinkingParam,
      });

      accumulateUsage(usage, response.usage, this.pricing);

      // Collect thinking from the first response
      const firstContent = extractContent(response);
      if (firstContent.thinking) allThinking += firstContent.thinking;

      // Agentic loop
      while (response.stop_reason === "tool_use") {
        iterationsUsed++;

        if (iterationsUsed > this.maxIterations) {
          const err = new Error(
            `Agent exceeded maximum iterations (${this.maxIterations})`
          );
          await safeHook(this.hooks.onError, err);
          break;
        }

        // Push assistant content and process tool calls
        messages.push({
          role: "assistant",
          content: response.content as Anthropic.ContentBlockParam[],
        });
        const toolResults = await this.processToolCalls(response);
        messages.push({ role: "user", content: toolResults });

        await safeHook(this.hooks.onApiCall, {
          model: this.model,
          messages,
          tools: allTools,
        });

        response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          system: systemPrompt,
          tools: allTools,
          messages,
          ...thinkingParam,
        });

        accumulateUsage(usage, response.usage, this.pricing);

        // Collect thinking from subsequent responses
        const loopContent = extractContent(response);
        if (loopContent.thinking) {
          allThinking +=
            (allThinking ? "\n" : "") + loopContent.thinking;
        }
      }

      // Extract final text response
      const { text: finalResponse } = extractContent(response);

      // Build updated history
      const updatedHistory: Anthropic.MessageParam[] = [
        ...messages,
        { role: "assistant", content: response.content },
      ];

      await safeHook(this.hooks.onResponse, finalResponse, usage);

      return {
        response: finalResponse,
        history: updatedHistory,
        usage,
        thinking: allThinking || undefined,
        iterationsUsed,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await safeHook(this.hooks.onError, err);
      throw err;
    }
  }

  /**
   * Send a message and stream the response as typed events.
   * Same agentic loop as chat() but yields incremental text/thinking deltas.
   */
  async *chatStream(
    userMessage: string,
    conversationHistory: Anthropic.MessageParam[] = []
  ): AsyncGenerator<StreamEvent> {
    const usage = emptyUsage();
    let iterationsUsed = 0;
    let allThinking = "";
    let finalResponse = "";

    const systemPrompt = this.buildSystemPrompt();
    const allTools = this.buildTools();
    const maxTokens = this.getMaxTokens();
    const thinkingParam = this.getThinkingParam();

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    await safeHook(this.hooks.onRequest, userMessage, conversationHistory);

    try {
      let stopReason: string | null = null;

      do {
        await safeHook(this.hooks.onApiCall, {
          model: this.model,
          messages,
          tools: allTools,
        });

        const stream = this.anthropic.messages.stream({
          model: this.model,
          max_tokens: maxTokens,
          system: systemPrompt,
          tools: allTools,
          messages,
          ...thinkingParam,
        });

        // Yield incremental deltas
        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta as { type: string; [key: string]: any };
            if (delta.type === "text_delta") {
              yield { type: "text", text: delta.text };
            } else if (delta.type === "thinking_delta") {
              yield { type: "thinking", text: delta.thinking };
            }
          }
        }

        const response = await stream.finalMessage();
        accumulateUsage(usage, response.usage, this.pricing);
        stopReason = response.stop_reason;

        // Collect thinking and text from this response
        const content = extractContent(response);
        if (content.thinking) {
          allThinking += (allThinking ? "\n" : "") + content.thinking;
        }
        if (content.text) {
          finalResponse = content.text;
        }

        if (stopReason === "tool_use") {
          iterationsUsed++;

          if (iterationsUsed > this.maxIterations) {
            const err = new Error(
              `Agent exceeded maximum iterations (${this.maxIterations})`
            );
            await safeHook(this.hooks.onError, err);
            break;
          }

          // Push assistant content
          messages.push({
            role: "assistant",
            content: response.content as Anthropic.ContentBlockParam[],
          });

          // Execute tools and yield events
          const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.ToolUseBlock =>
              block.type === "tool_use"
          );

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const toolUse of toolUseBlocks) {
            const input = toolUse.input as Record<string, any>;
            yield { type: "tool_call", name: toolUse.name, input };

            const result = await this.executeTool(toolUse.name, input);
            yield {
              type: "tool_result",
              name: toolUse.name,
              result: result.content,
              isError: result.isError,
            };

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: result.content,
              ...(result.isError ? { is_error: true } : {}),
            });
          }

          messages.push({ role: "user", content: toolResults });
        } else {
          // Final response — add to history
          messages.push({
            role: "assistant",
            content: response.content as Anthropic.ContentBlockParam[],
          });
        }
      } while (stopReason === "tool_use");

      await safeHook(this.hooks.onResponse, finalResponse, usage);

      yield {
        type: "done",
        response: finalResponse,
        thinking: allThinking || undefined,
        usage,
        iterationsUsed,
        history: messages,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await safeHook(this.hooks.onError, err);
      throw err;
    }
  }

  /**
   * Chat with automatic session memory.
   * Loads conversation history from the memory store, runs chat(), and saves
   * the updated history back. Requires a MemoryStore to be configured.
   */
  async chatWithMemory(
    sessionId: string,
    userMessage: string
  ): Promise<ChatResult> {
    if (!this.memory) {
      throw new Error(
        "chatWithMemory requires a MemoryStore. Pass `memory` in AgentConfig."
      );
    }

    const history =
      (await this.memory.load(sessionId)) as Anthropic.MessageParam[];
    const result = await this.chat(userMessage, history);
    await this.memory.save(sessionId, result.history);
    return result;
  }
}
