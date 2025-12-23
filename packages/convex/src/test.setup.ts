import { convexTest } from "convex-test";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Import modules for convex-test
const modules: Record<string, () => Promise<unknown>> = import.meta.glob(
  "./**/*.ts"
);

/**
 * Create a test Convex instance for remoteCmdRelay component.
 */
export function createRelayTestConvex() {
  return convexTest(schema, modules);
}

export type RelayTestConvex = ReturnType<typeof createRelayTestConvex>;

// ===== Test Data Helpers =====

export interface CreateRelayAssignmentOptions {
  apiKeyId?: string;
  machineId?: string;
  name?: string;
  enabled?: boolean;
  createdBy?: string;
}

/**
 * Create a relay assignment in the test database
 */
export async function createTestRelayAssignment(
  t: RelayTestConvex,
  options: CreateRelayAssignmentOptions = {}
): Promise<{
  _id: Id<"relayAssignments">;
  apiKeyId: string;
  machineId: string;
  name: string;
  enabled: boolean;
  createdBy: string;
}> {
  const now = Date.now();
  const apiKeyId = options.apiKeyId ?? `test-api-key-${now}`;
  const machineId = options.machineId ?? `test-machine-${now}`;
  const name = options.name ?? "Test Relay";
  const enabled = options.enabled ?? true;
  const createdBy = options.createdBy ?? "test-user";

  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("relayAssignments", {
      apiKeyId,
      machineId,
      name,
      enabled,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    _id: id,
    apiKeyId,
    machineId,
    name,
    enabled,
    createdBy,
  };
}

export interface CreateCommandOptions {
  machineId: string;
  command?: string;
  targetType?: "local" | "ssh";
  targetHost?: string;
  targetPort?: number;
  targetUsername?: string;
  timeoutMs?: number;
  status?: "pending" | "claimed" | "executing" | "completed" | "failed" | "timeout";
  createdBy?: string;
}

/**
 * Create a command in the test database
 */
export async function createTestCommand(
  t: RelayTestConvex,
  options: CreateCommandOptions
): Promise<{
  _id: Id<"commandQueue">;
  machineId: string;
  command: string;
  targetType: "local" | "ssh";
  status: "pending" | "claimed" | "executing" | "completed" | "failed" | "timeout";
}> {
  const now = Date.now();
  const command = options.command ?? "echo test";
  const targetType = options.targetType ?? "local";
  const status = options.status ?? "pending";
  const createdBy = options.createdBy ?? "test-user";

  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("commandQueue", {
      machineId: options.machineId,
      command,
      targetType,
      targetHost: options.targetHost,
      targetPort: options.targetPort ?? 22,
      targetUsername: options.targetUsername,
      timeoutMs: options.timeoutMs ?? 30000,
      status,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    _id: id,
    machineId: options.machineId,
    command,
    targetType,
    status,
  };
}

export interface CreateRelayStatusOptions {
  relayId: string;
  capabilities?: ("ssh" | "local_cmd" | "perf_metrics")[];
  metrics?: {
    cpuPercent?: number;
    memoryPercent?: number;
    memoryUsedMb?: number;
    memoryTotalMb?: number;
  };
  version?: string;
  hostname?: string;
  platform?: string;
}

/**
 * Create a relay status record in the test database
 */
export async function createTestRelayStatus(
  t: RelayTestConvex,
  options: CreateRelayStatusOptions
): Promise<Id<"relayStatus">> {
  const now = Date.now();
  const capabilities = options.capabilities ?? ["local_cmd"];

  return await t.run(async (ctx) => {
    return await ctx.db.insert("relayStatus", {
      relayId: options.relayId,
      capabilities,
      metrics: options.metrics,
      version: options.version ?? "1.0.0",
      hostname: options.hostname ?? "test-host",
      platform: options.platform ?? "linux-x64",
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export interface CreateCredentialInventoryOptions {
  relayId: string;
  credentialName?: string;
  credentialType?: "ssh_key" | "password" | "api_key";
  targetHost?: string;
  storageMode?: "relay_only" | "shared";
}

/**
 * Create a credential inventory record in the test database
 */
export async function createTestCredentialInventory(
  t: RelayTestConvex,
  options: CreateCredentialInventoryOptions
): Promise<Id<"relayCredentialInventory">> {
  const now = Date.now();

  return await t.run(async (ctx) => {
    return await ctx.db.insert("relayCredentialInventory", {
      relayId: options.relayId,
      credentialName: options.credentialName ?? `cred-${now}`,
      credentialType: options.credentialType ?? "ssh_key",
      targetHost: options.targetHost,
      storageMode: options.storageMode ?? "relay_only",
      lastUpdatedAt: now,
      reportedAt: now,
    });
  });
}

export interface CreateSharedCredentialOptions {
  name?: string;
  credentialType?: "ssh_key" | "password" | "api_key";
  targetHost?: string;
  encryptedValue?: string;
  assignedRelays?: string[];
  createdBy?: string;
}

/**
 * Create a shared credential in the test database
 */
export async function createTestSharedCredential(
  t: RelayTestConvex,
  options: CreateSharedCredentialOptions = {}
): Promise<Id<"sharedCredentials">> {
  const now = Date.now();

  return await t.run(async (ctx) => {
    return await ctx.db.insert("sharedCredentials", {
      name: options.name ?? `shared-cred-${now}`,
      credentialType: options.credentialType ?? "ssh_key",
      targetHost: options.targetHost,
      encryptedValue: options.encryptedValue ?? "encrypted-value",
      assignedRelays: options.assignedRelays ?? [],
      createdBy: options.createdBy ?? "test-user",
      createdAt: now,
      updatedAt: now,
    });
  });
}

export interface CreateConfigPushOptions {
  relayId: string;
  pushType?: "credential" | "ssh_targets" | "allowed_commands" | "metrics_interval";
  payload?: string;
  status?: "pending" | "sent" | "acked" | "failed";
  createdBy?: string;
}

/**
 * Create a config push in the test database
 */
export async function createTestConfigPush(
  t: RelayTestConvex,
  options: CreateConfigPushOptions
): Promise<Id<"configPushQueue">> {
  const now = Date.now();

  return await t.run(async (ctx) => {
    return await ctx.db.insert("configPushQueue", {
      relayId: options.relayId,
      pushType: options.pushType ?? "credential",
      payload: options.payload ?? JSON.stringify({ test: true }),
      status: options.status ?? "pending",
      createdBy: options.createdBy ?? "test-user",
      createdAt: now,
    });
  });
}
