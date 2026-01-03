import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRelayTestConvex, type RelayTestConvex } from "./test.setup";
import { createMockCommand } from "./test.helpers";
import { api } from "./_generated/api";

describe("rpc", () => {
  let t: RelayTestConvex;

  beforeEach(() => {
    vi.useFakeTimers();
    t = createRelayTestConvex();
  });

  afterEach(async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  describe("queueRpcCommand", () => {
    it("queues a local command successfully", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);
      expect(result.commandId).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify command was created in database
      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(result.commandId!);
      });

      expect(cmd?.machineId).toBe("machine-1");
      expect(cmd?.command).toBe("echo hello");
      expect(cmd?.targetType).toBe("local");
      expect(cmd?.status).toBe("pending");
      expect(cmd?.timeoutMs).toBe(30000); // default
    });

    it("queues a local command with custom timeout", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "sleep 10",
        targetType: "local",
        timeoutMs: 60000,
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(result.commandId!);
      });

      expect(cmd?.timeoutMs).toBe(60000);
    });

    it("queues an SSH command with all target details", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        targetPort: 2222,
        targetUsername: "admin",
        timeoutMs: 60000,
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);
      expect(result.commandId).toBeDefined();

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(result.commandId!);
      });

      expect(cmd?.targetType).toBe("ssh");
      expect(cmd?.targetHost).toBe("192.168.1.100");
      expect(cmd?.targetPort).toBe(2222);
      expect(cmd?.targetUsername).toBe("admin");
    });

    it("uses default port 22 for SSH commands", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        targetUsername: "admin",
        createdBy: "user-1",
      });

      expect(result.success).toBe(true);

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(result.commandId!);
      });

      expect(cmd?.targetPort).toBe(22);
    });

    it("returns error when SSH command missing targetHost", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetUsername: "admin",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
      expect(result.commandId).toBeUndefined();
    });

    it("returns error when SSH command missing targetUsername", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
      expect(result.commandId).toBeUndefined();
    });

    it("returns error when SSH command missing both targetHost and targetUsername", async () => {
      const result = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        createdBy: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SSH target requires targetHost and targetUsername");
    });
  });

  describe("getCommandResult", () => {
    it("returns found: false for non-existent command", async () => {
      // Create a command then delete it to get a valid but non-existent ID
      const cmd = await createMockCommand(t, { status: "pending" });
      await t.run(async (ctx) => {
        await ctx.db.delete(cmd._id);
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(false);
    });

    it("returns pending command status", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        command: "echo hello",
        status: "pending",
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("pending");
        expect(result.output).toBeUndefined();
        expect(result.exitCode).toBeUndefined();
      }
    });

    it("returns claimed command status", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "claimed",
        claimedBy: "relay-1",
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("claimed");
      }
    });

    it("returns executing command status", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "executing",
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("executing");
      }
    });

    it("returns completed command with output", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "completed",
      });

      // Update with output data
      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          output: "Hello, World!",
          exitCode: 0,
          durationMs: 150,
        });
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("completed");
        expect(result.output).toBe("Hello, World!");
        expect(result.exitCode).toBe(0);
        expect(result.durationMs).toBe(150);
      }
    });

    it("returns failed command with error details", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "failed",
      });

      // Update with error data
      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          stderr: "Permission denied",
          exitCode: 1,
          error: "Command failed with exit code 1",
          durationMs: 50,
        });
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("failed");
        expect(result.stderr).toBe("Permission denied");
        expect(result.exitCode).toBe(1);
        expect(result.error).toBe("Command failed with exit code 1");
        expect(result.durationMs).toBe(50);
      }
    });

    it("returns timeout command status", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "timeout",
      });

      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          error: "Command timed out",
        });
      });

      const result = await t.query(api.rpc.getCommandResult, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("timeout");
        expect(result.error).toBe("Command timed out");
      }
    });
  });

  describe("getCommandStream", () => {
    it("returns found: false for non-existent command", async () => {
      const cmd = await createMockCommand(t, { status: "pending" });
      await t.run(async (ctx) => {
        await ctx.db.delete(cmd._id);
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(false);
    });

    it("returns partial output for executing command", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "executing",
      });

      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          partialOutput: "Processing line 1\nProcessing line 2\n",
          partialStderr: "Warning: something\n",
        });
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("executing");
        expect(result.partialOutput).toBe("Processing line 1\nProcessing line 2\n");
        expect(result.partialStderr).toBe("Warning: something\n");
        expect(result.done).toBe(false);
        expect(result.output).toBeUndefined();
      }
    });

    it("returns partial output with offset", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "executing",
      });

      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          partialOutput: "Line 1\nLine 2\nLine 3\n",
        });
      });

      // Request output starting from offset 7 (after "Line 1\n")
      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
        outputOffset: 7,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.partialOutput).toBe("Line 2\nLine 3\n");
        expect(result.done).toBe(false);
      }
    });

    it("returns final output when command is completed", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "completed",
      });

      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          output: "Final output\n",
          stderr: "Final stderr\n",
          exitCode: 0,
          partialOutput: "Should be ignored",
        });
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("completed");
        expect(result.output).toBe("Final output\n");
        expect(result.stderr).toBe("Final stderr\n");
        expect(result.exitCode).toBe(0);
        expect(result.done).toBe(true);
        expect(result.partialOutput).toBeUndefined();
      }
    });

    it("returns done: true for failed command", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "failed",
      });

      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          stderr: "Error message",
          exitCode: 1,
          error: "Command failed",
        });
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("failed");
        expect(result.done).toBe(true);
        expect(result.error).toBe("Command failed");
      }
    });

    it("returns done: true for timeout command", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "timeout",
      });

      await t.run(async (ctx) => {
        await ctx.db.patch(cmd._id, {
          error: "Command timed out",
        });
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("timeout");
        expect(result.done).toBe(true);
      }
    });

    it("returns empty partial output for pending command", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "pending",
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("pending");
        expect(result.done).toBe(false);
        expect(result.partialOutput).toBeUndefined();
      }
    });

    it("returns empty partial output for claimed command", async () => {
      const cmd = await createMockCommand(t, {
        machineId: "machine-1",
        status: "claimed",
        claimedBy: "relay-1",
      });

      const result = await t.query(api.rpc.getCommandStream, {
        commandId: cmd._id,
      });

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("claimed");
        expect(result.done).toBe(false);
      }
    });
  });

  describe("streaming workflow", () => {
    it("simulates real-time streaming: queue -> claim -> stream updates -> complete", async () => {
      // 1. Queue command
      const queueResult = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "stream-machine",
        command: "long-running-command",
        targetType: "local",
        createdBy: "test-user",
      });

      expect(queueResult.success).toBe(true);
      const commandId = queueResult.commandId!;

      // 2. Verify command is pending, no streaming data
      let streamResult = await t.query(api.rpc.getCommandStream, { commandId });
      expect(streamResult.found).toBe(true);
      if (streamResult.found) {
        expect(streamResult.status).toBe("pending");
        expect(streamResult.done).toBe(false);
      }

      // 3. Relay claims command
      await t.mutation(api.commands.claim, {
        id: commandId,
        claimedBy: "relay-1",
      });

      // 4. Relay sends first streaming update
      await t.mutation(api.public.updatePartialOutput, {
        commandId,
        partialOutput: "Step 1: Starting...\n",
      });

      streamResult = await t.query(api.rpc.getCommandStream, { commandId });
      if (streamResult.found) {
        expect(streamResult.status).toBe("executing");
        expect(streamResult.partialOutput).toBe("Step 1: Starting...\n");
        expect(streamResult.done).toBe(false);
      }

      // 5. Relay sends second streaming update
      await t.mutation(api.public.updatePartialOutput, {
        commandId,
        partialOutput: "Step 1: Starting...\nStep 2: Processing...\n",
      });

      // Client polls with offset to get only new content
      streamResult = await t.query(api.rpc.getCommandStream, {
        commandId,
        outputOffset: 20, // Length of first message
      });
      if (streamResult.found) {
        expect(streamResult.partialOutput).toBe("Step 2: Processing...\n");
      }

      // 6. Relay sends third streaming update with stderr
      await t.mutation(api.public.updatePartialOutput, {
        commandId,
        partialOutput: "Step 1: Starting...\nStep 2: Processing...\nStep 3: Finishing...\n",
        partialStderr: "Warning: deprecated API\n",
      });

      streamResult = await t.query(api.rpc.getCommandStream, { commandId });
      if (streamResult.found) {
        expect(streamResult.partialStderr).toBe("Warning: deprecated API\n");
      }

      // 7. Relay completes command
      await t.mutation(api.commands.complete, {
        id: commandId,
        success: true,
        output: "Step 1: Starting...\nStep 2: Processing...\nStep 3: Finishing...\nDone!\n",
        exitCode: 0,
        durationMs: 5000,
      });

      // 8. Client gets final result
      streamResult = await t.query(api.rpc.getCommandStream, { commandId });
      if (streamResult.found) {
        expect(streamResult.status).toBe("completed");
        expect(streamResult.done).toBe(true);
        expect(streamResult.output).toContain("Done!");
        expect(streamResult.exitCode).toBe(0);
        expect(streamResult.partialOutput).toBeUndefined();
      }
    });

    it("streaming with command failure", async () => {
      // 1. Queue command
      const queueResult = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "fail-stream-machine",
        command: "failing-command",
        targetType: "local",
        createdBy: "test-user",
      });

      const commandId = queueResult.commandId!;

      // 2. Claim and start streaming
      await t.mutation(api.commands.claim, {
        id: commandId,
        claimedBy: "relay-1",
      });

      await t.mutation(api.public.updatePartialOutput, {
        commandId,
        partialOutput: "Starting...\n",
        partialStderr: "Error: something went wrong\n",
      });

      // 3. Verify streaming state
      let streamResult = await t.query(api.rpc.getCommandStream, { commandId });
      if (streamResult.found) {
        expect(streamResult.status).toBe("executing");
        expect(streamResult.partialStderr).toBe("Error: something went wrong\n");
        expect(streamResult.done).toBe(false);
      }

      // 4. Command fails
      await t.mutation(api.commands.complete, {
        id: commandId,
        success: false,
        output: "Starting...\n",
        stderr: "Error: something went wrong\n",
        exitCode: 1,
        error: "Command failed with exit code 1",
        durationMs: 500,
      });

      // 5. Verify final failed state
      streamResult = await t.query(api.rpc.getCommandStream, { commandId });
      if (streamResult.found) {
        expect(streamResult.status).toBe("failed");
        expect(streamResult.done).toBe(true);
        expect(streamResult.stderr).toBe("Error: something went wrong\n");
        expect(streamResult.exitCode).toBe(1);
      }
    });
  });

  describe("RPC workflow integration", () => {
    it("complete RPC flow: queue -> claim -> execute -> complete -> get result", async () => {
      // 1. Queue command via RPC
      const queueResult = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "workflow-machine",
        command: "echo 'RPC test'",
        targetType: "local",
        timeoutMs: 30000,
        createdBy: "test-user",
      });

      expect(queueResult.success).toBe(true);
      const commandId = queueResult.commandId!;

      // 2. Verify command is pending
      let result = await t.query(api.rpc.getCommandResult, { commandId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("pending");
      }

      // 3. Simulate relay claiming the command
      await t.mutation(api.commands.claim, {
        id: commandId,
        claimedBy: "relay-1",
      });

      result = await t.query(api.rpc.getCommandResult, { commandId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("claimed");
      }

      // 4. Simulate relay starting execution
      await t.mutation(api.commands.startExecution, {
        id: commandId,
      });

      result = await t.query(api.rpc.getCommandResult, { commandId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("executing");
      }

      // 5. Simulate relay completing the command
      await t.mutation(api.commands.complete, {
        id: commandId,
        success: true,
        output: "RPC test",
        exitCode: 0,
        durationMs: 100,
      });

      // 6. Verify final result
      result = await t.query(api.rpc.getCommandResult, { commandId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("completed");
        expect(result.output).toBe("RPC test");
        expect(result.exitCode).toBe(0);
        expect(result.durationMs).toBe(100);
      }
    });

    it("RPC flow with command failure", async () => {
      // 1. Queue command
      const queueResult = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "fail-machine",
        command: "exit 1",
        targetType: "local",
        createdBy: "test-user",
      });

      expect(queueResult.success).toBe(true);
      const commandId = queueResult.commandId!;

      // 2. Simulate relay claiming and executing
      await t.mutation(api.commands.claim, {
        id: commandId,
        claimedBy: "relay-1",
      });

      await t.mutation(api.commands.startExecution, {
        id: commandId,
      });

      // 3. Simulate relay reporting failure
      await t.mutation(api.commands.complete, {
        id: commandId,
        success: false,
        stderr: "Command exited with code 1",
        exitCode: 1,
        error: "Non-zero exit code",
        durationMs: 50,
      });

      // 4. Verify failed result
      const result = await t.query(api.rpc.getCommandResult, { commandId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("failed");
        expect(result.stderr).toBe("Command exited with code 1");
        expect(result.exitCode).toBe(1);
        expect(result.error).toBe("Non-zero exit code");
      }
    });

    it("RPC flow with SSH command", async () => {
      // 1. Queue SSH command
      const queueResult = await t.mutation(api.rpc.queueRpcCommand, {
        machineId: "ssh-machine",
        command: "hostname",
        targetType: "ssh",
        targetHost: "192.168.1.50",
        targetPort: 22,
        targetUsername: "deploy",
        timeoutMs: 60000,
        createdBy: "test-user",
      });

      expect(queueResult.success).toBe(true);
      const commandId = queueResult.commandId!;

      // Verify SSH details were stored
      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(commandId);
      });

      expect(cmd?.targetType).toBe("ssh");
      expect(cmd?.targetHost).toBe("192.168.1.50");
      expect(cmd?.targetPort).toBe(22);
      expect(cmd?.targetUsername).toBe("deploy");

      // 2. Simulate successful SSH execution
      await t.mutation(api.commands.claim, {
        id: commandId,
        claimedBy: "relay-1",
      });

      await t.mutation(api.commands.complete, {
        id: commandId,
        success: true,
        output: "webserver-01",
        exitCode: 0,
        durationMs: 250,
      });

      // 3. Verify result
      const result = await t.query(api.rpc.getCommandResult, { commandId });
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("completed");
        expect(result.output).toBe("webserver-01");
      }
    });

    it("multiple concurrent RPC commands", async () => {
      // Queue multiple commands
      const commands = await Promise.all([
        t.mutation(api.rpc.queueRpcCommand, {
          machineId: "machine-1",
          command: "echo cmd1",
          targetType: "local",
          createdBy: "user-1",
        }),
        t.mutation(api.rpc.queueRpcCommand, {
          machineId: "machine-1",
          command: "echo cmd2",
          targetType: "local",
          createdBy: "user-1",
        }),
        t.mutation(api.rpc.queueRpcCommand, {
          machineId: "machine-2",
          command: "echo cmd3",
          targetType: "local",
          createdBy: "user-2",
        }),
      ]);

      // All should succeed
      expect(commands.every((c) => c.success)).toBe(true);

      // Each should have unique command ID
      const ids = commands.map((c) => c.commandId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      // All should be pending
      for (const cmd of commands) {
        const result = await t.query(api.rpc.getCommandResult, {
          commandId: cmd.commandId!,
        });
        expect(result.found).toBe(true);
        if (result.found) {
          expect(result.status).toBe("pending");
        }
      }
    });
  });
});
