export interface ShopifyClientConfig {
  /** Shopify store URL (e.g. "my-store.myshopify.com") */
  storeUrl: string;
  /** Admin API access token */
  accessToken: string;
  /** API version (defaults to "2026-01") */
  apiVersion?: string;
}

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }> }>;
  extensions?: Record<string, any>;
}

export class ShopifyClient {
  private storeUrl: string;
  private accessToken: string;
  private apiVersion: string;

  constructor(config: ShopifyClientConfig) {
    this.storeUrl = config.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? "2026-01";
  }

  /** Execute a GraphQL query or mutation against the Shopify Admin API */
  async graphql<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<GraphQLResponse<T>> {
    const url = `https://${this.storeUrl}/admin/api/${this.apiVersion}/graphql.json`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<GraphQLResponse<T>>;
  }
}

export function createShopifyClient() {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!storeUrl || !accessToken) {
    throw new Error(
      "Missing required environment variables: SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN"
    );
  }

  return new ShopifyClient({ storeUrl, accessToken });
}
