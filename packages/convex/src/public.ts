import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  targetTypeValidator,
  capabilityValidator,
  metricsValidator,
  credentialTypeValidator,
  storageModeValidator,
} from "./schema";

/**
 * Verify a relay's API key and return its assignment details
 * This is called by relays on startup to verify their API key
 */
export const verifyRelay = query({
  args: {
    apiKeyId: v.string(),
  },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      assignmentId: v.string(),
      machineId: v.string(),
      name: v.string(),
    }),
    v.object({
      valid: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("relayAssignments")
      .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", args.apiKeyId))
      .first();

    if (!assignment) {
      return { valid: false as const, error: "No relay assignment found for this API key" };
    }

    if (!assignment.enabled) {
      return { valid: false as const, error: "Relay assignment is disabled" };
    }

    return {
      valid: true as const,
      assignmentId: assignment._id,
      machineId: assignment.machineId,
      name: assignment.name,
    };
  },
});

/**
 * Get pending commands for a relay to execute
 */
export const getPendingCommands = query({
  args: {
    machineId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("commandQueue"),
      command: v.string(),
      targetType: targetTypeValidator,
      targetHost: v.optional(v.string()),
      targetPort: v.optional(v.number()),
      targetUsername: v.optional(v.string()),
      timeoutMs: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const commands = await ctx.db
      .query("commandQueue")
      .withIndex("by_machineId_status", (q) =>
        q.eq("machineId", args.machineId).eq("status", "pending")
      )
      .order("asc")
      .take(10);

    return commands.map((c) => ({
      _id: c._id,
      command: c.command,
      targetType: c.targetType,
      targetHost: c.targetHost,
      targetPort: c.targetPort,
      targetUsername: c.targetUsername,
      timeoutMs: c.timeoutMs,
      createdAt: c.createdAt,
    }));
  },
});

/**
 * Claim a command for execution (atomic operation)
 */
