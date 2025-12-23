import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { capabilityValidator, metricsValidator } from "./schema";

/**
 * Report relay status (capabilities, metrics, etc.)
 * Called by relay on startup and with each heartbeat
 */
export const reportStatus = mutation({
  args: {
    relayId: v.string(),
    capabilities: v.array(capabilityValidator),
    metrics: v.optional(metricsValidator),
    version: v.optional(v.string()),
    hostname: v.optional(v.string()),
    platform: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    statusId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if status record exists for this relay
    const existing = await ctx.db
      .query("relayStatus")
      .withIndex("by_relayId", (q) => q.eq("relayId", args.relayId))
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        capabilities: args.capabilities,
        metrics: args.metrics,
        version: args.version,
        hostname: args.hostname,
        platform: args.platform,
        lastHeartbeatAt: now,
        updatedAt: now,
      });
      return { success: true, statusId: existing._id };
    } else {
      // Create new record
      const id = await ctx.db.insert("relayStatus", {
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
      return { success: true, statusId: id };
    }
  },
});

/**
 * Get relay status by relay ID
 */
export const getByRelayId = query({
  args: {
    relayId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("relayStatus"),
      relayId: v.string(),
      capabilities: v.array(capabilityValidator),
      metrics: v.optional(metricsValidator),
      version: v.optional(v.string()),
      hostname: v.optional(v.string()),
      platform: v.optional(v.string()),
      lastHeartbeatAt: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const status = await ctx.db
      .query("relayStatus")
      .withIndex("by_relayId", (q) => q.eq("relayId", args.relayId))
      .first();

    if (!status) return null;

    return {
      _id: status._id,
      relayId: status.relayId,
      capabilities: status.capabilities,
      metrics: status.metrics,
      version: status.version,
      hostname: status.hostname,
      platform: status.platform,
      lastHeartbeatAt: status.lastHeartbeatAt,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
    };
  },
});

/**
 * List all relay statuses
 */
export const listAll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("relayStatus"),
      relayId: v.string(),
      capabilities: v.array(capabilityValidator),
      metrics: v.optional(metricsValidator),
      version: v.optional(v.string()),
      hostname: v.optional(v.string()),
      platform: v.optional(v.string()),
      lastHeartbeatAt: v.number(),
      isOnline: v.boolean(),
    })
  ),
  handler: async (ctx) => {
    const statuses = await ctx.db.query("relayStatus").collect();
    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 60000; // 1 minute

    return statuses.map((s) => ({
      _id: s._id,
      relayId: s.relayId,
      capabilities: s.capabilities,
      metrics: s.metrics,
      version: s.version,
      hostname: s.hostname,
      platform: s.platform,
      lastHeartbeatAt: s.lastHeartbeatAt,
      isOnline: now - s.lastHeartbeatAt < ONLINE_THRESHOLD_MS,
    }));
  },
});

/**
 * Find relays that have a specific capability
 */
export const findByCapability = query({
  args: {
    capability: capabilityValidator,
  },
  returns: v.array(
    v.object({
      relayId: v.string(),
      capabilities: v.array(capabilityValidator),
      lastHeartbeatAt: v.number(),
      isOnline: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const statuses = await ctx.db.query("relayStatus").collect();
    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 60000;

    return statuses
      .filter((s) => s.capabilities.includes(args.capability))
      .map((s) => ({
        relayId: s.relayId,
        capabilities: s.capabilities,
        lastHeartbeatAt: s.lastHeartbeatAt,
        isOnline: now - s.lastHeartbeatAt < ONLINE_THRESHOLD_MS,
      }));
  },
});
