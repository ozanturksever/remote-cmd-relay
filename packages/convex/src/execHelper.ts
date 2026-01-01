import type { GenericActionCtx, GenericDataModel } from "convex/server";

/**
 * Options for executing a command via relay RPC
 */
export interface ExecOptions {
  /** Target machine ID */
  machineId: string;
  /** Command to execute */
  command: string;
  /** Target type: "local" for local execution, "ssh" for SSH */
  targetType: "local" | "ssh";
  /** SSH target host (required for ssh targetType) */
  targetHost?: string;
  /** SSH target port (default: 22) */
  targetPort?: number;
  /** SSH username (required for ssh targetType) */
  targetUsername?: string;
  /** Command timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Who created this command (for auditing) */
  createdBy: string;
  /** Poll interval in milliseconds (default: 100) */
  pollIntervalMs?: number;
  /** Number of retry attempts for transient failures (default: 0) */
  retries?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number;
  /** Custom function to determine if an error should be retried */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * Result of an exec command
 */
export interface ExecResult {
  /** Whether the command succeeded (completed with exit code 0) */
  success: boolean;
  /** Command stdout */
  output?: string;
  /** Command stderr */
  stderr?: string;
  /** Exit code */
  exitCode?: number;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether the command timed out waiting for relay */
  timedOut?: boolean;
  /** Number of retry attempts made */
  attempts?: number;
}

/**
 * API references for the relay RPC component.
 * Pass the component's rpc module: components.remoteCmdRelay.rpc
 */
export interface RelayRpcApi {
  queueRpcCommand: any;
  getCommandResult: any;
}

/**
 * Execute a command synchronously via relay RPC.
 * 
 * This helper queues a command and polls until completion or timeout.
 * Use this in Convex actions for a simple RPC-like interface.
 * 
 * @example
 * ```typescript
 * import { exec } from "@fatagnus/remote-cmd-relay-convex/execHelper";
 * import { components } from "./_generated/api";
 * 
 * export const myAction = action({
 *   handler: async (ctx) => {
 *     const result = await exec(ctx, components.remoteCmdRelay.rpc, {
 *       machineId: "my-machine",
 *       command: "ls -la /tmp",
 *       targetType: "local",
 *       createdBy: "user-123",
 *       timeoutMs: 30000,
 *     });
 *     
 *     if (result.success) {
 *       console.log("Output:", result.output);
 *     } else {
 *       console.error("Error:", result.error);
 *     }
 *   },
 * });
 * ```
 */
/**
 * Default function to determine if an error is transient and should be retried.
 * Network errors, timeouts, and temporary failures are retryable.
 */
export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("temporary") ||
    message.includes("unavailable") ||
    message.includes("retry") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504")
  );
}

