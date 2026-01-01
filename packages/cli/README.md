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

### Via npx (Recommended)

Run directly without installing:

```bash
npx @fatagnus/remote-cmd-relay --help
```

### Via npm (Global Install)

```bash
npm install -g @fatagnus/remote-cmd-relay
remote-cmd-relay --help
```

### Pre-built Binaries

Download the pre-built binary for your platform from the [GitHub Releases](https://github.com/ozanturksever/remote-cmd-relay/releases) page.

| Platform | Binary Name |
|----------|-------------|
| Linux x86_64 | `remote-cmd-relay_linux_amd64` |
| Linux ARM64 | `remote-cmd-relay_linux_arm64` |
| macOS Intel | `remote-cmd-relay_darwin_amd64` |
| macOS Apple Silicon | `remote-cmd-relay_darwin_arm64` |

```bash
# Example: Download and run on Linux x86_64
curl -L -o remote-cmd-relay https://github.com/ozanturksever/remote-cmd-relay/releases/latest/download/remote-cmd-relay_linux_amd64
chmod +x remote-cmd-relay
./remote-cmd-relay --help
```

### Build from Source

```bash
cd packages/cli
bun install
bun run build:npm      # Build npm package
bun run build:binaries # Build standalone binaries for all platforms
```

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
| `--store-dir <path>` | Custom directory for credential store | ~/.remote-cmd-relay |
| `--deployment-url <url>` | Convex deployment URL for subscription mode | - |
| `--component-name <name>` | Convex component name | remoteCmdRelay |
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

# Subscription mode for real-time RPC (recommended for low latency)
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site \
  --deployment-url https://my-app.convex.cloud
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

## Operating Modes

### Polling Mode (Default)

The relay polls the Convex backend at regular intervals (default: 5 seconds) to check for pending commands. This is simple and works everywhere but has higher latency.

```bash
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site
```

### Subscription Mode (Recommended for RPC)

The relay maintains a WebSocket connection to Convex and receives commands instantly via subscriptions. This enables sub-second latency for RPC-style command execution.

```bash
./remote-cmd-relay sk_live_xxxxx https://my-app.convex.site \
  --deployment-url https://my-app.convex.cloud
```

**When to use subscription mode:**
- When using the `exec()` helper in Convex actions
- When you need synchronous command execution
- When low latency is important

**Note:** The `--deployment-url` should be your Convex deployment URL (ending in `.convex.cloud`), not your site URL (ending in `.convex.site`).

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
