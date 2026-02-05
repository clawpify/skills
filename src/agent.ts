import Anthropic from "@anthropic-ai/sdk";
import { ShopifyClient } from "./shopify";

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

export class ShopifyAgent {
  private anthropic: Anthropic;
  private shopify: ShopifyClient;
  private skillContent: string;
  private model: string;

  constructor(config: {
    shopify: ShopifyClient;
    skillContent: string;
    model?: string;
  }) {
    this.anthropic = new Anthropic();
    this.shopify = config.shopify;
    this.skillContent = config.skillContent;
    this.model = config.model ?? "claude-sonnet-4-5";
  }

  async chat(
    userMessage: string,
    conversationHistory: Anthropic.MessageParam[] = []
  ): Promise<{ response: string; history: Anthropic.MessageParam[] }> {
    const systemPrompt = `You are a helpful Shopify assistant that can query and manage a Shopify store using the GraphQL Admin API.

${this.skillContent}

When the user asks about products, orders, customers, or any Shopify data, use the shopify_graphql tool to fetch or modify the data. Always explain what you're doing and present results clearly.`;

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    let response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [SHOPIFY_GRAPHQL_TOOL],
      messages,
    });

    const assistantMessages: Anthropic.ContentBlockParam[] = [];

    // Agentic loop: keep processing tool calls until we get a final response
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use"
      );

      assistantMessages.push(...(response.content as Anthropic.ContentBlockParam[]));

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === "shopify_graphql") {
          const input = toolUse.input as {
            query: string;
            variables?: Record<string, any>;
          };

          try {
            const result = await this.shopify.graphql(
              input.query,
              input.variables
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result, null, 2),
            });
          } catch (error) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
              is_error: true,
            });
          }
        }
      }

      messages.push({ role: "assistant", content: assistantMessages.slice() });
      messages.push({ role: "user", content: toolResults });
      assistantMessages.length = 0;

      response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: [SHOPIFY_GRAPHQL_TOOL],
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block: Anthropic.ContentBlock): block is Anthropic.TextBlock =>
        block.type === "text"
    );
    const finalResponse = textBlocks.map((b: Anthropic.TextBlock) => b.text).join("\n");

    // Build updated history
    const updatedHistory: Anthropic.MessageParam[] = [
      ...messages,
      { role: "assistant", content: response.content },
    ];

    return { response: finalResponse, history: updatedHistory };
  }
}