/**
 * Sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function exec<DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  rpcApi: RelayRpcApi,
  options: ExecOptions
): Promise<ExecResult> {
  const {
    machineId,
    command,
    targetType,
    targetHost,
    targetPort,
    targetUsername,
    timeoutMs = 30000,
    createdBy,
    pollIntervalMs = 100,
    retries = 0,
    retryDelayMs = 1000,
    shouldRetry = isTransientError,
  } = options;

  // Validate SSH args (not retryable - validation error)
  if (targetType === "ssh") {
    if (!targetHost || !targetUsername) {
      return {
        success: false,
        error: "SSH target requires targetHost and targetUsername",
      };
    }
  }

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retries) {
    attempt++;
    const startTime = Date.now();

    try {
      // Queue the command
      const queueResult = await ctx.runMutation(rpcApi.queueRpcCommand, {
        machineId,
        command,
        targetType,
        targetHost,
        targetPort,
        targetUsername,
        timeoutMs,
        createdBy,
      });

      if (!queueResult.success || !queueResult.commandId) {
        const error = new Error(queueResult.error ?? "Failed to queue command");
        if (attempt <= retries && shouldRetry(error, attempt)) {
          lastError = error;
          await sleep(retryDelayMs);
          continue;
        }
        return {
          success: false,
          error: error.message,
          attempts: attempt,
        };
      }

      const commandId = queueResult.commandId;

      // Poll for completion
      while (Date.now() - startTime < timeoutMs) {
        let result;
        try {
          result = await ctx.runQuery(rpcApi.getCommandResult, {
            commandId,
          });
        } catch (pollError) {
          // Polling error - may be transient
          const error = pollError instanceof Error ? pollError : new Error(String(pollError));
          if (attempt <= retries && shouldRetry(error, attempt)) {
            lastError = error;
            break; // Break inner loop to retry from the start
          }
          return {
            success: false,
            error: `Polling failed: ${error.message}`,
            attempts: attempt,
          };
        }

        if (!result.found) {
          // Command not found is not transient - don't retry
          return {
            success: false,
            error: "Command not found",
            attempts: attempt,
          };
        }

        if (result.status === "completed" || result.status === "failed") {
          return {
            success: result.status === "completed" && (result.exitCode === 0 || result.exitCode === undefined),
            output: result.output,
            stderr: result.stderr,
            exitCode: result.exitCode,
            error: result.error,
            durationMs: result.durationMs,
            attempts: attempt,
          };
        }

        if (result.status === "timeout") {
          // Command timeout on relay is not transient - don't retry
          return {
            success: false,
            error: "Command execution timed out on relay",
            timedOut: true,
            attempts: attempt,
          };
        }

        // Wait before next poll
        await sleep(pollIntervalMs);
      }

      // Timeout reached - check if we should retry
      const timeoutError = new Error(`RPC timeout: command did not complete within ${timeoutMs}ms`);
      if (attempt <= retries && shouldRetry(timeoutError, attempt)) {
        lastError = timeoutError;
        await sleep(retryDelayMs);
        continue;
      }

      return {
        success: false,
        error: timeoutError.message,
        timedOut: true,
        attempts: attempt,
      };
    } catch (err) {
      // Unexpected error during execution
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt <= retries && shouldRetry(error, attempt)) {
        lastError = error;
        await sleep(retryDelayMs);
        continue;
      }
      return {
        success: false,
        error: error.message,
        attempts: attempt,
      };
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError?.message ?? "All retry attempts failed",
    attempts: attempt,
  };
}

/**
 * Execute a command and return immediately with the command ID.
 * Use getCommandResult to poll for the result manually.
 * 
 * This is useful for fire-and-forget commands or when you want
 * more control over the polling logic.
 * 
 * @example
 * ```typescript
 * import { execAsync } from "@fatagnus/remote-cmd-relay-convex/execHelper";
 * import { components } from "./_generated/api";
 * 
 * export const myAction = action({
 *   handler: async (ctx) => {
 *     const { commandId } = await execAsync(ctx, components.remoteCmdRelay.rpc, {
 *       machineId: "my-machine",
 *       command: "long-running-task",
 *       targetType: "local",
 *       createdBy: "user-123",
 *     });
 *     
 *     // Return immediately, poll later
 *     return { commandId };
 *   },
 * });
 * ```
 */
export async function execAsync<DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  rpcApi: RelayRpcApi,
  options: Omit<ExecOptions, "pollIntervalMs">
): Promise<{ success: boolean; commandId?: string; error?: string }> {
  const {
    machineId,
    command,
    targetType,
    targetHost,
    targetPort,
    targetUsername,
    timeoutMs = 30000,
    createdBy,
  } = options;

  // Validate SSH args
  if (targetType === "ssh") {
    if (!targetHost || !targetUsername) {
      return {
        success: false,
        error: "SSH target requires targetHost and targetUsername",
      };
    }
  }

  // Queue the command
  const queueResult = await ctx.runMutation(rpcApi.queueRpcCommand, {
    machineId,
    command,
    targetType,
    targetHost,
    targetPort,
    targetUsername,
    timeoutMs,
    createdBy,
  });

  if (!queueResult.success || !queueResult.commandId) {
    return {
      success: false,
      error: queueResult.error ?? "Failed to queue command",
    };
  }

  return {
    success: true,
    commandId: queueResult.commandId as string,
  };
}