export const claimCommand = mutation({
  args: {
    commandId: v.id("commandQueue"),
    assignmentId: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      command: v.object({
        _id: v.id("commandQueue"),
        command: v.string(),
        targetType: targetTypeValidator,
        targetHost: v.optional(v.string()),
        targetPort: v.optional(v.number()),
        targetUsername: v.optional(v.string()),
        timeoutMs: v.number(),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd) {
      return { success: false as const, error: "Command not found" };
    }

    if (cmd.status !== "pending") {
      return { success: false as const, error: "Command is not pending" };
    }

    await ctx.db.patch(args.commandId, {
      status: "claimed",
      claimedBy: args.assignmentId,
      claimedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      success: true as const,
      command: {
        _id: cmd._id,
        command: cmd.command,
        targetType: cmd.targetType,
        targetHost: cmd.targetHost,
        targetPort: cmd.targetPort,
        targetUsername: cmd.targetUsername,
        timeoutMs: cmd.timeoutMs,
      },
    };
  },
});

/**
 * Update partial output during command execution (for streaming)
 */
export const updatePartialOutput = mutation({
  args: {
    commandId: v.id("commandQueue"),
    partialOutput: v.optional(v.string()),
    partialStderr: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd) {
      return { success: false };
    }

    // Only update if command is still executing
    if (cmd.status !== "claimed" && cmd.status !== "executing") {
      return { success: false };
    }

    const updates: Record<string, unknown> = {
      status: "executing",
      updatedAt: Date.now(),
    };

    if (args.partialOutput !== undefined) {
      updates.partialOutput = args.partialOutput;
    }
    if (args.partialStderr !== undefined) {
      updates.partialStderr = args.partialStderr;
    }

    await ctx.db.patch(args.commandId, updates);
    return { success: true };
  },
});

/**
 * Submit command execution results
 */
export const submitResult = mutation({
  args: {
    commandId: v.id("commandQueue"),
    success: v.boolean(),
    output: v.optional(v.string()),
    stderr: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd) {
      return { success: false };
    }

    const now = Date.now();

    await ctx.db.patch(args.commandId, {
      status: args.success ? "completed" : "failed",
      output: args.output,
      stderr: args.stderr,
      exitCode: args.exitCode,
      error: args.error,
      durationMs: args.durationMs,
      completedAt: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

/**
 * Send heartbeat from relay to update last seen
 */
export const sendHeartbeat = mutation({
  args: {
    apiKeyId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("relayAssignments")
      .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", args.apiKeyId))
      .first();

    if (!assignment) {
      return { success: false };
    }

    await ctx.db.patch(assignment._id, {
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ===== Status and Capability Reporting =====

// Credential inventory item for reporting
const credentialInventoryItemValidator = v.object({
  credentialName: v.string(),
  credentialType: credentialTypeValidator,
  targetHost: v.optional(v.string()),
  storageMode: storageModeValidator,
  lastUpdatedAt: v.number(),
});

/**
 * Full status report from relay (called on startup and periodically)
 * Includes capabilities, metrics, and credential inventory
 */
export const reportFullStatus = mutation({
  args: {
    relayId: v.string(),
    capabilities: v.array(capabilityValidator),
    metrics: v.optional(metricsValidator),
    version: v.optional(v.string()),
    hostname: v.optional(v.string()),
    platform: v.optional(v.string()),
    credentials: v.array(credentialInventoryItemValidator),
  },
  returns: v.object({
    success: v.boolean(),
    pendingConfigPushes: v.number(),
    sharedCredentialsCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Update relay status
    const existingStatus = await ctx.db
      .query("relayStatus")
      .withIndex("by_relayId", (q) => q.eq("relayId", args.relayId))
      .first();

    if (existingStatus) {
      await ctx.db.patch(existingStatus._id, {
        capabilities: args.capabilities,
        metrics: args.metrics,
        version: args.version,
        hostname: args.hostname,
        platform: args.platform,
        lastHeartbeatAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("relayStatus", {
        relayId: args.relayId,
        capabilities: args.capabilities,
        metrics: args.metrics,
        version: args.version,
        hostname: args.hostname,
        platform: args.platform,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Sync credential inventory
    const existingCreds = await ctx.db
      .query("relayCredentialInventory")
      .withIndex("by_relayId", (q) => q.eq("relayId", args.relayId))
      .collect();

    const existingCredsMap = new Map(existingCreds.map((c) => [c.credentialName, c]));
    const reportedNames = new Set(args.credentials.map((c) => c.credentialName));

    // Delete credentials no longer reported
    for (const cred of existingCreds) {
      if (!reportedNames.has(cred.credentialName)) {
        await ctx.db.delete(cred._id);
      }
    }

    // Update or insert reported credentials
    for (const cred of args.credentials) {
      const existingCred = existingCredsMap.get(cred.credentialName);

      if (existingCred) {
        await ctx.db.patch(existingCred._id, {
          credentialType: cred.credentialType,
          targetHost: cred.targetHost,
          storageMode: cred.storageMode,
          lastUpdatedAt: cred.lastUpdatedAt,
          reportedAt: now,
        });
      } else {
        await ctx.db.insert("relayCredentialInventory", {
          relayId: args.relayId,
          credentialName: cred.credentialName,
          credentialType: cred.credentialType,
          targetHost: cred.targetHost,
          storageMode: cred.storageMode,
          lastUpdatedAt: cred.lastUpdatedAt,
          reportedAt: now,
        });
      }
    }

    // Count pending config pushes for this relay
    const pendingPushes = await ctx.db
      .query("configPushQueue")
      .withIndex("by_relayId_status", (q) =>
        q.eq("relayId", args.relayId).eq("status", "pending")
      )
      .collect();

    // Count shared credentials assigned to this relay
    const sharedCreds = await ctx.db.query("sharedCredentials").collect();
    const assignedSharedCreds = sharedCreds.filter((c) =>
      c.assignedRelays.includes(args.relayId)
    );

    return {
      success: true,
      pendingConfigPushes: pendingPushes.length,
      sharedCredentialsCount: assignedSharedCreds.length,
    };
  },
});

/**
 * Get pending config pushes for relay
 */
export const getPendingConfigPushes = query({
  args: {
    relayId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("configPushQueue"),
      pushType: v.string(),
      payload: v.string(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const pushes = await ctx.db
      .query("configPushQueue")
      .withIndex("by_relayId_status", (q) =>
        q.eq("relayId", args.relayId).eq("status", "pending")
      )
      .collect();

    return pushes.map((p) => ({
      _id: p._id,
      pushType: p.pushType,
      payload: p.payload,
      createdAt: p.createdAt,
    }));
  },
});

/**
 * Acknowledge a config push
 */
export const acknowledgeConfigPush = mutation({
  args: {
    pushId: v.id("configPushQueue"),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const push = await ctx.db.get(args.pushId);
    if (!push) {
      return { success: false };
    }

    await ctx.db.patch(args.pushId, {
      status: args.success ? "acked" : "failed",
      ackedAt: Date.now(),
      errorMessage: args.errorMessage,
    });

    return { success: true };
  },
});

/**
 * Get shared credentials assigned to this relay
 */
export const getSharedCredentials = query({
  args: {
    relayId: v.string(),
  },
  returns: v.array(
    v.object({
      name: v.string(),
      credentialType: credentialTypeValidator,
      targetHost: v.optional(v.string()),
      encryptedValue: v.string(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const creds = await ctx.db.query("sharedCredentials").collect();

    return creds
      .filter((c) => c.assignedRelays.includes(args.relayId))
      .map((c) => ({
        name: c.name,
        credentialType: c.credentialType,
        targetHost: c.targetHost,
        encryptedValue: c.encryptedValue,
        updatedAt: c.updatedAt,
      }));
  },
});
