import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { verifyRelayApiKey, relayCorsHeaders } from "./relayAuth";
import type { Id } from "../../packages/convex/src/_generated/dataModel";

// Type alias for config push queue ID
type ConfigPushQueueId = Id<"configPushQueue">;

const http = httpRouter();

// ===== Remote Command Relay HTTP Endpoints =====

// OPTIONS handlers for CORS preflight
http.route({
  path: "/relay/verify",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/commands",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/commands/claim",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/commands/result",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/heartbeat",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/status",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/config-pushes",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/config-pushes/ack",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

http.route({
  path: "/relay/shared-credentials",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: relayCorsHeaders });
  }),
});

/**
 * Verify relay API key and return assignment details
 * POST /relay/verify
 * Body: { apiKey: string }
 */
http.route({
  path: "/relay/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { apiKey } = body as { apiKey: string };

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Check relay assignment
    const result = await ctx.runQuery(components.remoteCmdRelay.public.verifyRelay, {
      apiKeyId: verification.apiKeyId,
    });

    return new Response(
      JSON.stringify(result),
      {
        status: result.valid ? 200 : 403,
        headers: { ...relayCorsHeaders, "Content-Type": "application/json" }
      }
    );
  }),
});

/**
 * Get pending commands for relay's machine
 * GET /relay/commands
 * Header: X-API-Key: <api-key>
 */
