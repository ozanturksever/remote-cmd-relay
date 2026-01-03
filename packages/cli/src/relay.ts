import { readFile } from "node:fs/promises";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { logger } from "./logger.js";
import { executeLocal, executeSSH, type ExecutionResult } from "./executor.js";
import { CredentialManager, type CredentialMetadata } from "./credentials.js";
import { detectCapabilities, getMachineId, type Capability } from "./capabilities.js";
import { collectMetrics, type PerformanceMetrics } from "./metrics.js";
import { SyncManager } from "./sync.js";

export interface RelayConfig {
  apiKey: string;
  convexUrl: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  statusReportIntervalMs: number;
  sharedSecretKey?: string; // For decrypting shared credentials
  storeDir?: string; // Custom directory for credential store
  convexDeploymentUrl?: string; // Convex deployment URL for subscription mode (e.g., https://your-app.convex.cloud)
  componentName?: string; // Convex component name (default: "remoteCmdRelay")
  publicApiModule?: string; // App-level module exposing component functions (default: "relayPublic")
}

export interface RelayAssignment {
  valid: true;
  assignmentId: string;
  machineId: string;
  name: string;
}

export interface Command {
  _id: string;
  command: string;
  targetType: "local" | "ssh";
  targetHost?: string;
  targetPort?: number;
  targetUsername?: string;
  timeoutMs: number;
  createdAt: number;
}

export class Relay {
  private config: RelayConfig;
  private assignment: RelayAssignment | null = null;
  private running = false;
  private pollInterval: Timer | null = null;
  private heartbeatInterval: Timer | null = null;
  private statusReportInterval: Timer | null = null;
  private capabilities: Capability[] = [];
  private syncManager: SyncManager | null = null;
  private credentialManager: CredentialManager;
  private convexClient: ConvexClient | null = null;
  private subscriptionUnsubscribe: (() => void) | null = null;
  private processingCommands: Set<string> = new Set(); // Track commands being processed

  constructor(config: RelayConfig) {
    this.config = {
      ...config,
      statusReportIntervalMs: config.statusReportIntervalMs || 30000, // Default 30s
      componentName: config.componentName || "remoteCmdRelay",
      publicApiModule: config.publicApiModule || "relayPublic",
    };
    this.credentialManager = new CredentialManager(config.storeDir);
  }

  /**
   * Start the relay
   */
  async start(): Promise<void> {
    logger.info("Starting relay...");

    // Detect capabilities
    const capInfo = await detectCapabilities();
    this.capabilities = capInfo.capabilities;
    logger.info("Detected capabilities", { capabilities: this.capabilities });

    // Initialize credential manager
    const machineId = getMachineId();
    await this.credentialManager.initialize(this.config.apiKey, machineId);
    logger.info("Credential manager initialized");

    // Verify API key and get assignment
    const verified = await this.verifyApiKey();
    if (!verified) {
      throw new Error("Failed to verify API key");
    }

    // Initialize sync manager
    this.syncManager = new SyncManager({
      convexUrl: this.config.convexUrl,
      apiKey: this.config.apiKey,
      relayId: this.assignment!.assignmentId,
    });
    if (this.config.sharedSecretKey) {
      this.syncManager.setSharedSecretKey(this.config.sharedSecretKey);
    }

    this.running = true;

    // Initial status report
    await this.reportFullStatus();

    // Initial sync
    await this.syncManager.fullSync();

    // Start watching for commands - use subscription mode if deployment URL is provided
    if (this.config.convexDeploymentUrl) {
      await this.startSubscriptionMode();
    } else {
      // Fall back to HTTP polling
      this.pollInterval = setInterval(
        () => this.pollForCommands(),
        this.config.pollIntervalMs
      );
    }

    // Start heartbeat
    this.heartbeatInterval = setInterval(
      () => this.sendHeartbeat(),
      this.config.heartbeatIntervalMs
    );

    // Start status reporting
    this.statusReportInterval = setInterval(
      () => this.reportFullStatus(),
      this.config.statusReportIntervalMs
    );

    // Initial poll (only if not using subscription mode)
    if (!this.config.convexDeploymentUrl) {
      await this.pollForCommands();
    }

    logger.info("Relay started successfully", {
      machineId: this.assignment?.machineId,
      name: this.assignment?.name,
      capabilities: this.capabilities,
      mode: this.config.convexDeploymentUrl ? "subscription" : "polling",
    });
  }

