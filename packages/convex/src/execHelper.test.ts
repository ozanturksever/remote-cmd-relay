import { describe, it, expect, vi } from "vitest";
import { exec, execAsync, isTransientError } from "./execHelper";
import type { ExecOptions, RelayRpcApi } from "./execHelper";

/**
 * Create a mock action context for testing the exec helper.
 * The exec helper uses ctx.runMutation and ctx.runQuery.
 */
function createMockActionCtx(overrides: {
  runMutation?: (ref: unknown, args: unknown) => Promise<unknown>;
  runQuery?: (ref: unknown, args: unknown) => Promise<unknown>;
} = {}) {
  return {
    runMutation: overrides.runMutation ?? vi.fn(),
    runQuery: overrides.runQuery ?? vi.fn(),
  } as unknown as Parameters<typeof exec>[0];
}

/**
 * Create a mock RPC API reference.
 */
function createMockRpcApi(): RelayRpcApi {
  return {
    queueRpcCommand: { _type: "mutation" },
    getCommandResult: { _type: "query" },
  };
}

describe("execHelper", () => {
  describe("exec", () => {
    it("validates SSH commands require targetHost", async () => {
      const ctx = createMockActionCtx();
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetUsername: "admin",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
    });

    it("validates SSH commands require targetUsername", async () => {
      const ctx = createMockActionCtx();
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
    });

    it("returns error when queue fails", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: false,
          error: "Database error",
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database error");
    });

    it("returns error when queue returns no commandId", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          // Missing commandId
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to queue command");
    });

    it("returns error when command not found during polling", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: false,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command not found");
    });

    it("returns completed result", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "completed",
          output: "Hello, World!",
          exitCode: 0,
          durationMs: 150,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("Hello, World!");
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBe(150);
    });

    it("returns failed result with non-zero exit code as failure", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "completed",
          output: "",
          stderr: "Command not found",
          exitCode: 127,
          durationMs: 10,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "nonexistent",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toBe("Command not found");
    });

    it("returns failed status result", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "failed",
          stderr: "Permission denied",
          exitCode: 1,
          error: "Command failed",
          durationMs: 50,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "sudo rm -rf /",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toBe("Permission denied");
      expect(result.error).toBe("Command failed");
    });

    it("returns timeout status from relay", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "timeout",
          error: "Command timed out on relay",
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "sleep 1000",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command execution timed out on relay");
      expect(result.timedOut).toBe(true);
    });

    it("times out when polling exceeds timeout", async () => {
      vi.useFakeTimers();
      
      let pollCount = 0;
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockImplementation(async () => {
          pollCount++;
          return {
            found: true,
            status: "pending", // Never completes
          };
        }),
      });
      const rpcApi = createMockRpcApi();

      // Use a very short timeout for testing
      const execPromise = exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        timeoutMs: 500,
        pollIntervalMs: 100,
      });

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(600);

      const result = await execPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("RPC timeout");
      expect(result.timedOut).toBe(true);
      expect(pollCount).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it("polls until command completes", async () => {
      vi.useFakeTimers();
      
      let pollCount = 0;
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockImplementation(async () => {
          pollCount++;
          // Return pending for first 3 polls, then completed
          if (pollCount < 4) {
            return { found: true, status: "pending" };
          }
          return {
            found: true,
            status: "completed",
            output: "Done!",
            exitCode: 0,
            durationMs: 300,
          };
        }),
      });
      const rpcApi = createMockRpcApi();

      const execPromise = exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        pollIntervalMs: 100,
      });

      // Advance time for polls
      await vi.advanceTimersByTimeAsync(500);

      const result = await execPromise;

      expect(result.success).toBe(true);
      expect(result.output).toBe("Done!");
      expect(pollCount).toBe(4);

      vi.useRealTimers();
    });

    it("passes correct arguments to queueRpcCommand", async () => {
      const runMutation = vi.fn().mockResolvedValue({
        success: true,
        commandId: "cmd-123",
      });
      const ctx = createMockActionCtx({
        runMutation,
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "completed",
          exitCode: 0,
        }),
      });
      const rpcApi = createMockRpcApi();

      await exec(ctx, rpcApi, {
        machineId: "test-machine",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        targetPort: 2222,
        targetUsername: "deploy",
        timeoutMs: 60000,
        createdBy: "test-user",
      });

      expect(runMutation).toHaveBeenCalledWith(rpcApi.queueRpcCommand, {
        machineId: "test-machine",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        targetPort: 2222,
        targetUsername: "deploy",
        timeoutMs: 60000,
        createdBy: "test-user",
      });
    });

    it("includes attempt count in result", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "completed",
          output: "Done",
          exitCode: 0,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
    });
  });

  describe("exec with retries", () => {
    it("retries on transient queue failure", async () => {
      let callCount = 0;
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            return { success: false, error: "Network timeout" };
          }
          return { success: true, commandId: "cmd-123" };
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "completed",
          output: "Success!",
          exitCode: 0,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 3,
        retryDelayMs: 10, // Short delay for testing
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("Success!");
      expect(result.attempts).toBe(3);
      expect(callCount).toBe(3);
    });

    it("fails after exhausting all retries", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: false,
          error: "Network unavailable",
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 2,
        retryDelayMs: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network unavailable");
      expect(result.attempts).toBe(3); // Initial + 2 retries
    });

    it("does not retry validation errors", async () => {
      const runMutation = vi.fn();
      const ctx = createMockActionCtx({ runMutation });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        // Missing targetHost and targetUsername
        createdBy: "user-1",
        retries: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
      expect(runMutation).not.toHaveBeenCalled(); // Should not even try
    });

    it("does not retry command not found", async () => {
      const runMutation = vi.fn().mockResolvedValue({
        success: true,
        commandId: "cmd-123",
      });
      const runQuery = vi.fn().mockResolvedValue({
        found: false,
      });
      const ctx = createMockActionCtx({ runMutation, runQuery });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command not found");
      expect(runMutation).toHaveBeenCalledTimes(1); // Only one attempt
    });

    it("does not retry relay timeout", async () => {
      const runMutation = vi.fn().mockResolvedValue({
        success: true,
        commandId: "cmd-123",
      });
      const runQuery = vi.fn().mockResolvedValue({
        found: true,
        status: "timeout",
      });
      const ctx = createMockActionCtx({ runMutation, runQuery });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "sleep 1000",
        targetType: "local",
        createdBy: "user-1",
        retries: 3,
      });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(runMutation).toHaveBeenCalledTimes(1);
    });

    it("retries on polling exception", async () => {
      let queryCallCount = 0;
      const runQuery = vi.fn().mockImplementation(async () => {
        queryCallCount++;
        if (queryCallCount < 3) {
          throw new Error("Network timeout");
        }
        return {
          found: true,
          status: "completed",
          output: "Done",
          exitCode: 0,
        };
      });
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery,
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 3,
        retryDelayMs: 10,
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("Done");
    });

    it("uses custom shouldRetry function", async () => {
      let callCount = 0;
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockImplementation(async () => {
          callCount++;
          return { success: false, error: "Custom error" };
        }),
      });
      const rpcApi = createMockRpcApi();

      // Custom shouldRetry that only retries twice
      const shouldRetry = vi.fn().mockImplementation((error, attempt) => {
        return attempt < 2;
      });

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 5, // Allow up to 5 retries
        retryDelayMs: 10,
        shouldRetry,
      });

      expect(result.success).toBe(false);
      expect(callCount).toBe(2); // Only 2 attempts due to custom shouldRetry
      expect(shouldRetry).toHaveBeenCalled();
    });

    it("retries on thrown exception from queue", async () => {
      let callCount = 0;
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 2) {
            throw new Error("ECONNREFUSED"); // Matches isTransientError
          }
          return { success: true, commandId: "cmd-123" };
        }),
        runQuery: vi.fn().mockResolvedValue({
          found: true,
          status: "completed",
          exitCode: 0,
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 2,
        retryDelayMs: 10,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it("does not retry non-transient errors by default", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: false,
          error: "Invalid machine ID format",
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await exec(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
        retries: 3,
        retryDelayMs: 10,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // No retries for non-transient
    });
  });

  describe("isTransientError", () => {
    it("returns true for network errors", () => {
      expect(isTransientError(new Error("Network error"))).toBe(true);
      expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
      expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
    });

    it("returns true for timeout errors", () => {
      expect(isTransientError(new Error("Request timeout"))).toBe(true);
      expect(isTransientError(new Error("Connection timeout"))).toBe(true);
    });

    it("returns true for rate limit errors", () => {
      expect(isTransientError(new Error("Rate limit exceeded"))).toBe(true);
      expect(isTransientError(new Error("Too many requests"))).toBe(true);
    });

    it("returns true for HTTP 5xx errors", () => {
      expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
      expect(isTransientError(new Error("502 Bad Gateway"))).toBe(true);
      expect(isTransientError(new Error("504 Gateway Timeout"))).toBe(true);
    });

    it("returns false for non-transient errors", () => {
      expect(isTransientError(new Error("Invalid input"))).toBe(false);
      expect(isTransientError(new Error("Permission denied"))).toBe(false);
      expect(isTransientError(new Error("Not found"))).toBe(false);
    });
  });

  describe("execAsync", () => {
    it("validates SSH commands require targetHost", async () => {
      const ctx = createMockActionCtx();
      const rpcApi = createMockRpcApi();

      const result = await execAsync(ctx, rpcApi, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetUsername: "admin",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
    });

    it("validates SSH commands require targetUsername", async () => {
      const ctx = createMockActionCtx();
      const rpcApi = createMockRpcApi();

      const result = await execAsync(ctx, rpcApi, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
    });

    it("returns commandId on success", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-456",
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await execAsync(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);
      expect(result.commandId).toBe("cmd-456");
      expect(result.error).toBeUndefined();
    });

    it("returns error when queue fails", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: false,
          error: "Machine not found",
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await execAsync(ctx, rpcApi, {
        machineId: "nonexistent",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Machine not found");
      expect(result.commandId).toBeUndefined();
    });

    it("returns error when queue returns no commandId", async () => {
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          // Missing commandId
        }),
      });
      const rpcApi = createMockRpcApi();

      const result = await execAsync(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to queue command");
    });

    it("passes correct arguments to queueRpcCommand", async () => {
      const runMutation = vi.fn().mockResolvedValue({
        success: true,
        commandId: "cmd-789",
      });
      const ctx = createMockActionCtx({ runMutation });
      const rpcApi = createMockRpcApi();

      await execAsync(ctx, rpcApi, {
        machineId: "test-machine",
        command: "hostname",
        targetType: "ssh",
        targetHost: "10.0.0.1",
        targetPort: 22,
        targetUsername: "root",
        timeoutMs: 120000,
        createdBy: "admin",
      });

      expect(runMutation).toHaveBeenCalledWith(rpcApi.queueRpcCommand, {
        machineId: "test-machine",
        command: "hostname",
        targetType: "ssh",
        targetHost: "10.0.0.1",
        targetPort: 22,
        targetUsername: "root",
        timeoutMs: 120000,
        createdBy: "admin",
      });
    });

    it("does not call runQuery (no polling)", async () => {
      const runQuery = vi.fn();
      const ctx = createMockActionCtx({
        runMutation: vi.fn().mockResolvedValue({
          success: true,
          commandId: "cmd-123",
        }),
        runQuery,
      });
      const rpcApi = createMockRpcApi();

      await execAsync(ctx, rpcApi, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(runQuery).not.toHaveBeenCalled();
    });
  });
});