http.route({
  path: "/relay/commands",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Get relay assignment
    const assignment = await ctx.runQuery(components.remoteCmdRelay.public.verifyRelay, {
      apiKeyId: verification.apiKeyId,
    });

    if (!assignment.valid) {
      return new Response(
        JSON.stringify({ error: assignment.error }),
        { status: 403, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get pending commands
    const commands = await ctx.runQuery(components.remoteCmdRelay.public.getPendingCommands, {
      machineId: assignment.machineId,
    });

    return new Response(
      JSON.stringify({ commands }),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Claim a command for execution
 * POST /relay/commands/claim
 * Header: X-API-Key: <api-key>
 * Body: { commandId: string }
 */
http.route({
  path: "/relay/commands/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    const body = await request.json();
    const { commandId } = body as { commandId: string };

    if (!commandId) {
      return new Response(
        JSON.stringify({ error: "commandId is required" }),
        { status: 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Get relay assignment
    const assignment = await ctx.runQuery(components.remoteCmdRelay.public.verifyRelay, {
      apiKeyId: verification.apiKeyId,
    });

    if (!assignment.valid) {
      return new Response(
        JSON.stringify({ error: assignment.error }),
        { status: 403, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Claim the command
    const result = await ctx.runMutation(components.remoteCmdRelay.public.claimCommand, {
      commandId: commandId as Id<"commandQueue">,
      assignmentId: assignment.assignmentId,
    });

    return new Response(
      JSON.stringify(result),
      { status: result.success ? 200 : 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Submit command execution result
 * POST /relay/commands/result
 * Header: X-API-Key: <api-key>
 * Body: { commandId, success, output?, stderr?, exitCode?, error?, durationMs? }
 */
http.route({
  path: "/relay/commands/result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    const body = await request.json();
    const { commandId, success, output, stderr, exitCode, error, durationMs } = body as {
      commandId: string;
      success: boolean;
      output?: string;
      stderr?: string;
      exitCode?: number;
      error?: string;
      durationMs?: number;
    };

    if (!commandId || typeof success !== "boolean") {
      return new Response(
        JSON.stringify({ error: "commandId and success are required" }),
        { status: 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Submit result
    const result = await ctx.runMutation(components.remoteCmdRelay.public.submitResult, {
      commandId: commandId as Id<"commandQueue">,
      success,
      output,
      stderr,
      exitCode,
      error,
      durationMs,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Report full relay status (capabilities, metrics, credentials)
 * POST /relay/status
 * Header: X-API-Key: <api-key>
 * Body: { relayId, capabilities, metrics?, version?, hostname?, platform?, credentials }
 */
http.route({
  path: "/relay/status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    const body = await request.json();
    const { relayId, capabilities, metrics, version, hostname, platform, credentials } = body as {
      relayId: string;
      capabilities: string[];
      metrics?: {
        cpuPercent?: number;
        memoryPercent?: number;
        memoryUsedMb?: number;
        memoryTotalMb?: number;
        diskPercent?: number;
        diskUsedGb?: number;
        diskTotalGb?: number;
        loadAvg1m?: number;
        loadAvg5m?: number;
        loadAvg15m?: number;
      };
      version?: string;
      hostname?: string;
      platform?: string;
      credentials: Array<{
        credentialName: string;
        credentialType: string;
        targetHost?: string;
        storageMode: string;
        lastUpdatedAt: number;
      }>;
    };

    if (!relayId || !capabilities || !credentials) {
      return new Response(
        JSON.stringify({ success: false, error: "relayId, capabilities, and credentials are required" }),
        { status: 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Report full status
    const result = await ctx.runMutation(components.remoteCmdRelay.public.reportFullStatus, {
      relayId,
      capabilities: capabilities as ("local_cmd" | "ssh" | "perf_metrics")[],
      metrics,
      version,
      hostname,
      platform,
      credentials: credentials.map(c => ({
        ...c,
        credentialType: c.credentialType as "ssh_key" | "password" | "api_key",
        storageMode: c.storageMode as "relay_only" | "shared",
      })),
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Get pending config pushes for relay
 * GET /relay/config-pushes
 * Header: X-API-Key: <api-key>
 * Query: relayId=<relay-assignment-id>
 */
http.route({
  path: "/relay/config-pushes",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    // Get relayId from query string
    const url = new URL(request.url);
    const relayId = url.searchParams.get("relayId");

    if (!relayId) {
      return new Response(
        JSON.stringify({ error: "relayId query parameter is required" }),
        { status: 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Get pending config pushes
    const configPushes = await ctx.runQuery(components.remoteCmdRelay.public.getPendingConfigPushes, {
      relayId,
    });

    return new Response(
      JSON.stringify({ configPushes }),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Acknowledge a config push
 * POST /relay/config-pushes/ack
 * Header: X-API-Key: <api-key>
 * Body: { pushId: string, success: boolean, errorMessage?: string }
 */
http.route({
  path: "/relay/config-pushes/ack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    const body = await request.json();
    const { pushId, success, errorMessage } = body as {
      pushId: string;
      success: boolean;
      errorMessage?: string;
    };

    if (!pushId || typeof success !== "boolean") {
      return new Response(
        JSON.stringify({ error: "pushId and success are required" }),
        { status: 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Acknowledge config push
    const result = await ctx.runMutation(components.remoteCmdRelay.public.acknowledgeConfigPush, {
      pushId: pushId as ConfigPushQueueId,
      success,
      errorMessage,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Get shared credentials assigned to this relay
 * GET /relay/shared-credentials
 * Header: X-API-Key: <api-key>
 * Query: relayId=<relay-assignment-id>
 */
http.route({
  path: "/relay/shared-credentials",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    // Get relayId from query string
    const url = new URL(request.url);
    const relayId = url.searchParams.get("relayId");

    if (!relayId) {
      return new Response(
        JSON.stringify({ error: "relayId query parameter is required" }),
        { status: 400, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return verification.response;
    }

    // Get shared credentials for this relay
    const credentials = await ctx.runQuery(components.remoteCmdRelay.public.getSharedCredentials, {
      relayId,
    });

    return new Response(
      JSON.stringify({ credentials }),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

/**
 * Send heartbeat from relay
 * POST /relay/heartbeat
 * Header: X-API-Key: <api-key>
 */
http.route({
  path: "/relay/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-API-Key");

    const verification = await verifyRelayApiKey(ctx, apiKey);
    if (!verification.valid) {
      return new Response(
        JSON.stringify({ success: false }),
        { status: 401, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send heartbeat
    const result = await ctx.runMutation(components.remoteCmdRelay.public.sendHeartbeat, {
      apiKeyId: verification.apiKeyId,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...relayCorsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

export default http;