  /**
   * Start subscription mode using Convex client
   */
  private async startSubscriptionMode(): Promise<void> {
    if (!this.config.convexDeploymentUrl || !this.assignment) {
      throw new Error("Subscription mode requires convexDeploymentUrl and valid assignment");
    }

    logger.info("Starting subscription mode...", {
      deploymentUrl: this.config.convexDeploymentUrl,
    });

    // Create Convex client
    this.convexClient = new ConvexClient(this.config.convexDeploymentUrl);

    // Build the API reference for the app-level wrapper functions
    // Convex components are internal-only, so we use app-level wrappers
    const publicModule = this.config.publicApiModule!;
    const getPendingCommandsRef = anyApi[publicModule].getPendingCommands;

    // Subscribe to pending commands
    const machineId = this.assignment.machineId;

    this.subscriptionUnsubscribe = this.convexClient.onUpdate(
      getPendingCommandsRef,
      { machineId },
      (commands: Command[]) => {
        if (!this.running) return;

        if (commands && commands.length > 0) {
          logger.debug(`Subscription received ${commands.length} pending command(s)`);

          // Process commands that aren't already being processed
          for (const cmd of commands) {
            if (!this.processingCommands.has(cmd._id)) {
              this.processingCommands.add(cmd._id);
              this.processCommandViaConvex(cmd).finally(() => {
                this.processingCommands.delete(cmd._id);
              });
            }
          }
        }
      }
    );

    logger.info("Subscription mode started");
  }

