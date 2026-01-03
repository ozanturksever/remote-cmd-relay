import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { targetTypeValidator, commandStatusValidator } from "./schema";

/**
 * Queue a command for RPC execution and return the command ID.
 * The caller should then poll getCommandResult until completion.
 */
export const queueRpcCommand = mutation({
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
  returns: v.object({
    success: v.boolean(),
    commandId: v.optional(v.id("commandQueue")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Validate SSH args
    if (args.targetType === "ssh") {
      if (!args.targetHost || !args.targetUsername) {
        return {
          success: false,
          error: "SSH target requires targetHost and targetUsername",
        };
      }
    }

    const now = Date.now();

    const commandId = await ctx.db.insert("commandQueue", {
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

    return {
      success: true,
      commandId,
    };
  },
});

/**
 * Get the result of an RPC command.
 * Poll this query until status is "completed", "failed", or "timeout".
 */
export const getCommandResult = query({
  args: {
    commandId: v.id("commandQueue"),
  },
  returns: v.union(
    v.object({
      found: v.literal(true),
      status: commandStatusValidator,
      output: v.optional(v.string()),
      stderr: v.optional(v.string()),
      exitCode: v.optional(v.number()),
      error: v.optional(v.string()),
      durationMs: v.optional(v.number()),
    }),
    v.object({
      found: v.literal(false),
    })
  ),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd) {
      return { found: false as const };
    }

    return {
      found: true as const,
      status: cmd.status,
      output: cmd.output,
      stderr: cmd.stderr,
      exitCode: cmd.exitCode,
      error: cmd.error,
      durationMs: cmd.durationMs,
    };
  },
});

/**
 * Get streaming output for a command (includes partial output during execution).
 * Use this for real-time output streaming.
 */
export const getCommandStream = query({
  args: {
    commandId: v.id("commandQueue"),
    outputOffset: v.optional(v.number()), // Only return output after this offset
  },
  returns: v.union(
    v.object({
      found: v.literal(true),
      status: commandStatusValidator,
      partialOutput: v.optional(v.string()),
      partialStderr: v.optional(v.string()),
      output: v.optional(v.string()),
      stderr: v.optional(v.string()),
      exitCode: v.optional(v.number()),
      error: v.optional(v.string()),
      done: v.boolean(),
    }),
    v.object({
      found: v.literal(false),
    })
  ),
  handler: async (ctx, args) => {
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd) {
      return { found: false as const };
    }

    const isDone = cmd.status === "completed" || cmd.status === "failed" || cmd.status === "timeout";

    // If command is done, return final output
    if (isDone) {
      return {
        found: true as const,
        status: cmd.status,
        partialOutput: undefined,
        partialStderr: undefined,
        output: cmd.output,
        stderr: cmd.stderr,
        exitCode: cmd.exitCode,
        error: cmd.error,
        done: true,
      };
    }

    // Return partial output, optionally sliced from offset
    let partialOutput = cmd.partialOutput;
    let partialStderr = cmd.partialStderr;

    if (args.outputOffset !== undefined && partialOutput) {
      partialOutput = partialOutput.slice(args.outputOffset);
    }

    return {
      found: true as const,
      status: cmd.status,
      partialOutput,
      partialStderr,
      output: undefined,
      stderr: undefined,
      exitCode: undefined,
      error: undefined,
      done: false,
    };
  },
});
