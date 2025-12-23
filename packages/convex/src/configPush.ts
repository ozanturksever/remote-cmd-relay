import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { configPushTypeValidator } from "./schema";

/**
 * Queue a config push for a relay
 */
export const queue = mutation({
  args: {
    relayId: v.string(),
    pushType: v.string(),
    payload: v.string(),
  },
  returns: v.id("configPushQueue"),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Map string pushType to valid enum values
    const validPushTypes = ["credential", "ssh_targets", "allowed_commands", "metrics_interval"] as const;
    const pushType = validPushTypes.includes(args.pushType as typeof validPushTypes[number])
      ? (args.pushType as typeof validPushTypes[number])
      : "credential"; // Default to credential if invalid
    
    return await ctx.db.insert("configPushQueue", {
      relayId: args.relayId,
      pushType,
      payload: args.payload,
      status: "pending",
      createdBy: "system", // Required by schema
      createdAt: now,
    });
  },
});

/**
 * Get a config push by ID
 */
export const get = query({
  args: {
    id: v.id("configPushQueue"),
  },
  returns: v.union(
    v.object({
      _id: v.id("configPushQueue"),
      relayId: v.string(),
      pushType: v.string(),
      payload: v.string(),
      status: v.string(),
      createdAt: v.number(),
      ackedAt: v.optional(v.number()),
      errorMessage: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const push = await ctx.db.get(args.id);
    if (!push) return null;
    return {
      _id: push._id,
      relayId: push.relayId,
      pushType: push.pushType,
      payload: push.payload,
      status: push.status,
      createdAt: push.createdAt,
      ackedAt: push.ackedAt,
      errorMessage: push.errorMessage,
    };
  },
});

/**
 * List all config pushes
 */
export const listAll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("configPushQueue"),
      relayId: v.string(),
      pushType: v.string(),
      payload: v.string(),
      status: v.string(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const pushes = await ctx.db.query("configPushQueue").collect();
    return pushes.map((p) => ({
      _id: p._id,
      relayId: p.relayId,
      pushType: p.pushType,
      payload: p.payload,
      status: p.status,
      createdAt: p.createdAt,
    }));
  },
});