  /**
   * Process a command using direct Convex mutations (subscription mode)
   */
  private async processCommandViaConvex(cmd: Command): Promise<void> {
    if (!this.convexClient || !this.assignment) return;

    logger.info(`Processing command ${cmd._id} via Convex`, {
      command: cmd.command.substring(0, 50),
      targetType: cmd.targetType,
    });

    const publicModule = this.config.publicApiModule!;

    // Claim the command via Convex mutation
    const claimCommandRef = anyApi[publicModule].claimCommand;

    try {
      const claimResult = await this.convexClient.mutation(claimCommandRef, {
        commandId: cmd._id,
        assignmentId: this.assignment.assignmentId,
      });

      if (!claimResult.success) {
        logger.warn(`Failed to claim command ${cmd._id}: ${claimResult.error}`);
        return;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to claim command ${cmd._id}`, { error });
      return;
    }

    // Execute the command
    let result: ExecutionResult;

    if (cmd.targetType === "local") {
      result = await executeLocal({
        command: cmd.command,
        timeoutMs: cmd.timeoutMs,
      });
    } else if (cmd.targetType === "ssh") {
      if (!cmd.targetHost) {
        result = {
          success: false,
          output: "",
          stderr: "",
          exitCode: -1,
          error: "SSH target host missing",
          durationMs: 0,
        };
      } else {
        // Try to get credentials from local credential store
        let privateKey = "";
        let username = cmd.targetUsername || "root";

        const storedCred = this.getCredentialForTarget(cmd.targetHost);
        if (storedCred) {
          privateKey = storedCred.privateKey;
          username = storedCred.username;
          logger.debug(`Using stored credential for ${cmd.targetHost}`);
        } else {
          // Fall back to reading from ~/.ssh/id_rsa
          try {
            const homeDir = process.env.HOME || process.env.USERPROFILE || "";
            privateKey = await readFile(`${homeDir}/.ssh/id_rsa`, "utf-8");
            logger.debug("Using default SSH key from ~/.ssh/id_rsa");
          } catch {
            result = {
              success: false,
              output: "",
              stderr: "",
              exitCode: -1,
              error: `No credentials found for ${cmd.targetHost} and failed to read default SSH key`,
              durationMs: 0,
            };
            await this.submitResultViaConvex(cmd._id, result);
            return;
          }
        }

        result = await executeSSH({
          command: cmd.command,
          host: cmd.targetHost,
          port: cmd.targetPort ?? 22,
          username,
          privateKey,
          timeoutMs: cmd.timeoutMs,
        });
      }
    } else {
      result = {
        success: false,
        output: "",
        stderr: "",
        exitCode: -1,
        error: `Unknown target type: ${cmd.targetType}`,
        durationMs: 0,
      };
    }

    // Submit result via Convex mutation
    await this.submitResultViaConvex(cmd._id, result);

    logger.info(`Command ${cmd._id} completed`, {
      success: result.success,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  }

  /**
   * Submit command result via Convex mutation (subscription mode)
   */
  private async submitResultViaConvex(commandId: string, result: ExecutionResult): Promise<void> {
    if (!this.convexClient) return;

    const publicModule = this.config.publicApiModule!;
    const submitResultRef = anyApi[publicModule].submitResult;

    try {
      await this.convexClient.mutation(submitResultRef, {
        commandId,
        success: result.success,
        output: result.output,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: result.error,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to submit result via Convex", { commandId, error });
    }
  }

  /**
   * Stop the relay
   */
  stop(): void {
    logger.info("Stopping relay...");
    this.running = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.statusReportInterval) {
      clearInterval(this.statusReportInterval);
      this.statusReportInterval = null;
    }

    // Clean up Convex subscription
    if (this.subscriptionUnsubscribe) {
      this.subscriptionUnsubscribe();
      this.subscriptionUnsubscribe = null;
    }

    // Close Convex client
    if (this.convexClient) {
      this.convexClient.close();
      this.convexClient = null;
    }

    logger.info("Relay stopped");
  }

  /**
   * Verify API key with Convex
   */
  private async verifyApiKey(): Promise<boolean> {
    logger.info("Verifying API key...");

    try {
      const response = await fetch(`${this.config.convexUrl}/relay/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: this.config.apiKey }),
      });

      // Check for non-JSON response (e.g., HTML error pages)
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        logger.error("Unexpected response type", { status: response.status, contentType, body: text.substring(0, 200) });
        return false;
      }

      let result: RelayAssignment | { valid: false; error: string };
      try {
        result = await response.json() as RelayAssignment | { valid: false; error: string };
      } catch (parseErr) {
        logger.error("Failed to parse JSON response", { error: String(parseErr) });
        return false;
      }

      // Validate the result has the expected shape
      if (result === null || result === undefined || typeof result !== "object") {
        logger.error("Invalid response: not an object", { result });
        return false;
      }

      if (!("valid" in result)) {
        logger.error("Invalid response: missing valid field", { result });
        return false;
      }

      if (!result.valid) {
        logger.error("API key verification failed", { error: (result as { error: string }).error });
        return false;
      }

      this.assignment = result as RelayAssignment;
      logger.info("API key verified", {
        assignmentId: this.assignment.assignmentId,
        machineId: this.assignment.machineId,
        name: this.assignment.name,
      });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to verify API key", { error });
      return false;
    }
  }

  /**
   * Poll for pending commands
   */
  private async pollForCommands(): Promise<void> {
    if (!this.running || !this.assignment) return;

    try {
      const response = await fetch(`${this.config.convexUrl}/relay/commands`, {
        method: "GET",
        headers: {
          "X-API-Key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        logger.warn("Failed to fetch commands", { status: response.status });
        return;
      }

      const data = await response.json() as { commands: Command[] };
      const commands = data.commands;

      if (commands.length > 0) {
        logger.debug(`Found ${commands.length} pending command(s)`);

        for (const cmd of commands) {
          await this.processCommand(cmd);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Error polling for commands", { error });
    }
  }

  /**
   * Process a single command
   */
  private async processCommand(cmd: Command): Promise<void> {
    logger.info(`Processing command ${cmd._id}`, {
      command: cmd.command.substring(0, 50),
      targetType: cmd.targetType,
    });

    // Claim the command
    const claimed = await this.claimCommand(cmd._id);
    if (!claimed) {
      logger.warn(`Failed to claim command ${cmd._id}`);
      return;
    }

    // Execute the command
    let result: ExecutionResult;

    if (cmd.targetType === "local") {
      result = await executeLocal({
        command: cmd.command,
        timeoutMs: cmd.timeoutMs,
      });      } else if (cmd.targetType === "ssh") {
      if (!cmd.targetHost) {
        result = {
          success: false,
          output: "",
          stderr: "",
          exitCode: -1,
          error: "SSH target host missing",
          durationMs: 0,
        };
      } else {
        // Try to get credentials from local credential store
        let privateKey = "";
        let username = cmd.targetUsername || "root";

        const storedCred = this.getCredentialForTarget(cmd.targetHost);
        if (storedCred) {
          privateKey = storedCred.privateKey;
          username = storedCred.username;
          logger.debug(`Using stored credential for ${cmd.targetHost}`);
        } else {
          // Fall back to reading from ~/.ssh/id_rsa
          try {
            const homeDir = process.env.HOME || process.env.USERPROFILE || "";
            privateKey = await readFile(`${homeDir}/.ssh/id_rsa`, "utf-8");
            logger.debug("Using default SSH key from ~/.ssh/id_rsa");
          } catch {
            result = {
              success: false,
              output: "",
              stderr: "",
              exitCode: -1,
              error: `No credentials found for ${cmd.targetHost} and failed to read default SSH key`,
              durationMs: 0,
            };
            await this.submitResult(cmd._id, result);
            return;
          }
        }

        result = await executeSSH({
          command: cmd.command,
          host: cmd.targetHost,
          port: cmd.targetPort ?? 22,
          username,
          privateKey,
          timeoutMs: cmd.timeoutMs,
        });
      }
    } else {
      result = {
        success: false,
        output: "",
        stderr: "",
        exitCode: -1,
        error: `Unknown target type: ${cmd.targetType}`,
        durationMs: 0,
      };
    }

    // Submit result
    await this.submitResult(cmd._id, result);

    logger.info(`Command ${cmd._id} completed`, {
      success: result.success,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  }

  /**
   * Claim a command for execution
   */
  private async claimCommand(commandId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.convexUrl}/relay/commands/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey,
        },
        body: JSON.stringify({ commandId }),
      });

      const result = await response.json() as { success: boolean };
      return result.success;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to claim command", { commandId, error });
      return false;
    }
  }

  /**
   * Submit command execution result
   */
  private async submitResult(commandId: string, result: ExecutionResult): Promise<void> {
    try {
      await fetch(`${this.config.convexUrl}/relay/commands/result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey,
        },
        body: JSON.stringify({
          commandId,
          success: result.success,
          output: result.output,
          stderr: result.stderr,
          exitCode: result.exitCode,
          error: result.error,
          durationMs: result.durationMs,
        }),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to submit result", { commandId, error });
    }
  }

  /**
   * Send heartbeat to Convex
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.running) return;

    try {
      await fetch(`${this.config.convexUrl}/relay/heartbeat`, {
        method: "POST",
        headers: {
          "X-API-Key": this.config.apiKey,
        },
      });
      logger.debug("Heartbeat sent");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to send heartbeat", { error });
    }
  }

  /**
   * Report full status to Convex (capabilities, metrics, credentials)
   */
  private async reportFullStatus(): Promise<void> {
    if (!this.running || !this.assignment) return;

    try {
      // Collect current metrics
      const metrics = await collectMetrics();

      // Get credential inventory
      const credentials = this.credentialManager.list();

      // Get capability info
      const capInfo = await detectCapabilities();

      const response = await fetch(`${this.config.convexUrl}/relay/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey,
        },
        body: JSON.stringify({
          relayId: this.assignment.assignmentId,
          capabilities: capInfo.capabilities,
          metrics,
          version: capInfo.version,
          hostname: capInfo.hostname,
          platform: capInfo.platform,
          credentials,
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as {
          success: boolean;
          pendingConfigPushes: number;
          sharedCredentialsCount: number;
        };

        logger.debug("Status reported", {
          pendingConfigPushes: result.pendingConfigPushes,
          sharedCredentialsCount: result.sharedCredentialsCount,
        });

        // If there are pending config pushes, sync them
        if (result.pendingConfigPushes > 0 && this.syncManager) {
          await this.syncManager.fullSync();
        }
      } else {
        logger.warn("Failed to report status", { status: response.status });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn("Error reporting status", { error });
    }
  }

  /**
   * Get credential for SSH target
   */
  private getCredentialForTarget(targetHost: string): { username: string; privateKey: string } | null {
    // First try to find credential by target host
    const cred = this.credentialManager.getForTarget(targetHost);
    if (cred && cred.type === "ssh_key") {
      // Parse the value which should contain username and key
      try {
        const parsed = JSON.parse(cred.value) as { username: string; privateKey: string };
        return parsed;
      } catch {
        // If not JSON, assume it's just the private key
        return { username: "root", privateKey: cred.value };
      }
    }
    return null;
  }
}
