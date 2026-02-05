export class ShopifyClient {
  private storeUrl: string;
  private accessToken: string;
  private apiVersion: string;

  constructor(config: {
    storeUrl: string;
    accessToken: string;
    apiVersion?: string;
  }) {
    this.storeUrl = config.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? "2026-01";
  }

  async graphql<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
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

    return response.json();
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
