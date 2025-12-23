# Remote Command Relay - Convex Component

A Convex component that provides the backend infrastructure for managing remote command relays, including assignment management, command queuing, status tracking, credential inventory, and configuration push.

## Overview

This component enables remote command execution on machines in restricted network segments by:

1. **Managing relay assignments** - Link API keys to machines
2. **Queuing commands** - Store pending commands for relay execution
3. **Tracking status** - Monitor relay health, capabilities, and metrics
4. **Credential inventory** - Track what credentials each relay has (metadata only)
5. **Configuration push** - Push config updates to relays

## Installation

The component is registered in your app's `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import remoteCmdRelay from "./remoteCmdRelay/convex.config";

const app = defineApp();
app.use(remoteCmdRelay);

export default app;
```

## Schema

### Tables

#### `relayAssignments`

Links Better Auth API keys to machines.

| Field | Type | Description |
|-------|------|-------------|
| `apiKeyId` | string | Better Auth API key ID |
| `machineId` | string | Reference to machine in main app |
| `name` | string | Friendly name for the relay |
| `enabled` | boolean | Whether the relay is enabled |
| `lastSeenAt` | number? | Last heartbeat timestamp |
| `createdBy` | string | User who created the assignment |
| `createdAt` | number | Creation timestamp |
| `updatedAt` | number | Last update timestamp |

#### `relayStatus`

Tracks relay health, capabilities, and metrics.

| Field | Type | Description |
|-------|------|-------------|
| `relayId` | string | Reference to relayAssignments._id |
| `capabilities` | array | List of capabilities (ssh, local_cmd, perf_metrics) |
| `metrics` | object? | Performance metrics (CPU, memory, disk) |
| `version` | string? | Relay binary version |
| `hostname` | string? | Relay host machine name |
| `platform` | string? | OS platform |
| `lastHeartbeatAt` | number | Last heartbeat timestamp |

#### `relayCredentialInventory`

Tracks what credentials each relay reports it has (metadata only, not values).

| Field | Type | Description |
|-------|------|-------------|
| `relayId` | string | Reference to relayAssignments._id |
| `credentialName` | string | Name/identifier of the credential |
| `credentialType` | string | Type: ssh_key, password, api_key |
| `targetHost` | string? | What host this credential is for |
| `storageMode` | string | relay_only or shared |
| `lastUpdatedAt` | number | When credential was last updated on relay |
| `reportedAt` | number | When relay reported this credential |

#### `sharedCredentials`

Backup storage for shared mode credentials (encrypted).

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Credential name |
| `credentialType` | string | Type: ssh_key, password, api_key |
| `targetHost` | string? | What host this credential is for |
| `encryptedValue` | string | Encrypted credential value |
| `assignedRelays` | array | List of relay IDs this is assigned to |
| `createdBy` | string | User who created the credential |

#### `configPushQueue`

Queue for pushing configuration updates to relays.

| Field | Type | Description |
|-------|------|-------------|
| `relayId` | string | Target relay |
| `pushType` | string | Type: credential, ssh_targets, allowed_commands, metrics_interval |
| `payload` | string | JSON-encoded payload |
| `status` | string | Status: pending, sent, acked, failed |
| `createdBy` | string | User who created the push |
| `errorMessage` | string? | Error message if failed |

#### `commandQueue`

Commands waiting to be executed by relays.

| Field | Type | Description |
|-------|------|-------------|
| `machineId` | string | Target machine (relay assignment) |
| `targetType` | string | local or ssh |
| `targetHost` | string? | SSH target host |
| `targetPort` | number? | SSH target port |
| `targetUsername` | string? | SSH username |
| `command` | string | Command to execute |
| `timeoutMs` | number | Command timeout |
| `status` | string | pending, claimed, executing, completed, failed, timeout |
| `output` | string? | Command stdout |
| `stderr` | string? | Command stderr |
| `exitCode` | number? | Exit code |
| `error` | string? | Error message |
| `durationMs` | number? | Execution duration |

## Functions

### Assignments (`assignments.ts`)

```typescript
// Create a new relay assignment
await ctx.runMutation(components.remoteCmdRelay.assignments.create, {
  apiKeyId: "api_key_id",
  machineId: "machine_id",
  name: "Production Relay",
  createdBy: "user_id",
});

