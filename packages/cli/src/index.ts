#!/usr/bin/env node

import { Relay } from "./relay.js";
import { logger, setLogLevel } from "./logger.js";

const VERSION = "2.0.1";

function printUsage(): void {
  console.log(`
remote-cmd-relay v${VERSION}

Usage: remote-cmd-relay <API_KEY> <CONVEX_URL> [options]

Arguments:
  API_KEY      Better Auth API key for authentication
  CONVEX_URL   Convex site URL (e.g., https://your-app.convex.site)

Options:
  --poll-interval <ms>      Polling interval in milliseconds (default: 5000)
  --heartbeat-interval <ms> Heartbeat interval in milliseconds (default: 30000)
  --log-level <level>       Log level: debug, info, warn, error (default: info)
  --store-dir <path>        Custom directory for credential store (default: ~/.remote-cmd-relay)
  --deployment-url <url>    Convex deployment URL for subscription mode (enables real-time command pickup)
  --component-name <name>   Convex component name (default: remoteCmdRelay)
  --public-api-module <name> App-level module exposing component functions (default: relayPublic)
  --help, -h                Show this help message
  --version, -v             Show version

Modes:
  Polling mode (default):     Uses HTTP polling to check for commands
  Subscription mode:          Uses Convex WebSocket subscriptions for instant command pickup
                              Enable by providing --deployment-url

Examples:
  remote-cmd-relay sk_live_xxx https://my-app.convex.site
  remote-cmd-relay sk_live_xxx https://my-app.convex.site --log-level debug
  remote-cmd-relay sk_live_xxx https://my-app.convex.site --poll-interval 2000
  remote-cmd-relay sk_live_xxx https://my-app.convex.site --store-dir /path/to/store
  
  # Subscription mode (real-time):
  remote-cmd-relay sk_live_xxx https://my-app.convex.site --deployment-url https://my-app.convex.cloud
`);
}

function parseArgs(args: string[]): {
  apiKey: string;
  convexUrl: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  storeDir?: string;
  convexDeploymentUrl?: string;
  componentName?: string;
  publicApiModule?: string;
} | null {
  const result = {
    apiKey: "",
    convexUrl: "",
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    logLevel: "info" as "debug" | "info" | "warn" | "error",
    storeDir: undefined as string | undefined,
    convexDeploymentUrl: undefined as string | undefined,
    componentName: undefined as string | undefined,
    publicApiModule: undefined as string | undefined,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--version" || arg === "-v") {
      console.log(`remote-cmd-relay v${VERSION}`);
      process.exit(0);
    }

    if (arg === "--poll-interval") {
      i++;
      const val = parseInt(args[i], 10);
      if (isNaN(val) || val < 1000) {
        console.error("Error: --poll-interval must be a number >= 1000");
        return null;
      }
      result.pollIntervalMs = val;
    } else if (arg === "--heartbeat-interval") {
      i++;
      const val = parseInt(args[i], 10);
      if (isNaN(val) || val < 5000) {
        console.error("Error: --heartbeat-interval must be a number >= 5000");
        return null;
      }
      result.heartbeatIntervalMs = val;
    } else if (arg === "--log-level") {
      i++;
      const val = args[i] as "debug" | "info" | "warn" | "error";
      if (!["debug", "info", "warn", "error"].includes(val)) {
        console.error("Error: --log-level must be one of: debug, info, warn, error");
        return null;
      }
      result.logLevel = val;
    } else if (arg === "--store-dir") {
      i++;
      const val = args[i];
      if (!val || val.startsWith("--")) {
        console.error("Error: --store-dir requires a path argument");
        return null;
      }
      result.storeDir = val;
    } else if (arg === "--deployment-url") {
      i++;
      const val = args[i];
      if (!val || val.startsWith("--")) {
        console.error("Error: --deployment-url requires a URL argument");
        return null;
      }
      result.convexDeploymentUrl = val;
    } else if (arg === "--component-name") {
      i++;
      const val = args[i];
      if (!val || val.startsWith("--")) {
        console.error("Error: --component-name requires a name argument");
        return null;
      }
      result.componentName = val;
    } else if (arg === "--public-api-module") {
      i++;
      const val = args[i];
      if (!val || val.startsWith("--")) {
        console.error("Error: --public-api-module requires a module name argument");
        return null;
      }
      result.publicApiModule = val;
    } else if (!arg.startsWith("--")) {
      // Positional arguments
      if (!result.apiKey) {
        result.apiKey = arg;
      } else if (!result.convexUrl) {
        result.convexUrl = arg;
      } else {
        console.error(`Error: Unexpected argument: ${arg}`);
        return null;
      }
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      return null;
    }

    i++;
  }

  if (!result.apiKey || !result.convexUrl) {
    console.error("Error: API_KEY and CONVEX_URL are required");
    printUsage();
    return null;
  }

  // Validate and normalize URL
  if (!result.convexUrl.startsWith("http")) {
    result.convexUrl = `https://${result.convexUrl}`;
  }

  // Remove trailing slash
  result.convexUrl = result.convexUrl.replace(/\/$/, "");

  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const config = parseArgs(args);
  if (!config) {
    process.exit(1);
  }

  setLogLevel(config.logLevel);

  logger.info("Remote Command Relay starting...", {
    version: VERSION,
    convexUrl: config.convexUrl,
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    mode: config.convexDeploymentUrl ? "subscription" : "polling",
  });

  const relay = new Relay({
    apiKey: config.apiKey,
    convexUrl: config.convexUrl,
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    statusReportIntervalMs: config.heartbeatIntervalMs, // Same as heartbeat by default
    storeDir: config.storeDir,
    convexDeploymentUrl: config.convexDeploymentUrl,
    componentName: config.componentName,
    publicApiModule: config.publicApiModule,
  });

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info("Received shutdown signal");
    relay.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await relay.start();

    // Keep the process running
    logger.info("Relay is running. Press Ctrl+C to stop.");
    
    // Keep alive
    await new Promise(() => {});
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Failed to start relay", { error });
    process.exit(1);
  }
}

main();
