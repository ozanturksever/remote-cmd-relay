import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createRelayTestConvex,
  createTestRelayAssignment,
  createTestCommand,
  type RelayTestConvex,
} from "./test.setup";
import { api } from "./_generated/api";

describe("command queue", () => {
  let t: RelayTestConvex;

  beforeEach(() => {
    vi.useFakeTimers();
    t = createRelayTestConvex();
  });

  afterEach(async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  describe("queue", () => {
    it("queues a local command", async () => {
      const result = await t.mutation(api.commands.queue, {
        machineId: "machine-1",
        command: "echo hello",
        targetType: "local",
        createdBy: "user-1",
      });

      expect(result).toBeDefined();

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(result);
      });

      expect(cmd?.machineId).toBe("machine-1");
      expect(cmd?.command).toBe("echo hello");
      expect(cmd?.targetType).toBe("local");
      expect(cmd?.status).toBe("pending");
      expect(cmd?.timeoutMs).toBe(30000); // default
    });

    it("queues an SSH command with target details", async () => {
      const result = await t.mutation(api.commands.queue, {
        machineId: "machine-1",
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        targetPort: 2222,
        targetUsername: "admin",
        timeoutMs: 60000,
        createdBy: "user-1",
      });

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(result);
      });

      expect(cmd?.targetType).toBe("ssh");
      expect(cmd?.targetHost).toBe("192.168.1.100");
      expect(cmd?.targetPort).toBe(2222);
      expect(cmd?.targetUsername).toBe("admin");
      expect(cmd?.timeoutMs).toBe(60000);
    });

    it("requires targetHost and targetUsername for SSH commands", async () => {
      await expect(
        t.mutation(api.commands.queue, {
          machineId: "machine-1",
          command: "uptime",
          targetType: "ssh",
          createdBy: "user-1",
        })
      ).rejects.toThrow("SSH target requires targetHost and targetUsername");
    });
  });

  describe("listPending", () => {
    it("lists pending commands for a machine", async () => {
      await createTestCommand(t, {
        machineId: "machine-1",
        command: "echo 1",
        status: "pending",
      });
      await createTestCommand(t, {
        machineId: "machine-1",
        command: "echo 2",
        status: "pending",
      });
      await createTestCommand(t, {
        machineId: "machine-1",
        command: "echo completed",
        status: "completed",
      });
      await createTestCommand(t, {
        machineId: "machine-2",
        command: "echo other",
        status: "pending",
      });

      const result = await t.query(api.commands.listPending, {
        machineId: "machine-1",
      });

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.status === "pending")).toBe(true);
      expect(result.every((c) => c.machineId === "machine-1")).toBe(true);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createTestCommand(t, {
          machineId: "machine-1",
          command: `echo ${i}`,
          status: "pending",
        });
      }

      const result = await t.query(api.commands.listPending, {
        machineId: "machine-1",
        limit: 2,
      });

      expect(result).toHaveLength(2);
    });
  });

  describe("get", () => {
    it("returns command by ID", async () => {
      const created = await createTestCommand(t, {
        machineId: "machine-1",
        command: "test command",
      });

      const result = await t.query(api.commands.get, {
        id: created._id,
      });

      expect(result).not.toBeNull();
      expect(result?.command).toBe("test command");
      expect(result?.machineId).toBe("machine-1");
    });

    it("returns null for non-existent command", async () => {
      const created = await createTestCommand(t, { machineId: "m" });
      await t.run(async (ctx) => {
        await ctx.db.delete(created._id);
      });

      const result = await t.query(api.commands.get, {
        id: created._id,
      });

      expect(result).toBeNull();
    });
  });

  describe("claim", () => {
    it("claims a pending command", async () => {
      const created = await createTestCommand(t, {
        machineId: "machine-1",
        status: "pending",
      });

      const result = await t.mutation(api.commands.claim, {
        id: created._id,
        claimedBy: "relay-1",
      });

      expect(result).toBe(true);

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(cmd?.status).toBe("claimed");
      expect(cmd?.claimedBy).toBe("relay-1");
      expect(cmd?.claimedAt).toBeDefined();
    });

    it("prevents double claiming", async () => {
      const created = await createTestCommand(t, {
        machineId: "machine-1",
        status: "pending",
      });

      // First claim succeeds
      const result1 = await t.mutation(api.commands.claim, {
        id: created._id,
        claimedBy: "relay-1",
      });
      expect(result1).toBe(true);

      // Second claim fails
      const result2 = await t.mutation(api.commands.claim, {
        id: created._id,
        claimedBy: "relay-2",
      });
      expect(result2).toBe(false);
    });

    it("throws for non-existent command", async () => {
      const created = await createTestCommand(t, { machineId: "m" });
      await t.run(async (ctx) => {
        await ctx.db.delete(created._id);
      });

      await expect(
        t.mutation(api.commands.claim, {
          id: created._id,
          claimedBy: "relay-1",
        })
      ).rejects.toThrow("Command not found");
    });
  });

  describe("startExecution", () => {
    it("updates status to executing", async () => {
      const created = await createTestCommand(t, {
        machineId: "machine-1",
        status: "claimed",
      });

      await t.mutation(api.commands.startExecution, {
        id: created._id,
      });

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(cmd?.status).toBe("executing");
    });
  });

  describe("complete", () => {
    it("completes command with success", async () => {
      const created = await createTestCommand(t, {
        machineId: "machine-1",
        status: "executing",
      });

      await t.mutation(api.commands.complete, {
        id: created._id,
        success: true,
        output: "Hello, World!",
        exitCode: 0,
        durationMs: 150,
      });

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(cmd?.status).toBe("completed");
      expect(cmd?.output).toBe("Hello, World!");
      expect(cmd?.exitCode).toBe(0);
      expect(cmd?.durationMs).toBe(150);
      expect(cmd?.completedAt).toBeDefined();
    });

    it("completes command with failure", async () => {
      const created = await createTestCommand(t, {
        machineId: "machine-1",
        status: "executing",
      });

      await t.mutation(api.commands.complete, {
        id: created._id,
        success: false,
        stderr: "Command failed",
        exitCode: 1,
        error: "Non-zero exit code",
        durationMs: 50,
      });

      const cmd = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(cmd?.status).toBe("failed");
      expect(cmd?.stderr).toBe("Command failed");
      expect(cmd?.exitCode).toBe(1);
      expect(cmd?.error).toBe("Non-zero exit code");
    });
  });

  describe("listRecent", () => {
    it("lists recent commands for a machine", async () => {
      await createTestCommand(t, {
        machineId: "machine-1",
        command: "echo 1",
        status: "completed",
      });
      await createTestCommand(t, {
        machineId: "machine-1",
        command: "echo 2",
        status: "failed",
      });
      await createTestCommand(t, {
        machineId: "machine-1",
        command: "echo 3",
        status: "pending",
      });

      const result = await t.query(api.commands.listRecent, {
        machineId: "machine-1",
      });

      expect(result).toHaveLength(3);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await createTestCommand(t, {
          machineId: "machine-1",
          command: `echo ${i}`,
        });
      }

      const result = await t.query(api.commands.listRecent, {
        machineId: "machine-1",
        limit: 5,
      });

      expect(result).toHaveLength(5);
    });
  });
});
