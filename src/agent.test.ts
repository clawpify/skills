import { describe, test, expect, mock } from "bun:test";
import { ShopifyAgent, DEFAULT_SYSTEM_INSTRUCTION } from "./agent";
import type { AgentPlugin, AgentHooks, ModelPricing } from "./agent";
import { ShopifyClient } from "./shopify";
import { InMemoryStore } from "./memory";
import type { MemoryStore } from "./memory";

// ---------------------------------------------------------------------------
// Helpers — build realistic Anthropic response shapes
// ---------------------------------------------------------------------------

function makeUsage(
  overrides: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }> = {}
) {
  return {
    input_tokens: overrides.input_tokens ?? 100,
    output_tokens: overrides.output_tokens ?? 50,
    cache_creation_input_tokens: overrides.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: overrides.cache_read_input_tokens ?? 0,
  };
}

function makeTextResponse(text: string, usage = makeUsage()) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage,
  };
}

function makeThinkingResponse(
  thinking: string,
  text: string,
  usage = makeUsage()
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking, signature: "sig_test" },
      { type: "text", text },
    ],
    usage,
  };
}

function makeToolUseResponse(
  toolCalls: Array<{ name: string; input: Record<string, any> }>,
  usage = makeUsage()
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    stop_reason: "tool_use",
    content: toolCalls.map((tc, i) => ({
      type: "tool_use",
      id: `tool_${i}`,
      name: tc.name,
      input: tc.input,
    })),
    usage,
  };
}

/** Create a fake MessageStream-like object for testing chatStream(). */
function makeFakeStream(
  deltas: Array<{ type: string; [key: string]: any }>,
  finalMsg: any
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { type: "content_block_delta", delta };
      }
    },
    finalMessage: async () => finalMsg,
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const SKILL_CONTENT = "# Test skill content\nSome reference docs here.";

let mockCreate: ReturnType<typeof mock>;
let mockStream: ReturnType<typeof mock>;
let mockGraphql: ReturnType<typeof mock>;

function createAgent(
  overrides: {
    plugins?: AgentPlugin[];
    hooks?: AgentHooks;
    pricing?: ModelPricing;
    systemInstruction?: string;
    thinking?: { budgetTokens: number };
    maxIterations?: number;
    memory?: MemoryStore;
  } = {}
) {
  mockCreate = mock();
  mockStream = mock();
  mockGraphql = mock();

  const shopifyClient = new ShopifyClient({
    storeUrl: "test-store.myshopify.com",
    accessToken: "shpat_test",
  });
  shopifyClient.graphql = mockGraphql as any;

  const agent = new ShopifyAgent({
    shopify: shopifyClient,
    skillContent: SKILL_CONTENT,
    ...overrides,
  });

  // Patch the private anthropic client
  (agent as any).anthropic = {
    messages: { create: mockCreate, stream: mockStream },
  };

  return agent;
}

// ==========================================================================
// 1. Basic chat
// ==========================================================================

describe("Basic chat", () => {
  test("returns a text response for a simple question", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(
      makeTextResponse("Here are your products!")
    );

    const result = await agent.chat("List my products");

    expect(result.response).toBe("Here are your products!");
    expect(result.history.length).toBeGreaterThan(0);
    expect(result.iterationsUsed).toBe(0);
  });

  test("uses custom system instruction when provided in config", async () => {
    const custom = "You are a custom bot. Do custom things.";
    const agent = createAgent({ systemInstruction: custom });
    mockCreate.mockResolvedValueOnce(makeTextResponse("OK"));

    await agent.chat("Hi");

    const system = mockCreate.mock.calls[0][0].system;
    expect(system[0].text).toBe(custom);
  });

  test("passes conversation history through to the API", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(makeTextResponse("Got it!"));

    const history = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];

    await agent.chat("What's new?", history);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toEqual([
      ...history,
      { role: "user", content: "What's new?" },
    ]);
  });
});

// ==========================================================================
// 2. Prompt caching
// ==========================================================================