// List all assignments
const assignments = await ctx.runQuery(
  components.remoteCmdRelay.assignments.listAll,
  {}
);

// Update assignment
await ctx.runMutation(components.remoteCmdRelay.assignments.update, {
  id: assignmentId,
  enabled: false,
});

// Delete assignment
await ctx.runMutation(components.remoteCmdRelay.assignments.remove, {
  id: assignmentId,
});
```

### Commands (`commands.ts`)

```typescript
// Queue a command
await ctx.runMutation(components.remoteCmdRelay.commands.queue, {
  machineId: "machine_id",
  command: "df -h",
  targetType: "local",
  timeoutMs: 30000,
  createdBy: "user_id",
});

// Queue SSH command
await ctx.runMutation(components.remoteCmdRelay.commands.queue, {
  machineId: "machine_id",
  command: "systemctl status nginx",
  targetType: "ssh",
  targetHost: "192.168.1.100",
  targetPort: 22,
  targetUsername: "admin",
  timeoutMs: 30000,
  createdBy: "user_id",
});

// Get pending commands for a machine
const commands = await ctx.runQuery(
  components.remoteCmdRelay.commands.getPending,
  { machineId: "machine_id" }
);

// Claim a command (relay calls this)
await ctx.runMutation(components.remoteCmdRelay.commands.claim, {
  commandId: "command_id",
  claimedBy: "relay_id",
});

// Complete a command with results
await ctx.runMutation(components.remoteCmdRelay.commands.complete, {
  commandId: "command_id",
  success: true,
  output: "Filesystem      Size  Used Avail Use% Mounted on\n...",
  exitCode: 0,
  durationMs: 150,
});
```

### Status (`status.ts`)

```typescript
// Report relay status (relay calls this)
await ctx.runMutation(components.remoteCmdRelay.status.reportStatus, {
  relayId: "relay_id",
  capabilities: ["ssh", "local_cmd", "perf_metrics"],
  metrics: {
    cpuPercent: 25.5,
    memoryPercent: 60.2,
    diskPercent: 45.0,
  },
  version: "1.0.0",
  hostname: "prod-server-01",
  platform: "linux",
});

// Get status for a relay
const status = await ctx.runQuery(
  components.remoteCmdRelay.status.getByRelayId,
  { relayId: "relay_id" }
);

// List all relay statuses
const statuses = await ctx.runQuery(
  components.remoteCmdRelay.status.listAll,
  {}
);

// Find relays with specific capability
const sshRelays = await ctx.runQuery(
  components.remoteCmdRelay.status.findByCapability,
  { capability: "ssh" }
);
```

### Credentials (`credentials.ts`)

```typescript
// Report credential inventory (relay calls this)
await ctx.runMutation(components.remoteCmdRelay.credentials.reportInventory, {
  relayId: "relay_id",
  credentials: [
    {
      credentialName: "prod-server-ssh",
      credentialType: "ssh_key",
      targetHost: "192.168.1.100",
      storageMode: "relay_only",
      lastUpdatedAt: Date.now(),
    },
  ],
});

// Get credential inventory for a relay
const inventory = await ctx.runQuery(
  components.remoteCmdRelay.credentials.getInventoryByRelayId,
  { relayId: "relay_id" }
);

// Find relays that have credentials for a target
const relays = await ctx.runQuery(
  components.remoteCmdRelay.credentials.findRelaysForTarget,
  { targetHost: "192.168.1.100" }
);

