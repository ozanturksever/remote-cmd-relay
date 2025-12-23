import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { credentialTypeValidator, storageModeValidator } from "./schema";

/**
 * Create a shared credential
 */
export const create = mutation({
  args: {
    name: v.string(),
    credentialType: credentialTypeValidator,
    encryptedValue: v.string(),
    assignedRelays: v.array(v.string()),
    targetHost: v.optional(v.string()),
  },
  returns: v.id("sharedCredentials"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("sharedCredentials", {
      name: args.name,
      credentialType: args.credentialType,
      encryptedValue: args.encryptedValue,
      assignedRelays: args.assignedRelays,
      targetHost: args.targetHost,
      createdBy: "system", // Required by schema
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * List credential inventory by relay ID
 */
export const listByRelay = query({
  args: {
    relayId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("relayCredentialInventory"),
      relayId: v.string(),
      credentialName: v.string(),
      credentialType: credentialTypeValidator,
      targetHost: v.optional(v.string()),
      storageMode: storageModeValidator,
      lastUpdatedAt: v.number(),
      reportedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const inventory = await ctx.db
      .query("relayCredentialInventory")
      .withIndex("by_relayId", (q) => q.eq("relayId", args.relayId))
      .collect();

    return inventory.map((c) => ({
      _id: c._id,
      relayId: c.relayId,
      credentialName: c.credentialName,
      credentialType: c.credentialType,
      targetHost: c.targetHost,
      storageMode: c.storageMode,
      lastUpdatedAt: c.lastUpdatedAt,
      reportedAt: c.reportedAt,
    }));
  },
});

/**
 * List all shared credentials
 */
export const listAll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("sharedCredentials"),
      name: v.string(),
      credentialType: credentialTypeValidator,
      assignedRelays: v.array(v.string()),
      targetHost: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const creds = await ctx.db.query("sharedCredentials").collect();
    return creds.map((c) => ({
      _id: c._id,
      name: c.name,
      credentialType: c.credentialType,
      assignedRelays: c.assignedRelays,
      targetHost: c.targetHost,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  },
});

/**
 * Delete a shared credential
 */
export const remove = mutation({
  args: {
    id: v.id("sharedCredentials"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