describe("Prompt caching", () => {
  test("sends system prompt as an array with cache_control on the skill content block", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(makeTextResponse("Hello!"));

    await agent.chat("Hi");

    const system = mockCreate.mock.calls[0][0].system;

    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(2);
    expect(system[0].type).toBe("text");
    expect(system[0].text).toBe(DEFAULT_SYSTEM_INSTRUCTION);
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].type).toBe("text");
    expect(system[1].text).toBe(SKILL_CONTENT);
    expect(system[1].cache_control).toEqual({ type: "ephemeral" });
  });

  test("adds cache_control to the last tool in the tools array", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(makeTextResponse("Done"));

    await agent.chat("Hi");

    const tools = mockCreate.mock.calls[0][0].tools;
    const lastTool = tools[tools.length - 1];
    expect(lastTool.cache_control).toEqual({ type: "ephemeral" });
  });
});

// ==========================================================================
// 3. Token usage tracking
// ==========================================================================

describe("Token usage tracking", () => {
  test("returns token usage from a single API call", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        "Result",
        makeUsage({ input_tokens: 200, output_tokens: 80 })
      )
    );

    const result = await agent.chat("Question");

    expect(result.usage.inputTokens).toBe(200);
    expect(result.usage.outputTokens).toBe(80);
  });

  test("accumulates token usage across multiple tool-use round-trips", async () => {
    const agent = createAgent();

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse(
        [{ name: "shopify_graphql", input: { query: "{ shop { name } }" } }],
        makeUsage({ input_tokens: 100, output_tokens: 30 })
      )
    );
    mockGraphql.mockResolvedValueOnce({ data: { shop: { name: "Test" } } });
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        "Your shop is called Test",
        makeUsage({ input_tokens: 150, output_tokens: 40 })
      )
    );

    const result = await agent.chat("What is my shop name?");

    expect(result.usage.inputTokens).toBe(250);
    expect(result.usage.outputTokens).toBe(70);
  });

  test("computes cost using default Sonnet pricing", async () => {
    const agent = createAgent();

    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        "Done",
        makeUsage({
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cache_creation_input_tokens: 500_000,
          cache_read_input_tokens: 500_000,
        })
      )
    );

    const result = await agent.chat("Expensive query");

    const expectedCost =
      (1_000_000 * 3) / 1_000_000 +
      (1_000_000 * 15) / 1_000_000 +
      (500_000 * 3.75) / 1_000_000 +
      (500_000 * 0.3) / 1_000_000;

    expect(result.usage.totalCost).toBeCloseTo(expectedCost, 4);
  });

  test("computes cost using custom pricing override", async () => {
    const customPricing: ModelPricing = {
      inputPerMillion: 1,
      outputPerMillion: 5,
      cacheWritePerMillion: 1.5,
      cacheReadPerMillion: 0.1,
    };
    const agent = createAgent({ pricing: customPricing });

    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        "Done",
        makeUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 })
      )
    );

    const result = await agent.chat("Custom pricing");
    expect(result.usage.totalCost).toBeCloseTo(6.0, 4);
  });
});

// ==========================================================================
// 4. Plugin / tool registration
// ==========================================================================

