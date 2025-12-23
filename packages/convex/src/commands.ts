import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { commandStatusValidator, targetTypeValidator } from "./schema";

/**
 * Queue a new command for execution
 */
export const queue = mutation({
  args: {
    machineId: v.string(),
    command: v.string(),
    targetType: targetTypeValidator,
    targetHost: v.optional(v.string()),
    targetPort: v.optional(v.number()),
    targetUsername: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    createdBy: v.string(),
  },
  returns: v.id("commandQueue"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate SSH target details if targetType is ssh
    if (args.targetType === "ssh") {
      if (!args.targetHost || !args.targetUsername) {
        throw new Error("SSH target requires targetHost and targetUsername");
      }
    }

    return await ctx.db.insert("commandQueue", {
      machineId: args.machineId,
      command: args.command,
      targetType: args.targetType,
      targetHost: args.targetHost,
      targetPort: args.targetPort ?? 22,
      targetUsername: args.targetUsername,
      timeoutMs: args.timeoutMs ?? 30000,
      status: "pending",
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Get pending commands for a machine
 */
export const listPending = query({
  args: {
    machineId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("commandQueue"),
      machineId: v.string(),
      command: v.string(),
      targetType: targetTypeValidator,
      targetHost: v.optional(v.string()),
      targetPort: v.optional(v.number()),
      targetUsername: v.optional(v.string()),
      timeoutMs: v.number(),
      status: commandStatusValidator,
      createdBy: v.string(),
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
      .take(args.limit ?? 10);

    return commands.map((c) => ({
      _id: c._id,
      machineId: c.machineId,
      command: c.command,
      targetType: c.targetType,
      targetHost: c.targetHost,
      targetPort: c.targetPort,
      targetUsername: c.targetUsername,
      timeoutMs: c.timeoutMs,
      status: c.status,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
    }));
  },
});

/**
 * Get a command by ID
 */
export const get = query({
  args: {
    id: v.id("commandQueue"),
  },
  returns: v.union(
    v.object({
      _id: v.id("commandQueue"),
      machineId: v.string(),
      command: v.string(),
      targetType: targetTypeValidator,
      targetHost: v.optional(v.string()),
      targetPort: v.optional(v.number()),
      targetUsername: v.optional(v.string()),
      timeoutMs: v.number(),
      status: commandStatusValidator,
      claimedBy: v.optional(v.string()),
      claimedAt: v.optional(v.number()),
      output: v.optional(v.string()),
      stderr: v.optional(v.string()),
      exitCode: v.optional(v.number()),
      error: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      createdBy: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.id);
    if (!cmd) return null;

    return {
      _id: cmd._id,
      machineId: cmd.machineId,
      command: cmd.command,
      targetType: cmd.targetType,
      targetHost: cmd.targetHost,
      targetPort: cmd.targetPort,
      targetUsername: cmd.targetUsername,
      timeoutMs: cmd.timeoutMs,
      status: cmd.status,
      claimedBy: cmd.claimedBy,
      claimedAt: cmd.claimedAt,
      output: cmd.output,
      stderr: cmd.stderr,
      exitCode: cmd.exitCode,
      error: cmd.error,
      durationMs: cmd.durationMs,
      completedAt: cmd.completedAt,
      createdBy: cmd.createdBy,
      createdAt: cmd.createdAt,
      updatedAt: cmd.updatedAt,
    };
  },
});

/**
 * Claim a command for execution
 */
export const claim = mutation({
  args: {
    id: v.id("commandQueue"),
    claimedBy: v.string(), // Relay assignment ID
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.id);
    if (!cmd) {
      throw new Error("Command not found");
    }

    // Only claim pending commands
    if (cmd.status !== "pending") {
      return false;
    }

    await ctx.db.patch(args.id, {
      status: "claimed",
      claimedBy: args.claimedBy,
      claimedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return true;
  },
});

/**
 * Mark a command as executing
 */
export const startExecution = mutation({
  args: {
    id: v.id("commandQueue"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.id);
    if (!cmd) {
      throw new Error("Command not found");
    }

    await ctx.db.patch(args.id, {
      status: "executing",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Complete a command with results
 */
export const complete = mutation({
  args: {
    id: v.id("commandQueue"),
    success: v.boolean(),
    output: v.optional(v.string()),
    stderr: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.id);
    if (!cmd) {
      throw new Error("Command not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.id, {
      status: args.success ? "completed" : "failed",
      output: args.output,
      stderr: args.stderr,
      exitCode: args.exitCode,
      error: args.error,
      durationMs: args.durationMs,
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * List recent commands for a machine
 */
export const listRecent = query({
  args: {
    machineId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("commandQueue"),
      machineId: v.string(),
      command: v.string(),
      targetType: targetTypeValidator,
      status: commandStatusValidator,
      exitCode: v.optional(v.number()),
      error: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const commands = await ctx.db
      .query("commandQueue")
      .withIndex("by_machineId", (q) => q.eq("machineId", args.machineId))
      .order("desc")
      .take(args.limit ?? 50);

    return commands.map((c) => ({
      _id: c._id,
      machineId: c.machineId,
      command: c.command,
      targetType: c.targetType,
      status: c.status,
      exitCode: c.exitCode,
      error: c.error,
      durationMs: c.durationMs,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
    }));
  },
});
