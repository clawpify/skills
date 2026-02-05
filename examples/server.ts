import { ShopifyAgent } from "../src/agent";
import { ShopifyClient } from "../src/shopify";
import { createAuthenticatedConfig } from "../src/auth";
import { loadSkills } from "../src/skills";

const skillContent = await loadSkills();

// Create Shopify client using OAuth client credentials
const config = await createAuthenticatedConfig();
const shopify = new ShopifyClient({
  storeUrl: config.storeUrl,
  accessToken: config.accessToken,
});
const agent = new ShopifyAgent({ shopify, skillContent });

// Store conversation histories by session
const sessions = new Map<string, any[]>();

Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  routes: {
    "/": new Response(
      JSON.stringify({
        message: "Shopify Agent API",
        endpoints: {
          "POST /chat": {
            description: "Chat with the Shopify agent",
            body: {
              message: "string (required)",
              sessionId: "string (optional, for conversation continuity)",
            },
          },
          "DELETE /session/:id": {
            description: "Clear a conversation session",
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    ),

    "/chat": {
      POST: async (req) => {
        try {
          const body = (await req.json()) as { message?: string; sessionId?: string };
          const { message, sessionId = "default" } = body;

          if (!message || typeof message !== "string") {
            return Response.json(
              { error: "message is required and must be a string" },
              { status: 400 }
            );
          }

          // Get or create conversation history
          const history = sessions.get(sessionId) ?? [];

          // Run agent
          const result = await agent.chat(message, history);

          // Update session history
          sessions.set(sessionId, result.history);

          return Response.json({
            response: result.response,
            sessionId,
          });
        } catch (error) {
          console.error("Chat error:", error);
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Internal server error",
            },
            { status: 500 }
          );
        }
      },
    },

    "/session/:id": {
      DELETE: (req) => {
        const sessionId = req.params.id;
        const existed = sessions.delete(sessionId);
        return Response.json({
          success: true,
          message: existed ? "Session cleared" : "Session not found",
        });
      },
    },
  },

  fetch(req) {
    // Fallback for unmatched routes
    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Shopify Agent running on http://localhost:${process.env.PORT ?? 3000}`);