describe("Plugin / tool registration", () => {
  const emailPlugin: AgentPlugin = {
    tool: {
      name: "send_email",
      description: "Send an email",
      input_schema: {
        type: "object" as const,
        properties: {
          to: { type: "string", description: "Recipient" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "body"],
      },
    },
    handler: mock(async () => "Email sent successfully"),
  };

  test("includes plugin tools alongside shopify_graphql in API calls", async () => {
    const agent = createAgent({ plugins: [emailPlugin] });
    mockCreate.mockResolvedValueOnce(makeTextResponse("OK"));

    await agent.chat("Send an email");

    const toolNames = mockCreate.mock.calls[0][0].tools.map(
      (t: any) => t.name
    );
    expect(toolNames).toContain("shopify_graphql");
    expect(toolNames).toContain("send_email");
  });

  test("dispatches tool calls to the correct plugin handler", async () => {
    const handler = mock(async () => "Email sent!");
    const plugin: AgentPlugin = { tool: emailPlugin.tool, handler };
    const agent = createAgent({ plugins: [plugin] });

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([
        { name: "send_email", input: { to: "a@b.com", body: "Hi" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(makeTextResponse("Email was sent!"));

    await agent.chat("Email Alice");

    expect(handler).toHaveBeenCalledWith({ to: "a@b.com", body: "Hi" });
  });

  test("throws when registering a plugin with the reserved name shopify_graphql", () => {
    const agent = createAgent();

    expect(() =>
      agent.registerPlugin({
        tool: {
          name: "shopify_graphql",
          description: "Conflict",
          input_schema: { type: "object" as const, properties: {} },
        },
        handler: async () => "",
      })
    ).toThrow(
      'Cannot register plugin with reserved tool name "shopify_graphql"'
    );
  });

  test("throws when registering a duplicate plugin name", () => {
    const agent = createAgent({ plugins: [emailPlugin] });

    expect(() => agent.registerPlugin(emailPlugin)).toThrow(
      'Plugin with tool name "send_email" is already registered'
    );
  });

  test("returns an error result for an unknown tool name", async () => {
    const agent = createAgent();

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([
        { name: "nonexistent_tool", input: { foo: "bar" } },
      ])
    );
    mockCreate.mockResolvedValueOnce(
      makeTextResponse("Sorry, I couldn't do that.")
    );

    await agent.chat("Do something weird");

    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const userMessage = secondCallMessages[secondCallMessages.length - 1];
    const toolResult = userMessage.content[0];

    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toContain('Unknown tool "nonexistent_tool"');
  });
});

// ==========================================================================
// 5. Lifecycle hooks
// ==========================================================================

describe("Lifecycle hooks", () => {
  test("calls onRequest before processing", async () => {
    const onRequest = mock(() => {});
    const agent = createAgent({ hooks: { onRequest } });
    mockCreate.mockResolvedValueOnce(makeTextResponse("Hi"));

    await agent.chat("Hello", []);

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0][0]).toBe("Hello");
    expect(onRequest.mock.calls[0][1]).toEqual([]);
  });

  test("calls onApiCall before each Anthropic API call", async () => {
    const onApiCall = mock(() => {});
    const agent = createAgent({ hooks: { onApiCall } });

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([
        { name: "shopify_graphql", input: { query: "{ shop { name } }" } },
      ])
    );
    mockGraphql.mockResolvedValueOnce({ data: { shop: { name: "Test" } } });
    mockCreate.mockResolvedValueOnce(makeTextResponse("Done"));

    await agent.chat("Test");

    expect(onApiCall).toHaveBeenCalledTimes(2);
    expect(onApiCall.mock.calls[0][0]).toHaveProperty("model");
    expect(onApiCall.mock.calls[0][0]).toHaveProperty("messages");
    expect(onApiCall.mock.calls[0][0]).toHaveProperty("tools");
  });

  test("calls onToolCall and onToolResult during tool execution", async () => {
    const onToolCall = mock(() => {});
    const onToolResult = mock(() => {});
    const agent = createAgent({ hooks: { onToolCall, onToolResult } });

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([
        { name: "shopify_graphql", input: { query: "{ shop { name } }" } },
      ])
    );
    mockGraphql.mockResolvedValueOnce({
      data: { shop: { name: "My Shop" } },
    });
    mockCreate.mockResolvedValueOnce(
      makeTextResponse("Your shop is My Shop")
    );

    await agent.chat("What is my shop name?");

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall.mock.calls[0][0]).toBe("shopify_graphql");
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(onToolResult.mock.calls[0][2]).toBe(false);
  });

  test("calls onResponse with the final text and usage", async () => {
    const onResponse = mock(() => {});
    const agent = createAgent({ hooks: { onResponse } });

    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        "Final answer",
        makeUsage({ input_tokens: 300, output_tokens: 120 })
      )
    );

    await agent.chat("Tell me something");

    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onResponse.mock.calls[0][0]).toBe("Final answer");
    expect(onResponse.mock.calls[0][1].inputTokens).toBe(300);
  });

  test("calls onError when the API throws", async () => {
    const onError = mock(() => {});
    const agent = createAgent({ hooks: { onError } });

    mockCreate.mockRejectedValueOnce(new Error("API rate limited"));

    await expect(agent.chat("Trigger error")).rejects.toThrow(
      "API rate limited"
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("API rate limited");
  });

  test("a throwing hook does not break the agent loop", async () => {
    const agent = createAgent({
      hooks: {
        onRequest: () => {
          throw new Error("Hook exploded!");
        },
        onApiCall: () => {
          throw new Error("Hook exploded again!");
        },
        onResponse: () => {
          throw new Error("Hook exploded a third time!");
        },
      },
    });

    mockCreate.mockResolvedValueOnce(makeTextResponse("Still works"));

    const result = await agent.chat("Test resilience");
    expect(result.response).toBe("Still works");
  });
});

