import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

// CORS headers for relay endpoints
export const relayCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
};

/**
 * Verify a relay API key from the request.
 * In test mode, uses the testApiKeyMappings table to bypass Better Auth's Scrypt hashing.
 */
export async function verifyRelayApiKey(
  ctx: Parameters<typeof httpAction>[0],
  apiKey: string | null
): Promise<
  | { valid: true; apiKeyId: string; response?: never }
  | { valid: false; apiKeyId?: never; response: Response }
> {
  if (!apiKey) {
    return {
      valid: false,
      response: new Response(
        JSON.stringify({ error: "API key is required" }),
        { status: 401, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  // In test mode, check the testApiKeyMappings table
  const isTestMode = process.env.IS_TEST === "true";
  
  if (isTestMode) {
    // Look up the raw key in the test mappings table
    const mapping = await ctx.runQuery(api.testing.relay.verifyTestApiKey, {
      rawKey: apiKey,
    });

    if (mapping.valid && mapping.keyId) {
      return { valid: true, apiKeyId: mapping.keyId };
    }
  }

  // If not in test mode or test key not found, return unauthorized
  return {
    valid: false,
    response: new Response(
      JSON.stringify({ error: "Invalid API key" }),
      { status: 401, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    ),
  };
}
