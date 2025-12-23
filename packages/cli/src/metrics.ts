import * as os from "os";
import * as fs from "fs";
import { logger } from "./logger.js";

export interface PerformanceMetrics {
  cpuPercent?: number;
  memoryPercent?: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  diskPercent?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  loadAvg1m?: number;
  loadAvg5m?: number;
  loadAvg15m?: number;
}

let lastCpuInfo: { idle: number; total: number } | null = null;

/**
 * Collect current performance metrics
 */
export async function collectMetrics(): Promise<PerformanceMetrics> {
  const metrics: PerformanceMetrics = {};

  try {
    // CPU usage
    const cpuPercent = getCpuPercent();
    if (cpuPercent !== null) {
      metrics.cpuPercent = Math.round(cpuPercent * 100) / 100;
    }

    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    metrics.memoryTotalMb = Math.round(totalMem / (1024 * 1024));
    metrics.memoryUsedMb = Math.round(usedMem / (1024 * 1024));
    metrics.memoryPercent = Math.round((usedMem / totalMem) * 10000) / 100;

    // Load average (Unix only)
    const loadAvg = os.loadavg();
    if (loadAvg && loadAvg.length === 3) {
      metrics.loadAvg1m = Math.round(loadAvg[0] * 100) / 100;
      metrics.loadAvg5m = Math.round(loadAvg[1] * 100) / 100;
      metrics.loadAvg15m = Math.round(loadAvg[2] * 100) / 100;
    }

    // Disk usage (root partition)
    const diskInfo = await getDiskUsage();
    if (diskInfo) {
      metrics.diskTotalGb = diskInfo.totalGb;
      metrics.diskUsedGb = diskInfo.usedGb;
      metrics.diskPercent = diskInfo.percent;
    }
  } catch (err) {
    logger.warn("Error collecting metrics", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return metrics;
}

/**
 * Calculate CPU usage percentage
 * Returns null on first call (needs baseline)
 */
function getCpuPercent(): number | null {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type as keyof typeof cpu.times];
    }
    idle += cpu.times.idle;
  }

  if (lastCpuInfo === null) {
    lastCpuInfo = { idle, total };
    return null;
  }

  const idleDiff = idle - lastCpuInfo.idle;
  const totalDiff = total - lastCpuInfo.total;

  lastCpuInfo = { idle, total };

  if (totalDiff === 0) return 0;

  return ((totalDiff - idleDiff) / totalDiff) * 100;
}

/**
 * Get disk usage for root partition
 */
async function getDiskUsage(): Promise<{
  totalGb: number;
  usedGb: number;
  percent: number;
} | null> {
  const platform = os.platform();

  if (platform === "linux" || platform === "darwin") {
    try {
      // Use df command
      const { execSync } = require("child_process");
      const output = execSync("df -k / | tail -1", { encoding: "utf8" });
      const parts = output.trim().split(/\s+/);

      if (parts.length >= 4) {
        const totalKb = parseInt(parts[1], 10);
        const usedKb = parseInt(parts[2], 10);

        const totalGb = Math.round((totalKb / (1024 * 1024)) * 100) / 100;
        const usedGb = Math.round((usedKb / (1024 * 1024)) * 100) / 100;
        const percent = Math.round((usedKb / totalKb) * 10000) / 100;

        return { totalGb, usedGb, percent };
      }
    } catch {
      // Fall through
    }
  } else if (platform === "win32") {
    try {
      const { execSync } = require("child_process");
      const output = execSync(
        'wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace,Size /format:csv',
        { encoding: "utf8" }
      );
      const lines = output.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(",");
        if (parts.length >= 3) {
          const freeSpace = parseInt(parts[1], 10);
          const totalSize = parseInt(parts[2], 10);
          const usedSpace = totalSize - freeSpace;

          const totalGb = Math.round((totalSize / (1024 * 1024 * 1024)) * 100) / 100;
          const usedGb = Math.round((usedSpace / (1024 * 1024 * 1024)) * 100) / 100;
          const percent = Math.round((usedSpace / totalSize) * 10000) / 100;

          return { totalGb, usedGb, percent };
        }
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Start periodic metrics collection
 * @param intervalMs - Collection interval in milliseconds
 * @param callback - Callback with collected metrics
 * @returns Stop function
 */
export function startMetricsCollection(
  intervalMs: number,
  callback: (metrics: PerformanceMetrics) => void
): () => void {
  // Initial collection (to establish CPU baseline)
  collectMetrics();

  const interval = setInterval(async () => {
    const metrics = await collectMetrics();
    callback(metrics);
  }, intervalMs);

  return () => clearInterval(interval);
}
