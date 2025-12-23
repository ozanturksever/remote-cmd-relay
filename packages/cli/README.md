# Remote Command Relay

A standalone binary that connects to Convex and executes commands on machines in restricted network segments. Features secure credential management, capability reporting, and real-time status updates.

## Overview

The Remote Command Relay acts as a bridge between your Convex backend and machines that are not directly accessible from the internet. It:

1. **Authenticates** with Convex using a Better Auth API key
2. **Reports capabilities** (SSH, local commands, performance metrics)
3. **Maintains local credential store** with AES-256-GCM encryption
4. **Reports credential inventory** to center (metadata only, values stay local)
5. **Collects performance metrics** (CPU, memory, disk)
6. **Polls for commands** and executes them locally or via SSH
7. **Reports results** back to Convex in real-time

## Installation

### Pre-built Binary

Download the pre-built binary for your platform from the releases page.

### Build from Source

```bash
cd remote-cmd-relay
bun install
bun run build
```

This creates a standalone binary at `dist/remote-cmd-relay`.

## Usage

```bash
./remote-cmd-relay <API_KEY> <CONVEX_URL> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `API_KEY` | Better Auth API key for authentication |
| `CONVEX_URL` | Convex site URL (e.g., `https://your-app.convex.site`) |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--poll-interval <ms>` | Command polling interval | 5000 |
| `--heartbeat-interval <ms>` | Heartbeat/status report interval | 30000 |
| `--log-level <level>` | Log level: debug, info, warn, error | info |
| `--help, -h` | Show help message | - |
| `--version, -v` | Show version | - |

### Examples

```bash
# Basic usage
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site

# With debug logging
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site --log-level debug

# With faster polling (2 seconds)
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site --poll-interval 2000

# With more frequent heartbeats (10 seconds)
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site --heartbeat-interval 10000
```

## Features

### Capability Detection

On startup, the relay detects and reports its capabilities:

| Capability | Description |
|------------|-------------|
| `ssh` | Can execute commands on remote machines via SSH |
| `local_cmd` | Can execute commands locally on the relay host |
| `perf_metrics` | Can collect and report performance metrics |

### Credential Management

The relay maintains an encrypted local credential store:

- **Location**: `~/.remote-cmd-relay/credentials.enc`
- **Encryption**: AES-256-GCM
- **Key derivation**: PBKDF2 with 100,000 iterations
- **Key material**: API key + machine ID + local salt

#### Credential Types

| Type | Description |
|------|-------------|
| `ssh_key` | SSH private key for remote access |
| `password` | Password credential |
| `api_key` | API key for services |

#### Storage Modes

| Mode | Description |
|------|-------------|
| `relay_only` | Credential stored only on relay (most secure) |
| `shared` | Credential can be backed up to center (for recovery) |

### Performance Metrics

The relay collects and reports system metrics:

- **CPU**: Usage percentage
- **Memory**: Usage percentage, used/total MB
- **Disk**: Usage percentage, used/total GB
- **Load Average**: 1m, 5m, 15m averages

### Status Reporting

The relay reports its status to the center:

- Capabilities
- Performance metrics
- Credential inventory (names only, not values)
- Version, hostname, platform info
- Last heartbeat timestamp

## Setup Guide

### 1. Create an API Key

In the relay management UI or programmatically:

```typescript
const { key } = await authClient.apiKey.create({
  name: "production-relay",
});
// Save this key - it won't be shown again!
```

### 2. Create a Relay Assignment

Link the API key to a machine:

```typescript
await createAssignment({
  apiKeyId: apiKey.id,
  machineId: machine._id,
  name: "Production Server Relay",
  createdBy: userId,
});
```

### 3. Deploy and Run the Relay

```bash
# Copy binary to target machine
scp dist/remote-cmd-relay user@server:/opt/relay/

# Run the relay
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site
```

### 4. Add Credentials (Optional)

For SSH access to other machines, add credentials to the relay's local store.
Credentials can be managed via the center UI or pushed from center for shared credentials.

### 5. Queue Commands

From your application:

```typescript
// Local command
await queueCommand({
  machineId: machine._id,
  command: "df -h",
  targetType: "local",
  timeoutMs: 30000,
  createdBy: userId,
});

// SSH command to another machine
await queueCommand({
  machineId: machine._id,
  command: "systemctl status nginx",
  targetType: "ssh",
  targetHost: "192.168.1.100",
  targetPort: 22,
  targetUsername: "admin",
  timeoutMs: 30000,
  createdBy: userId,
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CONVEX CENTER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ Assignments │  │  Commands   │  │   Status    │  │ Credentials│ │
│  │   Table     │  │   Queue     │  │   Table     │  │  Inventory │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                        RELAY BINARY                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  Capability │  │   Command   │  │   Status    │  │ Credential │ │
│  │  Detection  │  │  Executor   │  │  Reporter   │  │   Store    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐                                   │
│  │   Metrics   │  │    Sync     │                                   │
│  │  Collector  │  │   Manager   │                                   │
│  └─────────────┘  └─────────────┘                                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼───────┐ ┌────▼────┐ ┌──────▼──────┐
      │ Local Exec    │ │   SSH   │ │   Metrics   │
      │ (this machine)│ │  Exec   │ │ Collection  │
      └───────────────┘ └─────────┘ └─────────────┘
```

## Security

### Authentication
- API keys are validated on every request
- Keys are managed via Better Auth with hashing and expiration

### Credential Storage
- Local credentials encrypted with AES-256-GCM
- Encryption key derived from API key + machine ID
- `relay_only` credentials never leave the relay

### Command Execution
- Commands validated against whitelist (configurable)
- SSH uses private key authentication
- Each relay only processes commands for its assigned machine

### Network Security
- All communication over HTTPS
- Relay initiates connections (no inbound ports required)
- Suitable for firewalled/NAT environments

## Troubleshooting

### Relay not connecting

```bash
# Check with debug logging
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site --log-level debug
```

### SSH commands failing

1. Verify credentials are stored: check `~/.remote-cmd-relay/credentials.enc` exists
2. Check the relay has SSH capability reported
3. Verify target host is reachable from relay

### High CPU/Memory usage

Increase polling interval:
```bash
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site --poll-interval 10000
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev sk_live_xxxxx https://my-app.convex.site --log-level debug

# Build
bun run build

# Type check
bun run typecheck
```

## Files

| File | Description |
|------|-------------|
| `index.ts` | CLI entry point and argument parsing |
| `relay.ts` | Main relay logic and coordination |
| `executor.ts` | Local and SSH command execution |
| `credentials.ts` | Encrypted credential store |
| `capabilities.ts` | Capability detection |
| `metrics.ts` | Performance metrics collection |
| `sync.ts` | Config/credential sync with center |
| `logger.ts` | Timestamped logging utility |

## License

MIT