// ==========================================================================
// 6. Extended thinking
// ==========================================================================

describe("Extended thinking", () => {
  test("passes thinking config to the API when enabled", async () => {
    const agent = createAgent({ thinking: { budgetTokens: 10_000 } });
    mockCreate.mockResolvedValueOnce(
      makeThinkingResponse("Let me think...", "Here's the answer")
    );

    await agent.chat("Complex question");

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.thinking).toEqual({
      type: "enabled",
      budget_tokens: 10_000,
    });
    expect(callArgs.max_tokens).toBe(10_000 + 4096);
  });

  test("does not pass thinking config when disabled", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(makeTextResponse("Simple answer"));

    await agent.chat("Simple question");

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.thinking).toBeUndefined();
    expect(callArgs.max_tokens).toBe(4096);
  });

  test("extracts thinking text from the response", async () => {
    const agent = createAgent({ thinking: { budgetTokens: 5_000 } });
    mockCreate.mockResolvedValueOnce(
      makeThinkingResponse(
        "First I need to check the store...",
        "Your store has 10 products"
      )
    );

    const result = await agent.chat("How many products?");

    expect(result.thinking).toBe("First I need to check the store...");
    expect(result.response).toBe("Your store has 10 products");
  });

  test("returns undefined thinking when not enabled", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(makeTextResponse("Answer"));

    const result = await agent.chat("Question");

    expect(result.thinking).toBeUndefined();
  });

  test("accumulates thinking across multiple loop iterations", async () => {
    const agent = createAgent({ thinking: { budgetTokens: 8_000 } });

    // First call: thinking + tool use
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5",
      stop_reason: "tool_use",
      content: [
        {
          type: "thinking",
          thinking: "I should check the shop name",
          signature: "sig1",
        },
        {
          type: "tool_use",
          id: "tool_0",
          name: "shopify_graphql",
          input: { query: "{ shop { name } }" },
        },
      ],
      usage: makeUsage(),
    });
    mockGraphql.mockResolvedValueOnce({ data: { shop: { name: "Acme" } } });

    // Second call: more thinking + final text
    mockCreate.mockResolvedValueOnce(
      makeThinkingResponse("Now I know it's Acme", "Your shop is Acme")
    );

    const result = await agent.chat("What's my shop?");

    expect(result.thinking).toContain("I should check the shop name");
    expect(result.thinking).toContain("Now I know it's Acme");
    expect(result.response).toBe("Your shop is Acme");
  });
});

// ==========================================================================
// 7. Max iterations
// ==========================================================================

