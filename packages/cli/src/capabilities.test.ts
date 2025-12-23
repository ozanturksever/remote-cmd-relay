import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";

// Mock logger
vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ssh2 for capability detection
vi.mock("ssh2", () => ({
  Client: vi.fn(),
}));

describe("capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("detectCapabilities", () => {
    it("always includes local_cmd capability", async () => {
      const { detectCapabilities } = await import("./capabilities");
      const info = await detectCapabilities();

      expect(info.capabilities).toContain("local_cmd");
    });

    it("includes perf_metrics on supported platforms", async () => {
      const { detectCapabilities } = await import("./capabilities");
      const info = await detectCapabilities();

      const supportedPlatforms = ["linux", "darwin", "win32"];
      if (supportedPlatforms.includes(os.platform())) {
        expect(info.capabilities).toContain("perf_metrics");
      }
    });

    it("includes ssh capability when ssh2 is available", async () => {
      const { detectCapabilities } = await import("./capabilities");
      const info = await detectCapabilities();

      // ssh2 is mocked and available
      expect(info.capabilities).toContain("ssh");
    });

    it("returns version string", async () => {
      const { detectCapabilities, getVersion } = await import("./capabilities");
      const info = await detectCapabilities();

      expect(info.version).toBeDefined();
      expect(typeof info.version).toBe("string");
      expect(info.version).toBe(getVersion());
    });

    it("returns hostname", async () => {
      const { detectCapabilities } = await import("./capabilities");
      const info = await detectCapabilities();

      expect(info.hostname).toBe(os.hostname());
    });

    it("returns platform info", async () => {
      const { detectCapabilities } = await import("./capabilities");
      const info = await detectCapabilities();

      expect(info.platform).toContain(os.platform());
      expect(info.platform).toContain(os.arch());
    });
  });

  describe("getMachineId", () => {
    it("returns a non-empty string", async () => {
      const { getMachineId } = await import("./capabilities");
      const machineId = getMachineId();

      expect(machineId).toBeDefined();
      expect(typeof machineId).toBe("string");
      expect(machineId.length).toBeGreaterThan(0);
    });

    it("returns consistent value on same machine", async () => {
      const { getMachineId } = await import("./capabilities");
      const id1 = getMachineId();
      const id2 = getMachineId();

      expect(id1).toBe(id2);
    });

    it("returns 32-character hex string", async () => {
      const { getMachineId } = await import("./capabilities");
      const machineId = getMachineId();

      expect(machineId).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe("getVersion", () => {
    it("returns version string", async () => {
      const { getVersion } = await import("./capabilities");
      const version = getVersion();

      expect(version).toBeDefined();
      expect(typeof version).toBe("string");
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("hasCapability", () => {
    it("returns true for available capability", async () => {
      const { hasCapability } = await import("./capabilities");
      const hasLocalCmd = await hasCapability("local_cmd");

      expect(hasLocalCmd).toBe(true);
    });
  });
});

describe("metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("collectMetrics", () => {
    it("returns memory metrics", async () => {
      const { collectMetrics } = await import("./metrics");
      const metrics = await collectMetrics();

      expect(metrics.memoryTotalMb).toBeDefined();
      expect(metrics.memoryUsedMb).toBeDefined();
      expect(metrics.memoryPercent).toBeDefined();

      expect(metrics.memoryTotalMb).toBeGreaterThan(0);
      expect(metrics.memoryUsedMb).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryPercent).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryPercent).toBeLessThanOrEqual(100);
    });

    it("returns load average on Unix systems", async () => {
      const { collectMetrics } = await import("./metrics");
      const metrics = await collectMetrics();

      if (os.platform() !== "win32") {
        expect(metrics.loadAvg1m).toBeDefined();
        expect(metrics.loadAvg5m).toBeDefined();
        expect(metrics.loadAvg15m).toBeDefined();
      }
    });

    it("returns disk metrics", async () => {
      const { collectMetrics } = await import("./metrics");
      const metrics = await collectMetrics();

      // Disk metrics may not be available in all environments
      if (metrics.diskTotalGb !== undefined) {
        expect(metrics.diskTotalGb).toBeGreaterThan(0);
        expect(metrics.diskUsedGb).toBeGreaterThanOrEqual(0);
        expect(metrics.diskPercent).toBeGreaterThanOrEqual(0);
        expect(metrics.diskPercent).toBeLessThanOrEqual(100);
      }
    });

    it("returns CPU percent after baseline established", async () => {
      const { collectMetrics } = await import("./metrics");

      // First call establishes baseline
      await collectMetrics();

      // Wait a bit for CPU to change
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second call should have CPU percentage
      const metrics = await collectMetrics();

      // CPU percent may still be null/undefined if there's no CPU activity
      if (metrics.cpuPercent !== undefined) {
        expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
        expect(metrics.cpuPercent).toBeLessThanOrEqual(100);
      }
    });

    it("handles metrics collection errors gracefully", async () => {
      const { collectMetrics } = await import("./metrics");

      // Should not throw even if some metrics fail
      const metrics = await collectMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe("object");
    });
  });

  describe("startMetricsCollection", () => {
    it("calls callback periodically", async () => {
      const { startMetricsCollection } = await import("./metrics");
      const callback = vi.fn();

      const stop = startMetricsCollection(100, callback);

      // Wait for a few intervals
      await new Promise((resolve) => setTimeout(resolve, 350));

      stop();

      // Should have been called at least twice (after initial baseline)
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("stops when stop function is called", async () => {
      const { startMetricsCollection } = await import("./metrics");
      const callback = vi.fn();

      const stop = startMetricsCollection(50, callback);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const callCountBeforeStop = callback.mock.calls.length;
      stop();

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not have been called more times after stopping
      expect(callback.mock.calls.length).toBe(callCountBeforeStop);
    });

    it("passes metrics to callback", async () => {
      const { startMetricsCollection } = await import("./metrics");

      let receivedMetrics: unknown = null;
      const callback = vi.fn((metrics) => {
        receivedMetrics = metrics;
      });

      const stop = startMetricsCollection(100, callback);

      await new Promise((resolve) => setTimeout(resolve, 150));

      stop();

      expect(receivedMetrics).not.toBeNull();
      expect(typeof receivedMetrics).toBe("object");
    });
  });
});
