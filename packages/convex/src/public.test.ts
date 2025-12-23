import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRelayTestConvex, RelayTestConvex } from "./test.setup";
import {
  createMockRelayAssignment,
  createMockCommand,
  createMockConfigPush,
  createMockSharedCredential,
} from "./test.helpers";
import { api } from "./_generated/api";

describe("public", () => {
  let t: RelayTestConvex;

  beforeEach(() => {
    vi.useFakeTimers();
    t = createRelayTestConvex();
  });

  afterEach(async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  describe("verifyRelay", () => {
    it("returns valid result for existing enabled assignment", async () => {
      await createMockRelayAssignment(t, {
        apiKeyId: "valid-api-key",
        machineId: "machine-123",
        name: "Test Relay",
        enabled: true,
      });

      const result = await t.query(api.public.verifyRelay, {
        apiKeyId: "valid-api-key",
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.machineId).toBe("machine-123");
        expect(result.name).toBe("Test Relay");
        expect(result.assignmentId).toBeDefined();
      }
    });

    it("returns invalid for non-existent API key", async () => {
      const result = await t.query(api.public.verifyRelay, {
        apiKeyId: "nonexistent-key",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("No relay assignment found for this API key");
      }
    });

    it("returns invalid for disabled assignment", async () => {
      await createMockRelayAssignment(t, {
        apiKeyId: "disabled-key",
        enabled: false,
      });

      const result = await t.query(api.public.verifyRelay, {
        apiKeyId: "disabled-key",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Relay assignment is disabled");
      }
    });
  });

  describe("getPendingCommands", () => {
    it("returns pending commands for a machine", async () => {
      const machineId = "cmd-machine";

      await createMockCommand(t, {
        machineId,
        command: "cmd1",
        status: "pending",
      });
      await createMockCommand(t, {
        machineId,
        command: "cmd2",
        status: "pending",
      });
      await createMockCommand(t, {
        machineId,
        command: "cmd3",
        status: "completed",
      });

      const commands = await t.query(api.public.getPendingCommands, {
        machineId,
      });

      expect(commands).toHaveLength(2);
      expect(commands.map((c) => c.command)).toContain("cmd1");
      expect(commands.map((c) => c.command)).toContain("cmd2");
    });

    it("returns commands with SSH target details", async () => {
      const machineId = "ssh-cmd-machine";

      await createMockCommand(t, {
        machineId,
        command: "uptime",
        targetType: "ssh",
        targetHost: "192.168.1.100",
        targetPort: 22,
        targetUsername: "admin",
        status: "pending",
      });

      const commands = await t.query(api.public.getPendingCommands, {
        machineId,
      });

      expect(commands).toHaveLength(1);
      expect(commands[0].targetType).toBe("ssh");
      expect(commands[0].targetHost).toBe("192.168.1.100");
      expect(commands[0].targetUsername).toBe("admin");
    });

    it("returns empty array when no pending commands", async () => {
      const commands = await t.query(api.public.getPendingCommands, {
        machineId: "empty-machine",
      });

      expect(commands).toEqual([]);
    });
  });

  describe("claimCommand", () => {
    it("successfully claims a pending command", async () => {
      const cmd = await createMockCommand(t, {
        status: "pending",
      });

      const result = await t.mutation(api.public.claimCommand, {
        commandId: cmd._id,
        assignmentId: "relay-assignment-1",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command._id).toBe(cmd._id);
        expect(result.command.command).toBe(cmd.command);
      }
    });

    it("fails to claim non-existent command", async () => {
      // Create a command then delete it to get a valid but non-existent ID
      const cmd = await createMockCommand(t, { status: "pending" });
      await t.run(async (ctx) => {
        await ctx.db.delete(cmd._id);
      });

      const result = await t.mutation(api.public.claimCommand, {
        commandId: cmd._id,
        assignmentId: "relay-1",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Command not found");
      }
    });

    it("fails to claim already claimed command", async () => {
      const cmd = await createMockCommand(t, {
        status: "claimed",
        claimedBy: "other-relay",
      });

      const result = await t.mutation(api.public.claimCommand, {
        commandId: cmd._id,
        assignmentId: "relay-1",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Command is not pending");
      }
    });
  });

  describe("submitResult", () => {
    it("submits successful command result", async () => {
      const cmd = await createMockCommand(t, {
        status: "claimed",
      });

      const result = await t.mutation(api.public.submitResult, {
        commandId: cmd._id,
        success: true,
        output: "Hello, World!",
        exitCode: 0,
        durationMs: 150,
      });

      expect(result.success).toBe(true);

      // Verify command status was updated
      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(cmd._id);
      });

      expect(updated?.status).toBe("completed");
      expect(updated?.output).toBe("Hello, World!");
      expect(updated?.exitCode).toBe(0);
    });

    it("submits failed command result", async () => {
      const cmd = await createMockCommand(t, {
        status: "claimed",
      });

      const result = await t.mutation(api.public.submitResult, {
        commandId: cmd._id,
        success: false,
        stderr: "Permission denied",
        exitCode: 1,
        error: "Command failed",
        durationMs: 50,
      });

      expect(result.success).toBe(true);

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(cmd._id);
      });

      expect(updated?.status).toBe("failed");
      expect(updated?.stderr).toBe("Permission denied");
      expect(updated?.error).toBe("Command failed");
    });

    it("returns failure for non-existent command", async () => {
      // Create a command then delete it to get a valid but non-existent ID
      const cmd = await createMockCommand(t, { status: "pending" });
      await t.run(async (ctx) => {
        await ctx.db.delete(cmd._id);
      });

      const result = await t.mutation(api.public.submitResult, {
        commandId: cmd._id,
        success: true,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("sendHeartbeat", () => {
    it("updates lastSeenAt for valid API key", async () => {
      await createMockRelayAssignment(t, {
        apiKeyId: "heartbeat-api-key",
      });

      const result = await t.mutation(api.public.sendHeartbeat, {
        apiKeyId: "heartbeat-api-key",
      });

      expect(result.success).toBe(true);

      // Verify lastSeenAt was updated
      const assignment = await t.run(async (ctx) => {
        return await ctx.db
          .query("relayAssignments")
          .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", "heartbeat-api-key"))
          .first();
      });

      expect(assignment?.lastSeenAt).toBeDefined();
    });

    it("returns failure for invalid API key", async () => {
      const result = await t.mutation(api.public.sendHeartbeat, {
        apiKeyId: "invalid-api-key",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("reportFullStatus", () => {
    it("creates/updates relay status with capabilities and credentials", async () => {
      const relayId = "full-status-relay";
      const now = Date.now();

      const result = await t.mutation(api.public.reportFullStatus, {
        relayId,
        capabilities: ["ssh", "local_cmd", "perf_metrics"],
        version: "1.0.0",
        hostname: "relay-host",
        platform: "linux",
        metrics: {
          cpuPercent: 25.5,
          memoryPercent: 50.0,
        },
        credentials: [
          {
            credentialName: "ssh-key-1",
            credentialType: "ssh_key",
            targetHost: "server1.example.com",
            storageMode: "relay_only",
            lastUpdatedAt: now,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.pendingConfigPushes).toBe(0);

      // Verify status was created
      const status = await t.run(async (ctx) => {
        return await ctx.db
          .query("relayStatus")
          .withIndex("by_relayId", (q) => q.eq("relayId", relayId))
          .first();
      });

      expect(status?.capabilities).toEqual(["ssh", "local_cmd", "perf_metrics"]);
      expect(status?.version).toBe("1.0.0");
      expect(status?.metrics?.cpuPercent).toBe(25.5);

      // Verify credential inventory was synced
      const creds = await t.run(async (ctx) => {
        return await ctx.db
          .query("relayCredentialInventory")
          .withIndex("by_relayId", (q) => q.eq("relayId", relayId))
          .collect();
      });

      expect(creds).toHaveLength(1);
      expect(creds[0].credentialName).toBe("ssh-key-1");
    });

    it("returns pending config push count", async () => {
      const relayId = "pending-push-relay";

      // Create some pending pushes
      await createMockConfigPush(t, { relayId, status: "pending" });
      await createMockConfigPush(t, { relayId, status: "pending" });
      await createMockConfigPush(t, { relayId, status: "acked" });

      const result = await t.mutation(api.public.reportFullStatus, {
        relayId,
        capabilities: ["local_cmd"],
        credentials: [],
      });

      expect(result.success).toBe(true);
      expect(result.pendingConfigPushes).toBe(2);
    });

    it("returns shared credentials count", async () => {
      const relayId = "shared-creds-relay";

      // Create shared credentials assigned to this relay
      await createMockSharedCredential(t, {
        assignedRelays: [relayId, "other-relay"],
      });
      await createMockSharedCredential(t, {
        assignedRelays: [relayId],
      });
      await createMockSharedCredential(t, {
        assignedRelays: ["other-relay"],
      });

      const result = await t.mutation(api.public.reportFullStatus, {
        relayId,
        capabilities: ["local_cmd"],
        credentials: [],
      });

      expect(result.success).toBe(true);
      expect(result.sharedCredentialsCount).toBe(2);
    });
  });

  describe("getPendingConfigPushes", () => {
    it("returns pending config pushes for relay", async () => {
      const relayId = "config-push-relay";

      await createMockConfigPush(t, {
        relayId,
        pushType: "credential",
        status: "pending",
      });
      await createMockConfigPush(t, {
        relayId,
        pushType: "ssh_targets",
        status: "pending",
      });
      await createMockConfigPush(t, {
        relayId,
        status: "acked",
      });

      const pushes = await t.query(api.public.getPendingConfigPushes, {
        relayId,
      });

      expect(pushes).toHaveLength(2);
    });

    it("returns empty array when no pending pushes", async () => {
      const pushes = await t.query(api.public.getPendingConfigPushes, {
        relayId: "no-pushes-relay",
      });

      expect(pushes).toEqual([]);
    });
  });

  describe("acknowledgeConfigPush", () => {
    it("acknowledges push successfully", async () => {
      const push = await createMockConfigPush(t, {
        status: "sent",
      });

      const result = await t.mutation(api.public.acknowledgeConfigPush, {
        pushId: push._id,
        success: true,
      });

      expect(result.success).toBe(true);

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(push._id);
      });

      expect(updated?.status).toBe("acked");
    });

    it("acknowledges push with failure", async () => {
      const push = await createMockConfigPush(t, {
        status: "sent",
      });

      const result = await t.mutation(api.public.acknowledgeConfigPush, {
        pushId: push._id,
        success: false,
        errorMessage: "Failed to apply config",
      });

      expect(result.success).toBe(true);

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(push._id);
      });

      expect(updated?.status).toBe("failed");
      expect(updated?.errorMessage).toBe("Failed to apply config");
    });

    it("returns failure for non-existent push", async () => {
      // Create a push then delete it to get a valid but non-existent ID
      const push = await createMockConfigPush(t, { status: "pending" });
      await t.run(async (ctx) => {
        await ctx.db.delete(push._id);
      });

      const result = await t.mutation(api.public.acknowledgeConfigPush, {
        pushId: push._id,
        success: true,
      });

      expect(result.success).toBe(false);
    });
  });

  describe("getSharedCredentials", () => {
    it("returns shared credentials assigned to relay", async () => {
      const relayId = "shared-creds-relay";

      await createMockSharedCredential(t, {
        name: "assigned-cred",
        assignedRelays: [relayId],
        encryptedValue: "encrypted-data",
      });
      await createMockSharedCredential(t, {
        name: "not-assigned",
        assignedRelays: ["other-relay"],
      });

      const creds = await t.query(api.public.getSharedCredentials, {
        relayId,
      });

      expect(creds).toHaveLength(1);
      expect(creds[0].name).toBe("assigned-cred");
      expect(creds[0].encryptedValue).toBe("encrypted-data");
    });

    it("returns empty array when no credentials assigned", async () => {
      const creds = await t.query(api.public.getSharedCredentials, {
        relayId: "no-creds-relay",
      });

      expect(creds).toEqual([]);
    });
  });

  describe("full relay workflow", () => {
    it("complete relay lifecycle: verify -> status -> commands -> heartbeat", async () => {
      // 1. Create relay assignment
      const assignment = await createMockRelayAssignment(t, {
        apiKeyId: "workflow-api-key",
        machineId: "workflow-machine",
        name: "Workflow Relay",
      });

      // 2. Verify relay
      const verifyResult = await t.query(api.public.verifyRelay, {
        apiKeyId: "workflow-api-key",
      });
      expect(verifyResult.valid).toBe(true);

      // 3. Report full status
      const statusResult = await t.mutation(api.public.reportFullStatus, {
        relayId: assignment._id,
        capabilities: ["local_cmd", "ssh"],
        version: "1.0.0",
        hostname: "workflow-host",
        platform: "linux",
        credentials: [],
      });
      expect(statusResult.success).toBe(true);

      // 4. Queue a command for the machine
      await createMockCommand(t, {
        machineId: "workflow-machine",
        command: "echo test",
        status: "pending",
      });

      // 5. Get pending commands
      const commands = await t.query(api.public.getPendingCommands, {
        machineId: "workflow-machine",
      });
      expect(commands).toHaveLength(1);

      // 6. Claim command
      const claimResult = await t.mutation(api.public.claimCommand, {
        commandId: commands[0]._id,
        assignmentId: assignment._id,
      });
      expect(claimResult.success).toBe(true);

      // 7. Submit result
      const submitResult = await t.mutation(api.public.submitResult, {
        commandId: commands[0]._id,
        success: true,
        output: "test",
        exitCode: 0,
        durationMs: 100,
      });
      expect(submitResult.success).toBe(true);

      // 8. Send heartbeat
      const heartbeatResult = await t.mutation(api.public.sendHeartbeat, {
        apiKeyId: "workflow-api-key",
      });
      expect(heartbeatResult.success).toBe(true);

      // Verify no more pending commands
      const finalCommands = await t.query(api.public.getPendingCommands, {
        machineId: "workflow-machine",
      });
      expect(finalCommands).toHaveLength(0);
    });
  });
});