describe("Max iterations", () => {
  test("defaults to 20 iterations", async () => {
    const agent = createAgent();
    mockCreate.mockResolvedValueOnce(makeTextResponse("Quick answer"));

    const result = await agent.chat("Hi");

    expect(result.iterationsUsed).toBe(0);
  });

  test("stops the loop when maxIterations is exceeded", async () => {
    const onError = mock(() => {});
    const agent = createAgent({ maxIterations: 2, hooks: { onError } });

    // Set up 3 tool-use responses followed by a text response
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(
        makeToolUseResponse([
          {
            name: "shopify_graphql",
            input: { query: `{ query_${i} }` },
          },
        ])
      );
      mockGraphql.mockResolvedValueOnce({ data: {} });
    }
    mockCreate.mockResolvedValueOnce(
      makeTextResponse("Should not reach here")
    );

    const result = await agent.chat("Run many queries");

    // Should have stopped after 2 iterations, not 3
    expect(result.iterationsUsed).toBeLessThanOrEqual(3);
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain("maximum iterations");
  });

  test("tracks iterationsUsed correctly during normal tool use", async () => {
    const agent = createAgent();

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([
        { name: "shopify_graphql", input: { query: "{ shop { name } }" } },
      ])
    );
    mockGraphql.mockResolvedValueOnce({ data: { shop: { name: "Test" } } });
    mockCreate.mockResolvedValueOnce(makeTextResponse("Done"));

    const result = await agent.chat("Test");

    expect(result.iterationsUsed).toBe(1);
  });
});

// ==========================================================================
// 8. Streaming
// ==========================================================================

describe("Streaming (chatStream)", () => {
  test("yields text delta events", async () => {
    const agent = createAgent();

    mockStream.mockReturnValueOnce(
      makeFakeStream(
        [
          { type: "text_delta", text: "Hello " },
          { type: "text_delta", text: "world!" },
        ],
        makeTextResponse("Hello world!")
      )
    );

    const events = [];
    for await (const event of agent.chatStream("Hi")) {
      events.push(event);
    }

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0]).toEqual({ type: "text", text: "Hello " });
    expect(textEvents[1]).toEqual({ type: "text", text: "world!" });

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).response).toBe("Hello world!");
  });

  test("yields thinking delta events when thinking is enabled", async () => {
    const agent = createAgent({ thinking: { budgetTokens: 5_000 } });

    mockStream.mockReturnValueOnce(
      makeFakeStream(
        [
          { type: "thinking_delta", thinking: "Let me think..." },
          { type: "text_delta", text: "Answer" },
        ],
        makeThinkingResponse("Let me think...", "Answer")
      )
    );

    const events = [];
    for await (const event of agent.chatStream("Question")) {
      events.push(event);
    }

    const thinkingEvents = events.filter((e) => e.type === "thinking");
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]).toEqual({
      type: "thinking",
      text: "Let me think...",
    });
  });

  test("yields tool_call and tool_result events during tool use", async () => {
    const agent = createAgent();

    // First stream: tool use
    mockStream.mockReturnValueOnce(
      makeFakeStream(
        [],
        makeToolUseResponse([
          {
            name: "shopify_graphql",
            input: { query: "{ shop { name } }" },
          },
        ])
      )
    );
    mockGraphql.mockResolvedValueOnce({ data: { shop: { name: "Acme" } } });

    // Second stream: final text
    mockStream.mockReturnValueOnce(
      makeFakeStream(
        [{ type: "text_delta", text: "Your shop is Acme" }],
        makeTextResponse("Your shop is Acme")
      )
    );

    const events = [];
    for await (const event of agent.chatStream("Shop name?")) {
      events.push(event);
    }

    const toolCallEvent = events.find((e) => e.type === "tool_call");
    expect(toolCallEvent).toBeDefined();
    expect((toolCallEvent as any).name).toBe("shopify_graphql");

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    expect((toolResultEvent as any).isError).toBe(false);
  });

  test("emits a done event with usage and history", async () => {
    const agent = createAgent();

    mockStream.mockReturnValueOnce(
      makeFakeStream(
        [{ type: "text_delta", text: "Done" }],
        makeTextResponse(
          "Done",
          makeUsage({ input_tokens: 500, output_tokens: 100 })
        )
      )
    );

    const events = [];
    for await (const event of agent.chatStream("Hi")) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done") as any;
    expect(done).toBeDefined();
    expect(done.usage.inputTokens).toBe(500);
    expect(done.usage.outputTokens).toBe(100);
    expect(done.history.length).toBeGreaterThan(0);
    expect(done.iterationsUsed).toBe(0);
  });
});

