import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectMetrics, startMetricsCollection } from "./metrics";

describe("metrics", () => {
  describe("collectMetrics", () => {
    it("returns memory metrics", async () => {
      const metrics = await collectMetrics();

      expect(metrics.memoryTotalMb).toBeDefined();
      expect(metrics.memoryUsedMb).toBeDefined();
      expect(metrics.memoryPercent).toBeDefined();

      expect(metrics.memoryTotalMb).toBeGreaterThan(0);
      expect(metrics.memoryUsedMb).toBeGreaterThan(0);
      expect(metrics.memoryPercent).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryPercent).toBeLessThanOrEqual(100);
    });

    it("returns load average on Unix systems", async () => {
      const metrics = await collectMetrics();

      const platform = process.platform;
      if (platform === "linux" || platform === "darwin") {
        expect(metrics.loadAvg1m).toBeDefined();
        expect(metrics.loadAvg5m).toBeDefined();
        expect(metrics.loadAvg15m).toBeDefined();

        expect(metrics.loadAvg1m).toBeGreaterThanOrEqual(0);
      }
    });

    it("returns disk metrics on supported platforms", async () => {
      const metrics = await collectMetrics();

      const platform = process.platform;
      if (["linux", "darwin", "win32"].includes(platform)) {
        // Disk metrics may or may not be available depending on permissions
        if (metrics.diskTotalGb !== undefined) {
          expect(metrics.diskTotalGb).toBeGreaterThan(0);
          expect(metrics.diskUsedGb).toBeGreaterThanOrEqual(0);
          expect(metrics.diskPercent).toBeGreaterThanOrEqual(0);
          expect(metrics.diskPercent).toBeLessThanOrEqual(100);
        }
      }
    });

    it("returns CPU percentage on second call", async () => {
      // First call establishes baseline
      await collectMetrics();

      // Wait a bit for some CPU activity
      await new Promise((r) => setTimeout(r, 100));

      // Second call should have CPU percentage
      const metrics = await collectMetrics();

      expect(metrics.cpuPercent).toBeDefined();
      expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuPercent).toBeLessThanOrEqual(100);
    });

    it("handles errors gracefully", async () => {
      // collectMetrics should never throw, just return partial metrics
      const metrics = await collectMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe("object");
    });
  });

  describe("startMetricsCollection", () => {
    it("calls callback at specified interval", async () => {
      const callback = vi.fn();
      const stop = startMetricsCollection(100, callback);

      // Wait for a few intervals
      await new Promise((r) => setTimeout(r, 350));

      stop();

      // Should have been called 3 times (at 100ms, 200ms, 300ms)
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("passes metrics to callback", async () => {
      let receivedMetrics: unknown = null;
      const stop = startMetricsCollection(50, (metrics) => {
        receivedMetrics = metrics;
      });

      await new Promise((r) => setTimeout(r, 100));

      stop();

      expect(receivedMetrics).toBeDefined();
      expect((receivedMetrics as { memoryTotalMb?: number }).memoryTotalMb).toBeGreaterThan(0);
    });

    it("stops when stop function is called", async () => {
      const callback = vi.fn();
      const stop = startMetricsCollection(50, callback);

      await new Promise((r) => setTimeout(r, 75));

      const callCount = callback.mock.calls.length;
      stop();

      await new Promise((r) => setTimeout(r, 150));

      // Should not have more calls after stopping
      expect(callback.mock.calls.length).toBe(callCount);
    });
  });
});
