import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Command status
export const commandStatusValidator = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("executing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("timeout")
);

// Target type for command execution
export const targetTypeValidator = v.union(
  v.literal("local"),
  v.literal("ssh")
);

// Relay capabilities
export const capabilityValidator = v.union(
  v.literal("ssh"),
  v.literal("local_cmd"),
  v.literal("perf_metrics")
);

// Credential types
export const credentialTypeValidator = v.union(
  v.literal("ssh_key"),
  v.literal("password"),
  v.literal("api_key")
);

// Credential storage mode
export const storageModeValidator = v.union(
  v.literal("relay_only"),
  v.literal("shared")
);

// Config push types
export const configPushTypeValidator = v.union(
  v.literal("credential"),
  v.literal("ssh_targets"),
  v.literal("allowed_commands"),
  v.literal("metrics_interval")
);

// Config push status
export const configPushStatusValidator = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("acked"),
  v.literal("failed")
);

// Performance metrics object
export const metricsValidator = v.object({
  cpuPercent: v.optional(v.number()),
  memoryPercent: v.optional(v.number()),
  memoryUsedMb: v.optional(v.number()),
  memoryTotalMb: v.optional(v.number()),
  diskPercent: v.optional(v.number()),
  diskUsedGb: v.optional(v.number()),
  diskTotalGb: v.optional(v.number()),
  loadAvg1m: v.optional(v.number()),
  loadAvg5m: v.optional(v.number()),
  loadAvg15m: v.optional(v.number()),
});

export const tables = {
  // Relay assignments - links API keys to machines
  relayAssignments: defineTable({
    apiKeyId: v.string(), // Better Auth API key ID
    machineId: v.string(), // Reference to machine in main app
    name: v.string(), // Friendly name for the relay
    enabled: v.boolean(),
    lastSeenAt: v.optional(v.number()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_apiKeyId", ["apiKeyId"])
    .index("by_machineId", ["machineId"])
    .index("by_enabled", ["enabled"]),

  // Relay status - capabilities, metrics, heartbeat
  relayStatus: defineTable({
    relayId: v.string(), // Reference to relayAssignments._id
    capabilities: v.array(capabilityValidator),
    metrics: v.optional(metricsValidator),
    version: v.optional(v.string()), // Relay binary version
    hostname: v.optional(v.string()), // Relay host machine name
    platform: v.optional(v.string()), // OS platform
    lastHeartbeatAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_relayId", ["relayId"])
    .index("by_lastHeartbeat", ["lastHeartbeatAt"]),

  // Relay credential inventory - what credentials each relay reports it has
  relayCredentialInventory: defineTable({
    relayId: v.string(), // Reference to relayAssignments._id
    credentialName: v.string(), // Name/identifier of the credential
    credentialType: credentialTypeValidator,
    targetHost: v.optional(v.string()), // What host/machine this credential is for
    storageMode: storageModeValidator, // relay_only or shared
    lastUpdatedAt: v.number(), // When the credential was last updated on relay
    reportedAt: v.number(), // When relay reported this credential
  })
    .index("by_relayId", ["relayId"])
    .index("by_relayId_name", ["relayId", "credentialName"])
    .index("by_targetHost", ["targetHost"]),

  // Shared credentials - backup copies for shared mode creds (encrypted)
  sharedCredentials: defineTable({
    name: v.string(), // Credential name
    credentialType: credentialTypeValidator,
    targetHost: v.optional(v.string()), // What host/machine this credential is for
    encryptedValue: v.string(), // Encrypted credential value
    assignedRelays: v.array(v.string()), // List of relay IDs this is assigned to
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_targetHost", ["targetHost"]),

  // Config push queue - pending configuration pushes to relays
  configPushQueue: defineTable({
    relayId: v.string(), // Target relay
    pushType: configPushTypeValidator,
    payload: v.string(), // JSON-encoded payload
    status: configPushStatusValidator,
    createdBy: v.string(),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    ackedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_relayId", ["relayId"])
    .index("by_relayId_status", ["relayId", "status"])
    .index("by_status", ["status"]),

  // Command queue - commands waiting to be executed by relays
  commandQueue: defineTable({
    machineId: v.string(), // Target machine (relay assignment)
    targetType: targetTypeValidator, // local or ssh
    // SSH target details (only if targetType is "ssh")
    targetHost: v.optional(v.string()),
    targetPort: v.optional(v.number()),
    targetUsername: v.optional(v.string()),
    // Command details
    command: v.string(),
    timeoutMs: v.number(), // Command timeout
    // Status tracking
    status: commandStatusValidator,
    claimedBy: v.optional(v.string()), // Relay assignment ID that claimed
    claimedAt: v.optional(v.number()),
    // Results
    output: v.optional(v.string()),
    stderr: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Metadata
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_machineId", ["machineId"])
    .index("by_status", ["status"])
    .index("by_machineId_status", ["machineId", "status"])
    .index("by_createdAt", ["createdAt"]),
};

const schema = defineSchema(tables);

export default schema;
