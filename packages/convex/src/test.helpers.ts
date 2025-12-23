import { convexTest } from "convex-test";
import type { Id } from "./_generated/dataModel";

// Types for mock data
export type CommandStatus =
  | "pending"
  | "claimed"
  | "executing"
  | "completed"
  | "failed"
  | "timeout";
export type TargetType = "local" | "ssh";
export type Capability = "ssh" | "local_cmd" | "perf_metrics";
export type CredentialType = "ssh_key" | "password" | "api_key";
export type StorageMode = "relay_only" | "shared";
export type ConfigPushType =
  | "credential"
  | "ssh_targets"
  | "allowed_commands"
  | "metrics_interval";
export type ConfigPushStatus = "pending" | "sent" | "acked" | "failed";

// Mock relay assignment data structure
export interface MockRelayAssignment {
  _id: Id<"relayAssignments">;
  apiKeyId: string;
  machineId: string;
  name: string;
  enabled: boolean;
  lastSeenAt?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// Options for creating a mock relay assignment
export interface CreateMockRelayAssignmentOptions {
  apiKeyId?: string;
  machineId?: string;
  name?: string;
  enabled?: boolean;
  createdBy?: string;
}

/**
 * Create a mock relay assignment in the test database.
 */
export async function createMockRelayAssignment(
  t: ReturnType<typeof convexTest>,
  options: CreateMockRelayAssignmentOptions = {}
): Promise<MockRelayAssignment> {
  const now = Date.now();
  const apiKeyId = options.apiKeyId ?? `api-key-${now}`;
  const machineId = options.machineId ?? `machine-${now}`;
  const name = options.name ?? "Test Relay";
  const enabled = options.enabled ?? true;
  const createdBy = options.createdBy ?? "test-user";

  const assignmentId = await t.run(async (ctx) => {
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
    _id: assignmentId as Id<"relayAssignments">,
    apiKeyId,
    machineId,
    name,
    enabled,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

// Mock command data structure
export interface MockCommand {
  _id: Id<"commandQueue">;
  machineId: string;
  command: string;
  targetType: TargetType;
  targetHost?: string;
  targetPort?: number;
  targetUsername?: string;
  timeoutMs: number;
  status: CommandStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// Options for creating a mock command
export interface CreateMockCommandOptions {
  machineId?: string;
  command?: string;
  targetType?: TargetType;
  targetHost?: string;
  targetPort?: number;
  targetUsername?: string;
  timeoutMs?: number;
  status?: CommandStatus;
  createdBy?: string;
  claimedBy?: string;
  claimedAt?: number;
}

/**
 * Create a mock command in the test database.
 */
export async function createMockCommand(
  t: ReturnType<typeof convexTest>,
  options: CreateMockCommandOptions = {}
): Promise<MockCommand> {
  const now = Date.now();
  const machineId = options.machineId ?? `machine-${now}`;
  const command = options.command ?? "echo hello";
  const targetType = options.targetType ?? "local";
  const timeoutMs = options.timeoutMs ?? 30000;
  const status = options.status ?? "pending";
  const createdBy = options.createdBy ?? "test-user";

  const commandId = await t.run(async (ctx) => {
    return await ctx.db.insert("commandQueue", {
      machineId,
      command,
      targetType,
      targetHost: options.targetHost,
      targetPort: options.targetPort ?? (targetType === "ssh" ? 22 : undefined),
      targetUsername: options.targetUsername,
      timeoutMs,
      status,
      claimedBy: options.claimedBy,
      claimedAt: options.claimedAt,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    _id: commandId as Id<"commandQueue">,
    machineId,
    command,
    targetType,
    targetHost: options.targetHost,
    targetPort: options.targetPort,
    targetUsername: options.targetUsername,
    timeoutMs,
    status,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

// Mock config push data structure
export interface MockConfigPush {
  _id: Id<"configPushQueue">;
  relayId: string;
  pushType: ConfigPushType;
  payload: string;
  status: ConfigPushStatus;
  createdBy: string;
  createdAt: number;
}

// Options for creating a mock config push
export interface CreateMockConfigPushOptions {
  relayId?: string;
  pushType?: ConfigPushType;
  payload?: string;
  status?: ConfigPushStatus;
  createdBy?: string;
}

/**
 * Create a mock config push in the test database.
 */
export async function createMockConfigPush(
  t: ReturnType<typeof convexTest>,
  options: CreateMockConfigPushOptions = {}
): Promise<MockConfigPush> {
  const now = Date.now();
  const relayId = options.relayId ?? `relay-${now}`;
  const pushType = options.pushType ?? "credential";
  const payload = options.payload ?? JSON.stringify({ test: "data" });
  const status = options.status ?? "pending";
  const createdBy = options.createdBy ?? "test-user";

  const pushId = await t.run(async (ctx) => {
    return await ctx.db.insert("configPushQueue", {
      relayId,
      pushType,
      payload,
      status,
      createdBy,
      createdAt: now,
    });
  });

  return {
    _id: pushId as Id<"configPushQueue">,
    relayId,
    pushType,
    payload,
    status,
    createdBy,
    createdAt: now,
  };
}

// Mock relay status data structure
export interface MockRelayStatus {
  _id: Id<"relayStatus">;
  relayId: string;
  capabilities: Capability[];
  version?: string;
  hostname?: string;
  platform?: string;
  lastHeartbeatAt: number;
  createdAt: number;
  updatedAt: number;
}

// Options for creating a mock relay status
export interface CreateMockRelayStatusOptions {
  relayId?: string;
  capabilities?: Capability[];
  version?: string;
  hostname?: string;
  platform?: string;
  lastHeartbeatAt?: number;
}

/**
 * Create a mock relay status in the test database.
 */
export async function createMockRelayStatus(
  t: ReturnType<typeof convexTest>,
  options: CreateMockRelayStatusOptions = {}
): Promise<MockRelayStatus> {
  const now = Date.now();
  const relayId = options.relayId ?? `relay-${now}`;
  const capabilities = options.capabilities ?? ["local_cmd"];
  const lastHeartbeatAt = options.lastHeartbeatAt ?? now;

  const statusId = await t.run(async (ctx) => {
    return await ctx.db.insert("relayStatus", {
      relayId,
      capabilities,
      version: options.version,
      hostname: options.hostname,
      platform: options.platform,
      lastHeartbeatAt,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    _id: statusId as Id<"relayStatus">,
    relayId,
    capabilities,
    version: options.version,
    hostname: options.hostname,
    platform: options.platform,
    lastHeartbeatAt,
    createdAt: now,
    updatedAt: now,
  };
}

// Mock credential inventory data structure
export interface MockCredentialInventory {
  _id: Id<"relayCredentialInventory">;
  relayId: string;
  credentialName: string;
  credentialType: CredentialType;
  targetHost?: string;
  storageMode: StorageMode;
  lastUpdatedAt: number;
  reportedAt: number;
}

// Options for creating a mock credential inventory
export interface CreateMockCredentialInventoryOptions {
  relayId?: string;
  credentialName?: string;
  credentialType?: CredentialType;
  targetHost?: string;
  storageMode?: StorageMode;
}

/**
 * Create a mock credential inventory entry in the test database.
 */
export async function createMockCredentialInventory(
  t: ReturnType<typeof convexTest>,
  options: CreateMockCredentialInventoryOptions = {}
): Promise<MockCredentialInventory> {
  const now = Date.now();
  const relayId = options.relayId ?? `relay-${now}`;
  const credentialName = options.credentialName ?? `cred-${now}`;
  const credentialType = options.credentialType ?? "ssh_key";
  const storageMode = options.storageMode ?? "relay_only";

  const credId = await t.run(async (ctx) => {
    return await ctx.db.insert("relayCredentialInventory", {
      relayId,
      credentialName,
      credentialType,
      targetHost: options.targetHost,
      storageMode,
      lastUpdatedAt: now,
      reportedAt: now,
    });
  });

  return {
    _id: credId as Id<"relayCredentialInventory">,
    relayId,
    credentialName,
    credentialType,
    targetHost: options.targetHost,
    storageMode,
    lastUpdatedAt: now,
    reportedAt: now,
  };
}

// Mock shared credential data structure
export interface MockSharedCredential {
  _id: Id<"sharedCredentials">;
  name: string;
  credentialType: CredentialType;
  targetHost?: string;
  encryptedValue: string;
  assignedRelays: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// Options for creating a mock shared credential
export interface CreateMockSharedCredentialOptions {
  name?: string;
  credentialType?: CredentialType;
  targetHost?: string;
  encryptedValue?: string;
  assignedRelays?: string[];
  createdBy?: string;
}

/**
 * Create a mock shared credential in the test database.
 */
export async function createMockSharedCredential(
  t: ReturnType<typeof convexTest>,
  options: CreateMockSharedCredentialOptions = {}
): Promise<MockSharedCredential> {
  const now = Date.now();
  const name = options.name ?? `shared-cred-${now}`;
  const credentialType = options.credentialType ?? "ssh_key";
  const encryptedValue = options.encryptedValue ?? "encrypted-test-value";
  const assignedRelays = options.assignedRelays ?? [];
  const createdBy = options.createdBy ?? "test-user";

  const credId = await t.run(async (ctx) => {
    return await ctx.db.insert("sharedCredentials", {
      name,
      credentialType,
      targetHost: options.targetHost,
      encryptedValue,
      assignedRelays,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    _id: credId as Id<"sharedCredentials">,
    name,
    credentialType,
    targetHost: options.targetHost,
    encryptedValue,
    assignedRelays,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}
