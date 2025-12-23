import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRelayTestConvex, RelayTestConvex } from "./test.setup";
import { createMockRelayStatus } from "./test.helpers";
import { api } from "./_generated/api";

describe("status", () => {
  let t: RelayTestConvex;

  beforeEach(() => {
    vi.useFakeTimers();
    t = createRelayTestConvex();
  });

  afterEach(async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  describe("reportStatus", () => {
    it("creates new relay status record", async () => {
      const result = await t.mutation(api.status.reportStatus, {
        relayId: "new-relay",
        capabilities: ["ssh", "local_cmd"],
        version: "1.0.0",
        hostname: "relay-host",
        platform: "linux",
      });

      expect(result.success).toBe(true);
      expect(result.statusId).toBeDefined();

      const status = await t.query(api.status.getByRelayId, {
        relayId: "new-relay",
      });

      expect(status).not.toBeNull();
      expect(status?.capabilities).toEqual(["ssh", "local_cmd"]);
      expect(status?.version).toBe("1.0.0");
      expect(status?.hostname).toBe("relay-host");
      expect(status?.platform).toBe("linux");
    });

    it("updates existing relay status record", async () => {
      // Create initial status
      await t.mutation(api.status.reportStatus, {
        relayId: "update-relay",
        capabilities: ["local_cmd"],
        version: "1.0.0",
      });

      // Update status
      const result = await t.mutation(api.status.reportStatus, {
        relayId: "update-relay",
        capabilities: ["ssh", "local_cmd", "perf_metrics"],
        version: "2.0.0",
        hostname: "new-hostname",
      });

      expect(result.success).toBe(true);

      const status = await t.query(api.status.getByRelayId, {
        relayId: "update-relay",
      });

      expect(status?.capabilities).toEqual(["ssh", "local_cmd", "perf_metrics"]);
      expect(status?.version).toBe("2.0.0");
      expect(status?.hostname).toBe("new-hostname");
    });

    it("reports status with metrics", async () => {
      const result = await t.mutation(api.status.reportStatus, {
        relayId: "metrics-relay",
        capabilities: ["perf_metrics"],
        metrics: {
          cpuPercent: 45.5,
          memoryPercent: 60.2,
          memoryUsedMb: 4096,
          memoryTotalMb: 8192,
          diskPercent: 75.0,
          loadAvg1m: 1.5,
          loadAvg5m: 1.2,
          loadAvg15m: 0.9,
        },
      });

      expect(result.success).toBe(true);

      const status = await t.query(api.status.getByRelayId, {
        relayId: "metrics-relay",
      });

      expect(status?.metrics?.cpuPercent).toBe(45.5);
      expect(status?.metrics?.memoryPercent).toBe(60.2);
      expect(status?.metrics?.loadAvg1m).toBe(1.5);
    });

    it("updates lastHeartbeatAt on status report", async () => {
      await t.mutation(api.status.reportStatus, {
        relayId: "heartbeat-relay",
        capabilities: ["local_cmd"],
      });

      const status = await t.query(api.status.getByRelayId, {
        relayId: "heartbeat-relay",
      });

      expect(status?.lastHeartbeatAt).toBeDefined();
      expect(status?.lastHeartbeatAt).toBeGreaterThan(0);
    });
  });

  describe("getByRelayId", () => {
    it("returns status when found", async () => {
      await createMockRelayStatus(t, {
        relayId: "find-me-relay",
        capabilities: ["ssh", "local_cmd"],
        version: "1.0.0",
      });

      const status = await t.query(api.status.getByRelayId, {
        relayId: "find-me-relay",
      });

      expect(status).not.toBeNull();
      expect(status?.relayId).toBe("find-me-relay");
      expect(status?.capabilities).toEqual(["ssh", "local_cmd"]);
    });

    it("returns null when not found", async () => {
      const status = await t.query(api.status.getByRelayId, {
        relayId: "nonexistent-relay",
      });

      expect(status).toBeNull();
    });
  });

  describe("listAll", () => {
    it("lists all relay statuses", async () => {
      await createMockRelayStatus(t, { relayId: "relay-1" });
      await createMockRelayStatus(t, { relayId: "relay-2" });
      await createMockRelayStatus(t, { relayId: "relay-3" });

      const statuses = await t.query(api.status.listAll, {});

      expect(statuses).toHaveLength(3);
    });

    it("includes isOnline flag based on heartbeat", async () => {
      const now = Date.now();

      // Create online relay (recent heartbeat)
      await createMockRelayStatus(t, {
        relayId: "online-relay",
        lastHeartbeatAt: now - 30000, // 30 seconds ago
      });

      // Create offline relay (old heartbeat)
      await createMockRelayStatus(t, {
        relayId: "offline-relay",
        lastHeartbeatAt: now - 120000, // 2 minutes ago
      });

      const statuses = await t.query(api.status.listAll, {});

      const onlineRelay = statuses.find((s) => s.relayId === "online-relay");
      const offlineRelay = statuses.find((s) => s.relayId === "offline-relay");

      expect(onlineRelay?.isOnline).toBe(true);
      expect(offlineRelay?.isOnline).toBe(false);
    });

    it("returns empty array when no statuses exist", async () => {
      const statuses = await t.query(api.status.listAll, {});

      expect(statuses).toEqual([]);
    });
  });

  describe("findByCapability", () => {
    it("finds relays with specific capability", async () => {
      await createMockRelayStatus(t, {
        relayId: "ssh-relay-1",
        capabilities: ["ssh", "local_cmd"],
      });
      await createMockRelayStatus(t, {
        relayId: "ssh-relay-2",
        capabilities: ["ssh"],
      });
      await createMockRelayStatus(t, {
        relayId: "local-only-relay",
        capabilities: ["local_cmd"],
      });

      const sshRelays = await t.query(api.status.findByCapability, {
        capability: "ssh",
      });

      expect(sshRelays).toHaveLength(2);
      expect(sshRelays.map((r) => r.relayId)).toContain("ssh-relay-1");
      expect(sshRelays.map((r) => r.relayId)).toContain("ssh-relay-2");
    });

    it("finds relays with perf_metrics capability", async () => {
      await createMockRelayStatus(t, {
        relayId: "metrics-relay",
        capabilities: ["local_cmd", "perf_metrics"],
      });
      await createMockRelayStatus(t, {
        relayId: "no-metrics-relay",
        capabilities: ["local_cmd"],
      });

      const metricsRelays = await t.query(api.status.findByCapability, {
        capability: "perf_metrics",
      });

      expect(metricsRelays).toHaveLength(1);
      expect(metricsRelays[0].relayId).toBe("metrics-relay");
    });

    it("includes isOnline flag in results", async () => {
      const now = Date.now();

      await createMockRelayStatus(t, {
        relayId: "online-ssh-relay",
        capabilities: ["ssh"],
        lastHeartbeatAt: now - 30000,
      });

      await createMockRelayStatus(t, {
        relayId: "offline-ssh-relay",
        capabilities: ["ssh"],
        lastHeartbeatAt: now - 120000,
      });

      const relays = await t.query(api.status.findByCapability, {
        capability: "ssh",
      });

      const online = relays.find((r) => r.relayId === "online-ssh-relay");
      const offline = relays.find((r) => r.relayId === "offline-ssh-relay");

      expect(online?.isOnline).toBe(true);
      expect(offline?.isOnline).toBe(false);
    });

    it("returns empty array when no relays have capability", async () => {
      await createMockRelayStatus(t, {
        relayId: "local-only",
        capabilities: ["local_cmd"],
      });

      const relays = await t.query(api.status.findByCapability, {
        capability: "ssh",
      });

      expect(relays).toEqual([]);
    });
  });

  describe("status lifecycle", () => {
    it("tracks relay status through multiple updates", async () => {
      const relayId = "lifecycle-relay";

      // Initial registration
      await t.mutation(api.status.reportStatus, {
        relayId,
        capabilities: ["local_cmd"],
        version: "1.0.0",
        platform: "linux",
      });

      let status = await t.query(api.status.getByRelayId, { relayId });
      expect(status?.version).toBe("1.0.0");
      expect(status?.capabilities).toEqual(["local_cmd"]);

      // Upgrade with new capabilities
      await t.mutation(api.status.reportStatus, {
        relayId,
        capabilities: ["local_cmd", "ssh"],
        version: "1.1.0",
        platform: "linux",
      });

      status = await t.query(api.status.getByRelayId, { relayId });
      expect(status?.version).toBe("1.1.0");
      expect(status?.capabilities).toContain("ssh");

      // Add metrics capability
      await t.mutation(api.status.reportStatus, {
        relayId,
        capabilities: ["local_cmd", "ssh", "perf_metrics"],
        version: "1.2.0",
        platform: "linux",
        metrics: {
          cpuPercent: 25.0,
          memoryPercent: 50.0,
        },
      });

      status = await t.query(api.status.getByRelayId, { relayId });
      expect(status?.version).toBe("1.2.0");
      expect(status?.capabilities).toHaveLength(3);
      expect(status?.metrics?.cpuPercent).toBe(25.0);
    });
  });
});