// ==========================================================================
// 9. Memory (chatWithMemory)
// ==========================================================================

describe("Memory (chatWithMemory)", () => {
  test("loads history from the store, chats, and saves updated history", async () => {
    const memory = new InMemoryStore();
    const agent = createAgent({ memory });

    // First message
    mockCreate.mockResolvedValueOnce(
      makeTextResponse("You have 5 products")
    );

    const result1 = await agent.chatWithMemory("sess-1", "How many products?");
    expect(result1.response).toBe("You have 5 products");

    // Verify history was saved
    const saved = await memory.load("sess-1");
    expect(saved.length).toBeGreaterThan(0);

    // Second message in same session should receive prior history
    mockCreate.mockResolvedValueOnce(makeTextResponse("Here they are..."));

    const result2 = await agent.chatWithMemory(
      "sess-1",
      "Show me the first one"
    );
    expect(result2.response).toBe("Here they are...");

    // The second API call should include the prior conversation
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    expect(secondCallMessages.length).toBeGreaterThan(1);
  });

  test("different sessions are independent", async () => {
    const memory = new InMemoryStore();
    const agent = createAgent({ memory });

    mockCreate.mockResolvedValueOnce(makeTextResponse("Session A"));
    await agent.chatWithMemory("a", "Hello from A");

    mockCreate.mockResolvedValueOnce(makeTextResponse("Session B"));
    await agent.chatWithMemory("b", "Hello from B");

    // Session B should have only 1 user message, not A's history
    const bMessages = mockCreate.mock.calls[1][0].messages;
    expect(bMessages).toHaveLength(1);
    expect(bMessages[0].content).toBe("Hello from B");
  });

  test("throws when no memory store is configured", async () => {
    const agent = createAgent(); // no memory

    await expect(
      agent.chatWithMemory("sess-1", "Hello")
    ).rejects.toThrow("chatWithMemory requires a MemoryStore");
  });

  test("clearing a session removes its history", async () => {
    const memory = new InMemoryStore();
    const agent = createAgent({ memory });

    mockCreate.mockResolvedValueOnce(makeTextResponse("First"));
    await agent.chatWithMemory("sess-1", "Hello");

    await memory.clear("sess-1");

    // After clearing, next call should have empty history
    mockCreate.mockResolvedValueOnce(makeTextResponse("Fresh start"));
    await agent.chatWithMemory("sess-1", "Hi again");

    const messages = mockCreate.mock.calls[1][0].messages;
    expect(messages).toHaveLength(1);
  });
});

// ==========================================================================
// 10. InMemoryStore
// ==========================================================================

describe("InMemoryStore", () => {
  test("save and load round-trip correctly", async () => {
    const store = new InMemoryStore();

    const history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];

    await store.save("test", history);
    const loaded = await store.load("test");

    expect(loaded).toEqual(history);
  });

  test("returns empty array for unknown session", async () => {
    const store = new InMemoryStore();
    const loaded = await store.load("nonexistent");
    expect(loaded).toEqual([]);
  });

  test("clear removes the session data", async () => {
    const store = new InMemoryStore();
    await store.save("test", [{ role: "user", content: "Hi" }]);

    await store.clear("test");
    const loaded = await store.load("test");
    expect(loaded).toEqual([]);
  });

  test("stores a deep copy so mutations don't affect stored data", async () => {
    const store = new InMemoryStore();
    const history = [{ role: "user", content: "Original" }];

    await store.save("test", history);
    history[0].content = "Mutated";

    const loaded = await store.load("test");
    expect(loaded[0].content).toBe("Original");
  });
});