// Create shared credential (stored on center)
await ctx.runMutation(components.remoteCmdRelay.credentials.createSharedCredential, {
  name: "shared-api-key",
  credentialType: "api_key",
  encryptedValue: "encrypted...",
  assignedRelays: ["relay_id_1", "relay_id_2"],
  createdBy: "user_id",
});
```

### Config Push (`configPush.ts`)

```typescript
// Queue a config push
await ctx.runMutation(components.remoteCmdRelay.configPush.queuePush, {
  relayId: "relay_id",
  pushType: "credential",
  payload: JSON.stringify({ name: "new-credential", ... }),
  createdBy: "user_id",
});

// Get pending pushes for a relay
const pending = await ctx.runQuery(
  components.remoteCmdRelay.configPush.getPendingForRelay,
  { relayId: "relay_id" }
);

// Acknowledge a push
await ctx.runMutation(components.remoteCmdRelay.configPush.acknowledge, {
  pushId: "push_id",
  success: true,
});
```

### Public API (`public.ts`)

HTTP-accessible functions for relay communication:

```typescript
// Verify relay API key
const result = await ctx.runQuery(
  components.remoteCmdRelay.public.verifyRelay,
  { apiKeyId: "api_key_id" }
);

// Get pending commands
const commands = await ctx.runQuery(
  components.remoteCmdRelay.public.getPendingCommands,
  { machineId: "machine_id" }
);

// Claim a command
await ctx.runMutation(components.remoteCmdRelay.public.claimCommand, {
  commandId: "command_id",
  assignmentId: "assignment_id",
});

// Submit command result
await ctx.runMutation(components.remoteCmdRelay.public.submitResult, {
  commandId: "command_id",
  success: true,
  output: "...",
  exitCode: 0,
});

// Send heartbeat
await ctx.runMutation(components.remoteCmdRelay.public.sendHeartbeat, {
  apiKeyId: "api_key_id",
});
```

## HTTP Routes

The component exposes HTTP endpoints in `convex/http.ts`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/relay/verify` | Verify API key and get assignment |
| GET | `/relay/commands` | Get pending commands |
| POST | `/relay/commands/claim` | Claim a command |
| POST | `/relay/commands/result` | Submit command result |
| POST | `/relay/heartbeat` | Send heartbeat |
| POST | `/relay/status` | Report full status |

All endpoints require the `X-API-Key` header (except `/relay/verify` which takes it in the body).

## Types

### Capabilities

```typescript
type Capability = "ssh" | "local_cmd" | "perf_metrics";
```

### Credential Types

```typescript
type CredentialType = "ssh_key" | "password" | "api_key";
```

### Storage Modes

```typescript
type StorageMode = "relay_only" | "shared";
```

### Command Status

```typescript
type CommandStatus = 
  | "pending" 
  | "claimed" 
  | "executing" 
  | "completed" 
  | "failed" 
  | "timeout";
```

### Config Push Types

```typescript
type ConfigPushType = 
  | "credential" 
  | "ssh_targets" 
  | "allowed_commands" 
  | "metrics_interval";
```

## Security Considerations

1. **API Key Validation**: All relay communication is authenticated via Better Auth API keys
2. **Credential Security**: 
   - `relay_only` credentials never leave the relay
   - `shared` credentials are stored encrypted on center
   - Credential inventory only reports metadata (names), not values
3. **Admin Access**: All management functions require admin role
4. **Command Routing**: Commands are only sent to relays assigned to the target machine

## Files

| File | Description |
|------|-------------|
| `convex.config.ts` | Component definition |
| `schema.ts` | Database schema and validators |
| `assignments.ts` | Relay assignment CRUD |
| `commands.ts` | Command queue management |
| `status.ts` | Relay status and capability tracking |
| `credentials.ts` | Credential inventory and shared credentials |
| `configPush.ts` | Configuration push queue |
| `public.ts` | HTTP-accessible functions for relays |
