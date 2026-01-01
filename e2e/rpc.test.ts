import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { api } from "../test-project/convex/_generated/api";
import { ConvexBackend } from "./lib/ConvexBackend";
import { execa } from "execa";
import { exportPKCS8, generateKeyPair } from "jose";
import { join } from "path";
import { existsSync } from "fs";

// Test configuration
const RELAY_DIR = join(process.cwd(), "packages/cli");
const DOCKER_IMAGE_NAME = "remote-cmd-relay-rpc-e2e-test";
const POLL_INTERVAL_MS = 1000; // Minimum allowed poll interval
const HEARTBEAT_INTERVAL_MS = 5000;

describe("e2e: RPC and Subscription Mode", () => {
  let backend: ConvexBackend;
  let dockerContainerId: string | null = null;

  beforeAll(async () => {
    // Initialize Convex backend
    backend = new ConvexBackend({
      projectDir: join(process.cwd(), "test-project"),
      stdio: "ignore",
    });

    await backend.init();

    // Generate and set auth keys for Better Auth
    const authKeys = await generateTestKeys();
    await backend.setEnv("BETTER_AUTH_SECRET", authKeys.BETTER_AUTH_SECRET);

    // Build Docker image for relay
    console.log("🐳 Building Docker image for RPC relay tests...");
    await buildDockerImage();
    console.log("✅ Docker image built successfully");
  }, 180000);

  afterAll(async () => {
    await stopDockerContainer();
    await backend.stop();

    // Clean up Docker image
    try {
      await execa("docker", ["rmi", "-f", DOCKER_IMAGE_NAME]);
    } catch {
      // Ignore errors during cleanup
    }

    console.log("--- E2E RPC Test Finished ---");
  });

  beforeEach(async () => {
    await stopDockerContainer();
    await backend.client.mutation(api.testing.testing.clearAll);
  });

  async function buildDockerImage(): Promise<void> {
    const dockerfilePath = join(RELAY_DIR, "Dockerfile");
    if (!existsSync(dockerfilePath)) {
      throw new Error(`Dockerfile not found at ${dockerfilePath}`);
    }

    const result = await execa(
      "docker",
      ["build", "-t", DOCKER_IMAGE_NAME, "."],
      {
        cwd: RELAY_DIR,
        stdio: "pipe",
      }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Docker build failed: ${result.stderr}`);
    }
  }

  async function startDockerContainer(
    apiKey: string,
    convexUrl: string,
    options: { subscriptionMode?: boolean } = {}
  ): Promise<string> {
    const isLinux = process.platform === "linux";

    const containerName = `relay-rpc-test-${Date.now()}`;
    const args = [
      "run",
      "-d",
      "--name",
      containerName,
    ];

    if (isLinux) {
      args.push("--add-host=host.docker.internal:host-gateway");
    }

    args.push(
      DOCKER_IMAGE_NAME,
      apiKey,
      convexUrl,
      "--poll-interval",
      String(POLL_INTERVAL_MS),
      "--heartbeat-interval",
      String(HEARTBEAT_INTERVAL_MS),
      "--log-level",
      "debug"
    );

    // Add subscription mode if requested
    if (options.subscriptionMode) {
      // For subscription mode, we need to pass the deployment URL
      // In e2e tests, this is the same as the backend URL
      const deploymentUrl = `http://host.docker.internal:${backend.port}`;
      args.push("--deployment-url", deploymentUrl);
    }

    const result = await execa("docker", args, { stdio: "pipe" });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to start Docker container: ${result.stderr}`);
    }

    dockerContainerId = result.stdout.trim();
    
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    const inspectResult = await execa("docker", ["inspect", "-f", "{{.State.Running}}", dockerContainerId], { stdio: "pipe" }).catch(() => ({ stdout: "false" }));
    
    if (inspectResult.stdout.trim() !== "true") {
      const logs = await getContainerLogs();
      console.error("Container exited early. Logs:", logs);
    }
    
    return dockerContainerId;
  }

  async function stopDockerContainer(): Promise<void> {
    if (dockerContainerId) {
      try {
        await execa("docker", ["stop", dockerContainerId], {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch {
        // Container might already be stopped
      }
      try {
        await execa("docker", ["rm", "-f", dockerContainerId], {
          stdio: "pipe",
        });
      } catch {
        // Ignore
      }
      dockerContainerId = null;
    }

    // Clean up any stale containers
    try {
      const result = await execa(
        "docker",
        ["ps", "-aq", "--filter", "name=relay-rpc-test-"],
        { stdio: "pipe" }
      );
      const containerIds = result.stdout.trim().split("\n").filter(Boolean);
      for (const id of containerIds) {
        await execa("docker", ["rm", "-f", id], { stdio: "pipe" }).catch(() => {});
      }
    } catch {
      // Ignore errors
    }
  }

  async function getContainerLogs(): Promise<string> {
    if (!dockerContainerId) return "";
    try {
      const result = await execa("docker", ["logs", dockerContainerId], {
        stdio: "pipe",
      });
      return result.stdout + result.stderr;
    } catch {
      return "";
    }
  }

  async function waitForCondition(
    checkFn: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs: number = 500,
    description: string = "condition"
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await checkFn()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    console.warn(`Timeout waiting for ${description}`);
    return false;
  }

  async function setupRelayWithKey(): Promise<{
    user: { userId: string };
    keyId: string;
    rawKey: string;
    machineId: string;
    assignmentId: string;
  }> {
    const user = await backend.client.mutation(
      api.testing.testing.authenticateTestUser,
      {
        email: `relay-rpc-test-${Date.now()}@example.com`,
        name: "RPC Test User",
        role: "admin",
      }
    );

    const { keyId, rawKey } = await backend.client.mutation(
      api.testing.relay.createTestApiKey,
      {
        userId: user.userId,
        name: "E2E RPC Test Relay Key",
      }
    );

    await backend.client.mutation(
      api.testing.relay.storeTestKeyMapping,
      { rawKey, keyId }
    );

    const machineId = `rpc-test-machine-${Date.now()}`;
    const assignmentId = await backend.client.mutation(
      api.testing.relay.createTestRelayAssignment,
      {
        apiKeyId: keyId,
        machineId,
        name: "E2E RPC Test Relay",
        createdBy: user.userId,
      }
    );

    return { user, keyId, rawKey, machineId, assignmentId };
  }

  describe("RPC queueRpcCommand and getCommandResult", () => {
    it("should queue a command via RPC and get result after relay processes it", async () => {
      const { user, rawKey, machineId, assignmentId } = await setupRelayWithKey();

      // Start relay in polling mode
      const convexUrl = `http://host.docker.internal:${backend.siteProxyPort}`;
      await startDockerContainer(rawKey, convexUrl);

      // Wait for relay to come online
      const relayOnline = await waitForCondition(
        async () => {
          const isOnline = await backend.client.query(
            api.testing.relay.checkRelayOnline,
            { assignmentId }
          );
          return isOnline;
        },
        30000,
        1000,
        "relay to come online"
      );

      if (!relayOnline) {
        const logs = await getContainerLogs();
        console.error("Container logs:", logs);
      }
      expect(relayOnline).toBe(true);

      // Queue command via RPC interface
      const queueResult = await backend.client.mutation(
        api.testing.relay.queueRpcCommand,
        {
          machineId,
          command: "echo 'RPC test successful'",
          targetType: "local",
          timeoutMs: 10000,
          createdBy: user.userId,
        }
      );

      expect(queueResult.success).toBe(true);
      expect(queueResult.commandId).toBeDefined();
      const commandId = queueResult.commandId!;

      // Poll for result using getCommandResult
      const commandCompleted = await waitForCondition(
        async () => {
          const result = await backend.client.query(
            api.testing.relay.getCommandResult,
            { commandId }
          );
          return result.found && (result.status === "completed" || result.status === "failed");
        },
        20000,
        500,
        "RPC command to complete"
      );

      expect(commandCompleted).toBe(true);

      // Get final result
      const result = await backend.client.query(
        api.testing.relay.getCommandResult,
        { commandId }
      );

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("completed");
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("RPC test successful");
      }
    }, 60000);

    it("should handle RPC command failure correctly", async () => {
      const { user, rawKey, machineId, assignmentId } = await setupRelayWithKey();

      const convexUrl = `http://host.docker.internal:${backend.siteProxyPort}`;
      await startDockerContainer(rawKey, convexUrl);

      const relayOnline = await waitForCondition(
        async () => {
          const isOnline = await backend.client.query(
            api.testing.relay.checkRelayOnline,
            { assignmentId }
          );
          return isOnline;
        },
        30000,
        1000,
        "relay to come online"
      );

      expect(relayOnline).toBe(true);

      // Queue a command that will fail
      const queueResult = await backend.client.mutation(
        api.testing.relay.queueRpcCommand,
        {
          machineId,
          command: "exit 123",
          targetType: "local",
          timeoutMs: 10000,
          createdBy: user.userId,
        }
      );

      expect(queueResult.success).toBe(true);
      const commandId = queueResult.commandId!;

      // Wait for completion
      const commandCompleted = await waitForCondition(
        async () => {
          const result = await backend.client.query(
            api.testing.relay.getCommandResult,
            { commandId }
          );
          return result.found && (result.status === "completed" || result.status === "failed");
        },
        20000,
        500,
        "RPC command to complete"
      );

      expect(commandCompleted).toBe(true);

      const result = await backend.client.query(
        api.testing.relay.getCommandResult,
        { commandId }
      );

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("failed");
        expect(result.exitCode).toBe(123);
      }
    }, 60000);

    it("should reject SSH command without required fields", async () => {
      const { user, machineId } = await setupRelayWithKey();

      // Try to queue SSH command without targetHost
      const queueResult = await backend.client.mutation(
        api.testing.relay.queueRpcCommand,
        {
          machineId,
          command: "uptime",
          targetType: "ssh",
          targetUsername: "admin",
          // Missing targetHost
          createdBy: user.userId,
        }
      );

      expect(queueResult.success).toBe(false);
      expect(queueResult.error).toBe("SSH target requires targetHost and targetUsername");
    }, 10000);
  });

  describe("exec helper via action", () => {
    it("should execute command synchronously via exec helper action", async () => {
      const { user, rawKey, machineId, assignmentId } = await setupRelayWithKey();

      const convexUrl = `http://host.docker.internal:${backend.siteProxyPort}`;
      await startDockerContainer(rawKey, convexUrl);

      const relayOnline = await waitForCondition(
        async () => {
          const isOnline = await backend.client.query(
            api.testing.relay.checkRelayOnline,
            { assignmentId }
          );
          return isOnline;
        },
        30000,
        1000,
        "relay to come online"
      );

      expect(relayOnline).toBe(true);

      // Call the exec helper action
      const result = await backend.client.action(
        api.testing.relay.execCommandAction,
        {
          machineId,
          command: "echo 'exec helper test' && date",
          targetType: "local",
          timeoutMs: 15000,
          createdBy: user.userId,
        }
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("exec helper test");
      expect(result.exitCode).toBe(0);
      expect(result.attempts).toBe(1);
    }, 60000);

    it("should return failure result from exec helper for failed command", async () => {
      const { user, rawKey, machineId, assignmentId } = await setupRelayWithKey();

      const convexUrl = `http://host.docker.internal:${backend.siteProxyPort}`;
      await startDockerContainer(rawKey, convexUrl);

      const relayOnline = await waitForCondition(
        async () => {
          const isOnline = await backend.client.query(
            api.testing.relay.checkRelayOnline,
            { assignmentId }
          );
          return isOnline;
        },
        30000,
        1000,
        "relay to come online"
      );

      expect(relayOnline).toBe(true);

      // Call exec helper with a command that will fail
      const result = await backend.client.action(
        api.testing.relay.execCommandAction,
        {
          machineId,
          command: "exit 42",
          targetType: "local",
          timeoutMs: 15000,
          createdBy: user.userId,
        }
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(42);
    }, 60000);

    it("should handle exec helper timeout when no relay is running", async () => {
      const { user, machineId } = await setupRelayWithKey();
      // Don't start the relay - command should timeout

      // Call exec helper with short timeout
      const result = await backend.client.action(
        api.testing.relay.execCommandAction,
        {
          machineId,
          command: "echo hello",
          targetType: "local",
          timeoutMs: 3000, // Short timeout
          createdBy: user.userId,
        }
      );

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.error).toContain("RPC timeout");
    }, 15000);
  });

  describe("execAsync helper", () => {
    it("should queue command and return immediately with commandId", async () => {
      const { user, rawKey, machineId, assignmentId } = await setupRelayWithKey();

      const convexUrl = `http://host.docker.internal:${backend.siteProxyPort}`;
      await startDockerContainer(rawKey, convexUrl);

      const relayOnline = await waitForCondition(
        async () => {
          const isOnline = await backend.client.query(
            api.testing.relay.checkRelayOnline,
            { assignmentId }
          );
          return isOnline;
        },
        30000,
        1000,
        "relay to come online"
      );

      expect(relayOnline).toBe(true);

      // Call execAsync action
      const asyncResult = await backend.client.action(
        api.testing.relay.execAsyncAction,
        {
          machineId,
          command: "sleep 1 && echo 'async test'",
          targetType: "local",
          timeoutMs: 15000,
          createdBy: user.userId,
        }
      );

      expect(asyncResult.success).toBe(true);
      expect(asyncResult.commandId).toBeDefined();

      // Now poll for the result separately
      const commandCompleted = await waitForCondition(
        async () => {
          const result = await backend.client.query(
            api.testing.relay.getCommandResult,
            { commandId: asyncResult.commandId! }
          );
          return result.found && (result.status === "completed" || result.status === "failed");
        },
        20000,
        500,
        "async command to complete"
      );

      expect(commandCompleted).toBe(true);

      const result = await backend.client.query(
        api.testing.relay.getCommandResult,
        { commandId: asyncResult.commandId! }
      );

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("completed");
        expect(result.output).toContain("async test");
      }
    }, 60000);
  });

  describe("Multiple concurrent commands", () => {
    it("should handle multiple RPC commands in parallel", async () => {
      const { user, rawKey, machineId, assignmentId } = await setupRelayWithKey();

      const convexUrl = `http://host.docker.internal:${backend.siteProxyPort}`;
      await startDockerContainer(rawKey, convexUrl);

      const relayOnline = await waitForCondition(
        async () => {
          const isOnline = await backend.client.query(
            api.testing.relay.checkRelayOnline,
            { assignmentId }
          );
          return isOnline;
        },
        30000,
        1000,
        "relay to come online"
      );

      expect(relayOnline).toBe(true);

      // Queue multiple commands in parallel
      const commands = [
        { cmd: "echo 'command-1'", expected: "command-1" },
        { cmd: "echo 'command-2'", expected: "command-2" },
        { cmd: "echo 'command-3'", expected: "command-3" },
      ];

      const queueResults = await Promise.all(
        commands.map((c) =>
          backend.client.mutation(api.testing.relay.queueRpcCommand, {
            machineId,
            command: c.cmd,
            targetType: "local",
            timeoutMs: 10000,
            createdBy: user.userId,
          })
        )
      );

      // All should queue successfully
      for (const result of queueResults) {
        expect(result.success).toBe(true);
        expect(result.commandId).toBeDefined();
      }

      // Wait for all to complete
      const allCompleted = await waitForCondition(
        async () => {
          const results = await Promise.all(
            queueResults.map((qr) =>
              backend.client.query(api.testing.relay.getCommandResult, {
                commandId: qr.commandId!,
              })
            )
          );
          return results.every(
            (r) => r.found && (r.status === "completed" || r.status === "failed")
          );
        },
        30000,
        500,
        "all commands to complete"
      );

      expect(allCompleted).toBe(true);

      // Verify each command result
      for (let i = 0; i < commands.length; i++) {
        const result = await backend.client.query(
          api.testing.relay.getCommandResult,
          { commandId: queueResults[i].commandId! }
        );

        expect(result.found).toBe(true);
        if (result.found) {
          expect(result.status).toBe("completed");
          expect(result.output).toContain(commands[i].expected);
        }
      }
    }, 90000);
  });
});

async function generateTestKeys(): Promise<{
  BETTER_AUTH_SECRET: string;
}> {
  const keys = await generateKeyPair("RS256", {
    extractable: true,
  });
  const privateKey = await exportPKCS8(keys.privateKey);
  const secret = privateKey.slice(0, 64).replace(/[\n\r]/g, "");

  return {
    BETTER_AUTH_SECRET: secret,
  };
}
