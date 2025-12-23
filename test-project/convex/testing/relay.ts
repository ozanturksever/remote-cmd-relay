import { testingMutation, testingQuery } from "./lib";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../../../packages/convex/src/_generated/dataModel";

/**
 * Generate a simple random string for test API keys.
 */
function generateTestApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "test_";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Store a test API key mapping in the main app table.
 * Note: This is now handled automatically by createTestApiKey, but kept for backwards compatibility.
 */
export const storeTestKeyMapping = testingMutation({
  args: {
    rawKey: v.string(),
    keyId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Check if mapping already exists
    const existing = await ctx.db
      .query("testApiKeyMappings")
      .withIndex("by_rawKey", (q) => q.eq("rawKey", args.rawKey))
      .first();
    
    if (!existing) {
      await ctx.db.insert("testApiKeyMappings", {
        rawKey: args.rawKey,
        keyId: args.keyId,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * Create a test API key.
 * This generates a random key and stores it in the testApiKeyMappings table.
 */
export const createTestApiKey = testingMutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.object({
    keyId: v.string(),
    rawKey: v.string(),
  }),
  handler: async (ctx, args): Promise<{ keyId: string; rawKey: string }> => {
    const now = Date.now();
    const rawKey = generateTestApiKey();
    const keyId = `apikey-${now}-${Math.random().toString(36).slice(2)}`;

    // Store the mapping so we can verify it later
    await ctx.db.insert("testApiKeyMappings", {
      rawKey,
      keyId,
      createdAt: now,
    });

    return {
      keyId,
      rawKey,
    };
  },
});

/**
 * Create a relay assignment linking an API key to a machine ID.
 */
export const createTestRelayAssignment = testingMutation({
  args: {
    apiKeyId: v.string(),
    machineId: v.string(),
    name: v.string(),
    createdBy: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const assignmentId = await ctx.runMutation(
      components.remoteCmdRelay.assignments.create,
      {
        apiKeyId: args.apiKeyId,
        machineId: args.machineId,
        name: args.name,
        createdBy: args.createdBy,
      }
    );

    return assignmentId as string;
  },
});

/**
 * Queue a command for relay execution.
 */
export const queueTestCommand = testingMutation({
  args: {
    machineId: v.string(),
    command: v.string(),
    targetType: v.union(v.literal("local"), v.literal("ssh")),
    targetHost: v.optional(v.string()),
    targetPort: v.optional(v.number()),
    targetUsername: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    createdBy: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const commandId = await ctx.runMutation(
      components.remoteCmdRelay.commands.queue,
      {
        machineId: args.machineId,
        command: args.command,
        targetType: args.targetType,
        targetHost: args.targetHost,
        targetPort: args.targetPort,
        targetUsername: args.targetUsername,
        timeoutMs: args.timeoutMs ?? 30000,
        createdBy: args.createdBy,
      }
    );

    return commandId as string;
  },
});

/**
 * Get a command by ID.
 */
export const getTestCommand = testingQuery({
  args: {
    commandId: v.string(),
  },
  handler: async (ctx, args) => {
    const command = await ctx.runQuery(
      components.remoteCmdRelay.commands.get,
      {
        id: args.commandId as Id<"commandQueue">,
      }
    );

    return command;
  },
});

/**
 * Check if relay is online by checking assignment's lastSeenAt.
 */
export const checkRelayOnline = testingQuery({
  args: {
    assignmentId: v.string(),
  },
  handler: async (ctx, args) => {
    const assignments = await ctx.runQuery(
      components.remoteCmdRelay.assignments.listAll,
      {}
    );
    
    const assignment = assignments.find(a => a._id === args.assignmentId);

    if (!assignment || !assignment.lastSeenAt) return false;

    // Consider online if seen within last 60 seconds
    const sixtySecondsAgo = Date.now() - 60000;
    return assignment.lastSeenAt > sixtySecondsAgo;
  },
});

/**
 * Verify a test API key by looking up the mapping.
 */
export const verifyTestApiKey = testingQuery({
  args: {
    rawKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean; keyId?: string }> => {
    const mapping = await ctx.db
      .query("testApiKeyMappings")
      .withIndex("by_rawKey", (q) => q.eq("rawKey", args.rawKey))
      .first();
    
    if (mapping) {
      return { valid: true, keyId: mapping.keyId };
    }
    return { valid: false };
  },
});

/**
 * Clear test API key mappings.
 */
export const clearTestKeyMappings = testingMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const mappings = await ctx.db.query("testApiKeyMappings").collect();
    await Promise.all(mappings.map((m) => ctx.db.delete(m._id)));
    return null;
  },
});

/**
 * Create a config push for a relay.
 */
export const createTestConfigPush = testingMutation({
  args: {
    relayId: v.string(),
    pushType: v.string(),
    payload: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const pushId = await ctx.runMutation(
      components.remoteCmdRelay.configPush.queue,
      {
        relayId: args.relayId,
        pushType: args.pushType,
        payload: args.payload,
      }
    );
    return pushId as string;
  },
});

/**
 * Get a config push by ID.
 */
export const getTestConfigPush = testingQuery({
  args: {
    pushId: v.string(),
  },
  handler: async (ctx, args) => {
    const push = await ctx.runQuery(
      components.remoteCmdRelay.configPush.get,
      {
        id: args.pushId as Id<"configPushQueue">,
      }
    );
    return push;
  },
});

/**
 * Create a shared credential for testing.
 */
export const createTestSharedCredential = testingMutation({
  args: {
    name: v.string(),
    credentialType: v.union(v.literal("ssh_key"), v.literal("password"), v.literal("api_key")),
    encryptedValue: v.string(),
    assignedRelays: v.array(v.string()),
    targetHost: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const credId = await ctx.runMutation(
      components.remoteCmdRelay.credentials.create,
      {
        name: args.name,
        credentialType: args.credentialType,
        encryptedValue: args.encryptedValue,
        assignedRelays: args.assignedRelays,
        targetHost: args.targetHost,
      }
    );
    return credId as string;
  },
});

/**
 * Get relay status by relay ID.
 */
export const getTestRelayStatus = testingQuery({
  args: {
    relayId: v.string(),
  },
  handler: async (ctx, args) => {
    const statuses = await ctx.runQuery(
      components.remoteCmdRelay.status.listAll,
      {}
    );
    return statuses.find(s => s.relayId === args.relayId) ?? null;
  },
});

/**
 * List credential inventory for a relay.
 */
export const listTestCredentialInventory = testingQuery({
  args: {
    relayId: v.string(),
  },
  handler: async (ctx, args) => {
    const inventory = await ctx.runQuery(
      components.remoteCmdRelay.credentials.listByRelay,
      { relayId: args.relayId }
    );
    return inventory;
  },
});
