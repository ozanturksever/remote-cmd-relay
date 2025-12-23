import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { api } from "../test-project/convex/_generated/api";
import { ConvexBackend } from "./lib/ConvexBackend";
import { execa } from "execa";
import { exportPKCS8, generateKeyPair } from "jose";
import { join } from "path";
import { existsSync } from "fs";

// Test configuration
const RELAY_DIR = join(process.cwd(), "packages/cli");
const DOCKER_IMAGE_NAME = "remote-cmd-relay-e2e-test";
const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 5000;

describe("e2e: remote-cmd-relay with Docker", () => {
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
    console.log("🐳 Building Docker image for relay...");
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

    console.log("--- E2E Relay Test Finished ---");
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
    convexUrl: string
  ): Promise<string> {
    const isLinux = process.platform === "linux";

    const containerName = `relay-test-${Date.now()}`;
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

    try {
      const result = await execa(
        "docker",
        ["ps", "-aq", "--filter", "name=relay-test-"],
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

  it("should execute a local command and return results", async () => {
    const user = await backend.client.mutation(
      api.testing.testing.authenticateTestUser,
      {
        email: "relay-test@example.com",
        name: "Relay Test User",
        role: "admin",
      }
    );

    const { keyId, rawKey } = await backend.client.mutation(
      api.testing.relay.createTestApiKey,
      {
        userId: user.userId,
        name: "E2E Test Relay Key",
      }
    );

    await backend.client.mutation(
      api.testing.relay.storeTestKeyMapping,
      { rawKey, keyId }
    );

    const machineId = "test-machine-001";
    const assignmentId = await backend.client.mutation(
      api.testing.relay.createTestRelayAssignment,
      {
        apiKeyId: keyId,
        machineId,
        name: "E2E Test Relay",
        createdBy: user.userId,
      }
    );

    expect(assignmentId).toBeDefined();

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

    if (!relayOnline) {
      const logs = await getContainerLogs();
      console.error("Container logs:", logs);
    }
    expect(relayOnline).toBe(true);

    const commandId = await backend.client.mutation(
      api.testing.relay.queueTestCommand,
      {
        machineId,
        command: "echo 'Hello from relay test'",
        targetType: "local",
        timeoutMs: 10000,
        createdBy: user.userId,
      }
    );

    expect(commandId).toBeDefined();

    const commandCompleted = await waitForCondition(
      async () => {
        const cmd = await backend.client.query(
          api.testing.relay.getTestCommand,
          { commandId }
        );
        return cmd?.status === "completed" || cmd?.status === "failed";
      },
      20000,
      500,
      "command to complete"
    );

    expect(commandCompleted).toBe(true);

    const command = await backend.client.query(
      api.testing.relay.getTestCommand,
      { commandId }
    );

    expect(command).not.toBeNull();
    expect(command?.status).toBe("completed");
    expect(command?.exitCode).toBe(0);
    expect(command?.output).toContain("Hello from relay test");
  }, 60000);

  it("should handle command failures gracefully", async () => {
    const user = await backend.client.mutation(
      api.testing.testing.authenticateTestUser,
      {
        email: "relay-test2@example.com",
        name: "Relay Test User 2",
        role: "admin",
      }
    );

    const { keyId, rawKey } = await backend.client.mutation(
      api.testing.relay.createTestApiKey,
      {
        userId: user.userId,
        name: "E2E Test Relay Key 2",
      }
    );

    await backend.client.mutation(
      api.testing.relay.storeTestKeyMapping,
      { rawKey, keyId }
    );

    const machineId = "test-machine-002";
    const assignmentId = await backend.client.mutation(
      api.testing.relay.createTestRelayAssignment,
      {
        apiKeyId: keyId,
        machineId,
        name: "E2E Test Relay 2",
        createdBy: user.userId,
      }
    );

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

    const commandId = await backend.client.mutation(
      api.testing.relay.queueTestCommand,
      {
        machineId,
        command: "exit 42",
        targetType: "local",
        timeoutMs: 10000,
        createdBy: user.userId,
      }
    );

    const commandCompleted = await waitForCondition(
      async () => {
        const cmd = await backend.client.query(
          api.testing.relay.getTestCommand,
          { commandId }
        );
        return cmd?.status === "completed" || cmd?.status === "failed";
      },
      20000,
      500,
      "command to complete"
    );

    expect(commandCompleted).toBe(true);

    const command = await backend.client.query(
      api.testing.relay.getTestCommand,
      { commandId }
    );

    expect(command).not.toBeNull();
    expect(command?.status).toBe("failed");
    expect(command?.exitCode).toBe(42);
  }, 60000);

  it("should report relay status with capabilities and metrics", async () => {
    const user = await backend.client.mutation(
      api.testing.testing.authenticateTestUser,
      {
        email: "relay-status-test@example.com",
        name: "Relay Status Test User",
        role: "admin",
      }
    );

    const { keyId, rawKey } = await backend.client.mutation(
      api.testing.relay.createTestApiKey,
      {
        userId: user.userId,
        name: "E2E Test Relay Status Key",
      }
    );

    await backend.client.mutation(
      api.testing.relay.storeTestKeyMapping,
      { rawKey, keyId }
    );

    const machineId = "test-machine-status-001";
    const assignmentId = await backend.client.mutation(
      api.testing.relay.createTestRelayAssignment,
      {
        apiKeyId: keyId,
        machineId,
        name: "E2E Test Relay Status",
        createdBy: user.userId,
      }
    );

    const statusUrl = `http://localhost:${backend.siteProxyPort}/relay/status`;
    const statusResponse = await fetch(statusUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": rawKey,
      },
      body: JSON.stringify({
        relayId: assignmentId,
        capabilities: ["local_cmd", "perf_metrics"],
        metrics: {
          cpuPercent: 45.5,
          memoryPercent: 62.3,
          memoryUsedMb: 4096,
          memoryTotalMb: 8192,
          diskPercent: 55.0,
        },
        version: "1.0.0-test",
        hostname: "test-host",
        platform: "linux",
        credentials: [
          {
            credentialName: "test-ssh-key",
            credentialType: "ssh_key",
            targetHost: "server1.example.com",
            storageMode: "relay_only",
            lastUpdatedAt: Date.now(),
          },
        ],
      }),
    });

    expect(statusResponse.ok).toBe(true);
    const statusResult = await statusResponse.json();
    expect(statusResult.success).toBe(true);

    const relayStatus = await backend.client.query(
      api.testing.relay.getTestRelayStatus,
      { relayId: assignmentId }
    );

    expect(relayStatus).not.toBeNull();
    expect(relayStatus?.capabilities).toContain("local_cmd");
    expect(relayStatus?.capabilities).toContain("perf_metrics");
    expect(relayStatus?.version).toBe("1.0.0-test");
    expect(relayStatus?.hostname).toBe("test-host");
    expect(relayStatus?.metrics?.cpuPercent).toBe(45.5);

    const credInventory = await backend.client.query(
      api.testing.relay.listTestCredentialInventory,
      { relayId: assignmentId }
    );

    expect(credInventory.length).toBe(1);
    expect(credInventory[0].credentialName).toBe("test-ssh-key");
    expect(credInventory[0].credentialType).toBe("ssh_key");
  }, 30000);

  it("should reject requests with invalid API key", async () => {
    const verifyUrl = `http://localhost:${backend.siteProxyPort}/relay/verify`;
    const verifyResponse = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "test_invalid_key_12345",
      }),
    });

    expect(verifyResponse.status).toBe(401);
    const result = await verifyResponse.json();
    expect(result.error).toBeDefined();
  }, 10000);

  it("should reject requests without API key header", async () => {
    const commandsUrl = `http://localhost:${backend.siteProxyPort}/relay/commands`;
    const commandsResponse = await fetch(commandsUrl, {
      method: "GET",
    });

    expect(commandsResponse.status).toBe(401);
    const result = await commandsResponse.json();
    expect(result.error).toBe("API key is required");
  }, 10000);

  it("should handle heartbeat via HTTP", async () => {
    const user = await backend.client.mutation(
      api.testing.testing.authenticateTestUser,
      {
        email: "relay-heartbeat-test@example.com",
        name: "Relay Heartbeat Test User",
        role: "admin",
      }
    );

    const { keyId, rawKey } = await backend.client.mutation(
      api.testing.relay.createTestApiKey,
      {
        userId: user.userId,
        name: "E2E Test Relay Heartbeat Key",
      }
    );

    await backend.client.mutation(
      api.testing.relay.storeTestKeyMapping,
      { rawKey, keyId }
    );

    const machineId = "test-machine-heartbeat-001";
    const assignmentId = await backend.client.mutation(
      api.testing.relay.createTestRelayAssignment,
      {
        apiKeyId: keyId,
        machineId,
        name: "E2E Test Relay Heartbeat",
        createdBy: user.userId,
      }
    );

    const initiallyOnline = await backend.client.query(
      api.testing.relay.checkRelayOnline,
      { assignmentId }
    );
    expect(initiallyOnline).toBe(false);

    const heartbeatUrl = `http://localhost:${backend.siteProxyPort}/relay/heartbeat`;
    const heartbeatResponse = await fetch(heartbeatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": rawKey,
      },
    });

    expect(heartbeatResponse.ok).toBe(true);
    const heartbeatResult = await heartbeatResponse.json();
    expect(heartbeatResult.success).toBe(true);

    const nowOnline = await backend.client.query(
      api.testing.relay.checkRelayOnline,
      { assignmentId }
    );
    expect(nowOnline).toBe(true);
  }, 30000);
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
