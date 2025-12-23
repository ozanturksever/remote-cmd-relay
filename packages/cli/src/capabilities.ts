import { logger } from "./logger.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type Capability = "ssh" | "local_cmd" | "perf_metrics";

export interface CapabilityInfo {
  capabilities: Capability[];
  version: string;
  hostname: string;
  platform: string;
}

const RELAY_VERSION = "1.0.0";

/**
 * Detect available capabilities on this relay
 */
export async function detectCapabilities(): Promise<CapabilityInfo> {
  const capabilities: Capability[] = [];

  // Local command execution is always available
  capabilities.push("local_cmd");

  // Check for SSH capability (ssh2 library is bundled)
  if (await canDoSSH()) {
    capabilities.push("ssh");
  }

  // Performance metrics are always available on supported platforms
  if (canCollectMetrics()) {
    capabilities.push("perf_metrics");
  }

  logger.info("Detected capabilities", { capabilities });

  return {
    capabilities,
    version: RELAY_VERSION,
    hostname: os.hostname(),
    platform: `${os.platform()}-${os.arch()}`,
  };
}

/**
 * Check if SSH is available
 */
async function canDoSSH(): Promise<boolean> {
  try {
    // Check if ssh2 module is available
    const ssh2 = await import("ssh2");
    return !!ssh2.Client;
  } catch {
    return false;
  }
}

/**
 * Check if we can collect performance metrics
 */
function canCollectMetrics(): boolean {
  // Metrics collection works on all Node.js/Bun platforms
  const platform = os.platform();
  return ["linux", "darwin", "win32"].includes(platform);
}

/**
 * Check if a specific capability is available
 */
export async function hasCapability(capability: Capability): Promise<boolean> {
  const info = await detectCapabilities();
  return info.capabilities.includes(capability);
}

/**
 * Get relay version
 */
export function getVersion(): string {
  return RELAY_VERSION;
}

/**
 * Get machine ID for key derivation
 * Uses a combination of hostname and machine-specific identifiers
 */
export function getMachineId(): string {
  const hostname = os.hostname();
  const platform = os.platform();
  
  // Try to get a more unique identifier
  let machineSpecific = "";
  
  if (platform === "linux") {
    // Try to read machine-id
    try {
      machineSpecific = fs.readFileSync("/etc/machine-id", "utf8").trim();
    } catch {
      // Fall back to hostname
    }
  } else if (platform === "darwin") {
    // Use hardware UUID on macOS
    try {
      const { execSync } = require("child_process");
      const output = execSync("ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID", {
        encoding: "utf8",
      });
      const match = output.match(/"IOPlatformUUID" = "([^"]+)"/);
      if (match) {
        machineSpecific = match[1];
      }
    } catch {
      // Fall back to hostname
    }
  }

  // Combine identifiers
  const combined = `${hostname}:${platform}:${machineSpecific || "default"}`;
  
  // Create a hash for consistency
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(combined).digest("hex").substring(0, 32);
}
