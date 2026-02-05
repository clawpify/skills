/**
 * Shopify OAuth Client Credentials
 * For apps installed on stores you own (server-to-server)
 */

export interface AccessTokenResponse {
  accessToken: string;
  scope: string;
  expiresIn: number;
}

export interface ClientCredentialsConfig {
  storeUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Get an access token using the Client Credentials grant.
 * Token expires in 24 hours and must be refreshed with the same request.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
export async function getAccessToken(
  config: ClientCredentialsConfig
): Promise<AccessTokenResponse> {
  const storeUrl = config.storeUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const response = await fetch(
    `https://${storeUrl}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth error (${response.status}): ${text}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    scope: data.scope,
    expiresIn: data.expires_in,
  };
}

/**
 * Create a Shopify client config from environment variables.
 * Supports two authentication methods:
 * 1. Direct access token (SHOPIFY_ACCESS_TOKEN) - uses token directly
 * 2. Client credentials (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET) - fetches token via OAuth
 */
export async function createAuthenticatedConfig(): Promise<{
  storeUrl: string;
  accessToken: string;
  scope?: string;
  expiresIn?: number;
}> {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const directToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!storeUrl) {
    throw new Error("Missing required environment variable: SHOPIFY_STORE_URL");
  }

  // Option 1: Use direct access token if provided
  if (directToken) {
    return {
      storeUrl,
      accessToken: directToken,
    };
  }

  // Option 2: Use client credentials OAuth flow
  if (clientId && clientSecret) {
    const token = await getAccessToken({ storeUrl, clientId, clientSecret });
    return {
      storeUrl,
      accessToken: token.accessToken,
      scope: token.scope,
      expiresIn: token.expiresIn,
    };
  }

  throw new Error(
    "Missing authentication credentials. Provide either:\n" +
      "  - SHOPIFY_ACCESS_TOKEN (direct token), or\n" +
      "  - SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (OAuth client credentials)"
  );
}
