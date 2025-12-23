import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a new relay assignment linking an API key to a machine
 */
export const create = mutation({
  args: {
    apiKeyId: v.string(),
    machineId: v.string(),
    name: v.string(),
    createdBy: v.string(),
  },
  returns: v.id("relayAssignments"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if assignment already exists for this API key
    const existing = await ctx.db
      .query("relayAssignments")
      .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", args.apiKeyId))
      .first();

    if (existing) {
      throw new Error("API key is already assigned to a machine");
    }

    return await ctx.db.insert("relayAssignments", {
      apiKeyId: args.apiKeyId,
      machineId: args.machineId,
      name: args.name,
      enabled: true,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Get a relay assignment by API key ID
 */
export const getByApiKeyId = query({
  args: {
    apiKeyId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("relayAssignments"),
      apiKeyId: v.string(),
      machineId: v.string(),
      name: v.string(),
      enabled: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdBy: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("relayAssignments")
      .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", args.apiKeyId))
      .first();

    if (!assignment) return null;

    return {
      _id: assignment._id,
      apiKeyId: assignment.apiKeyId,
      machineId: assignment.machineId,
      name: assignment.name,
      enabled: assignment.enabled,
      lastSeenAt: assignment.lastSeenAt,
      createdBy: assignment.createdBy,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    };
  },
});

/**
 * List all relay assignments for a machine
 */
export const listByMachineId = query({
  args: {
    machineId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("relayAssignments"),
      apiKeyId: v.string(),
      machineId: v.string(),
      name: v.string(),
      enabled: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdBy: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const assignments = await ctx.db
      .query("relayAssignments")
      .withIndex("by_machineId", (q) => q.eq("machineId", args.machineId))
      .collect();

    return assignments.map((a) => ({
      _id: a._id,
      apiKeyId: a.apiKeyId,
      machineId: a.machineId,
      name: a.name,
      enabled: a.enabled,
      lastSeenAt: a.lastSeenAt,
      createdBy: a.createdBy,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  },
});

/**
 * Update relay assignment
 */
export const update = mutation({
  args: {
    id: v.id("relayAssignments"),
    name: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Relay assignment not found");
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Update last seen timestamp for a relay
 */
export const heartbeat = mutation({
  args: {
    apiKeyId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("relayAssignments")
      .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", args.apiKeyId))
      .first();

    if (assignment) {
      await ctx.db.patch(assignment._id, {
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * List all relay assignments (for admin view)
 */
export const listAll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("relayAssignments"),
      apiKeyId: v.string(),
      machineId: v.string(),
      name: v.string(),
      enabled: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      createdBy: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("relayAssignments")
      .order("desc")
      .collect();

    return assignments.map((a) => ({
      _id: a._id,
      apiKeyId: a.apiKeyId,
      machineId: a.machineId,
      name: a.name,
      enabled: a.enabled,
      lastSeenAt: a.lastSeenAt,
      createdBy: a.createdBy,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  },
});

/**
 * Delete a relay assignment
 */
export const remove = mutation({
  args: {
    id: v.id("relayAssignments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
