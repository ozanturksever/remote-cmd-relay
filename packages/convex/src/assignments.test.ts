import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createRelayTestConvex,
  createTestRelayAssignment,
  type RelayTestConvex,
} from "./test.setup";
import { api } from "./_generated/api";

describe("relay assignments", () => {
  let t: RelayTestConvex;

  beforeEach(() => {
    vi.useFakeTimers();
    t = createRelayTestConvex();
  });

  afterEach(async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  describe("create", () => {
    it("creates a relay assignment", async () => {
      const result = await t.mutation(api.assignments.create, {
        apiKeyId: "api-key-123",
        machineId: "machine-456",
        name: "Test Relay",
        createdBy: "user-789",
      });

      expect(result).toBeDefined();

      // Verify the assignment was created
      const assignment = await t.run(async (ctx) => {
        return await ctx.db.get(result);
      });

      expect(assignment).not.toBeNull();
      expect(assignment?.apiKeyId).toBe("api-key-123");
      expect(assignment?.machineId).toBe("machine-456");
      expect(assignment?.name).toBe("Test Relay");
      expect(assignment?.enabled).toBe(true);
    });

    it("prevents duplicate API key assignments", async () => {
      await t.mutation(api.assignments.create, {
        apiKeyId: "api-key-duplicate",
        machineId: "machine-1",
        name: "First Relay",
        createdBy: "user-1",
      });

      await expect(
        t.mutation(api.assignments.create, {
          apiKeyId: "api-key-duplicate",
          machineId: "machine-2",
          name: "Second Relay",
          createdBy: "user-1",
        })
      ).rejects.toThrow("API key is already assigned to a machine");
    });
  });

  describe("getByApiKeyId", () => {
    it("returns assignment by API key ID", async () => {
      const created = await createTestRelayAssignment(t, {
        apiKeyId: "lookup-key",
        name: "Lookup Relay",
      });

      const result = await t.query(api.assignments.getByApiKeyId, {
        apiKeyId: "lookup-key",
      });

      expect(result).not.toBeNull();
      expect(result?._id).toBe(created._id);
      expect(result?.name).toBe("Lookup Relay");
    });

    it("returns null for unknown API key", async () => {
      const result = await t.query(api.assignments.getByApiKeyId, {
        apiKeyId: "unknown-key",
      });

      expect(result).toBeNull();
    });
  });

  describe("listByMachineId", () => {
    it("lists assignments for a machine", async () => {
      await createTestRelayAssignment(t, {
        machineId: "target-machine",
        apiKeyId: "key-1",
        name: "Relay 1",
      });
      await createTestRelayAssignment(t, {
        machineId: "target-machine",
        apiKeyId: "key-2",
        name: "Relay 2",
      });
      await createTestRelayAssignment(t, {
        machineId: "other-machine",
        apiKeyId: "key-3",
        name: "Other Relay",
      });

      const result = await t.query(api.assignments.listByMachineId, {
        machineId: "target-machine",
      });

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name).sort()).toEqual(["Relay 1", "Relay 2"]);
    });

    it("returns empty array for machine with no assignments", async () => {
      const result = await t.query(api.assignments.listByMachineId, {
        machineId: "no-assignments-machine",
      });

      expect(result).toHaveLength(0);
    });
  });

  describe("listAll", () => {
    it("lists all assignments", async () => {
      await createTestRelayAssignment(t, { apiKeyId: "key-a", name: "Relay A" });
      await createTestRelayAssignment(t, { apiKeyId: "key-b", name: "Relay B" });

      const result = await t.query(api.assignments.listAll, {});

      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates assignment name", async () => {
      const created = await createTestRelayAssignment(t, {
        name: "Original Name",
      });

      await t.mutation(api.assignments.update, {
        id: created._id,
        name: "Updated Name",
      });

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(updated?.name).toBe("Updated Name");
    });

    it("updates assignment enabled status", async () => {
      const created = await createTestRelayAssignment(t, {
        enabled: true,
      });

      await t.mutation(api.assignments.update, {
        id: created._id,
        enabled: false,
      });

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(updated?.enabled).toBe(false);
    });

    it("throws for non-existent assignment", async () => {
      // Create and delete an assignment to get a valid but non-existent ID
      const created = await createTestRelayAssignment(t);
      await t.run(async (ctx) => {
        await ctx.db.delete(created._id);
      });

      await expect(
        t.mutation(api.assignments.update, {
          id: created._id,
          name: "Will Fail",
        })
      ).rejects.toThrow("Relay assignment not found");
    });
  });

  describe("heartbeat", () => {
    it("updates lastSeenAt timestamp", async () => {
      const created = await createTestRelayAssignment(t, {
        apiKeyId: "heartbeat-key",
      });

      // Verify no lastSeenAt initially
      const before = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });
      expect(before?.lastSeenAt).toBeUndefined();

      // Send heartbeat
      await t.mutation(api.assignments.heartbeat, {
        apiKeyId: "heartbeat-key",
      });

      const after = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(after?.lastSeenAt).toBeDefined();
    });

    it("does nothing for unknown API key", async () => {
      // Should not throw
      await t.mutation(api.assignments.heartbeat, {
        apiKeyId: "unknown-heartbeat-key",
      });
    });
  });

  describe("remove", () => {
    it("deletes an assignment", async () => {
      const created = await createTestRelayAssignment(t);

      await t.mutation(api.assignments.remove, {
        id: created._id,
      });

      const deleted = await t.run(async (ctx) => {
        return await ctx.db.get(created._id);
      });

      expect(deleted).toBeNull();
    });
  });
});
