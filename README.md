# Remote Command Relay

A monorepo containing tools for executing commands on remote machines through a Convex backend.

## Packages

### [@fatagnus/remote-cmd-relay](./packages/cli)

A standalone CLI tool that connects to Convex and executes commands on machines in restricted network segments. Features secure credential management, capability reporting, and real-time status updates.

**Quick Start:**

```bash
# Run directly with npx (no install needed)
npx @fatagnus/remote-cmd-relay --help

# Or install globally
npm install -g @fatagnus/remote-cmd-relay
```

**Download Binary:**

Pre-built binaries are available for Linux and macOS (x64 and ARM64) on the [GitHub Releases](https://github.com/ozanturksever/remote-cmd-relay/releases) page.

### [@fatagnus/remote-cmd-relay-convex](./packages/convex)

A Convex component that provides the backend infrastructure for managing remote command relays, including assignment management, command queuing, status tracking, credential inventory, and configuration push.

```bash
npm install @fatagnus/remote-cmd-relay-convex
```

## Overview

The Remote Command Relay system enables remote command execution on machines in restricted network segments by:

1. **Managing relay assignments** - Link API keys to machines
2. **Queuing commands** - Store pending commands for relay execution
3. **Tracking status** - Monitor relay health, capabilities, and metrics
4. **Credential inventory** - Track what credentials each relay has (metadata only)
5. **Configuration push** - Push config updates to relays
6. **RPC interface** - Call relay commands synchronously from Convex actions

## RPC Quick Start

Execute commands on remote machines directly from your Convex actions:

```typescript
import { exec } from "@fatagnus/remote-cmd-relay-convex";
import { components } from "./_generated/api";
import { action } from "./_generated/server";

export const runCommand = action({
  handler: async (ctx) => {
    const result = await exec(ctx, components.remoteCmdRelay.rpc, {
      machineId: "my-machine",
      command: "df -h",
      targetType: "local",
      createdBy: "system",
    });
    
    return result.success ? result.output : result.error;
  },
});
```

For sub-second latency, run the relay in subscription mode:

```bash
remote-cmd-relay API_KEY https://app.convex.site --deployment-url https://app.convex.cloud
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
│                    ┌─────────────────────────────┐                  │
│                    │  Subscription Mode (RPC)    │                  │
│                    │  WebSocket for instant cmds │                  │
│                    └─────────────────────────────┘                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼───────┐ ┌────▼────┐ ┌──────▼──────┐
      │ Local Exec    │ │   SSH   │ │   Metrics   │
      │ (this machine)│ │  Exec   │ │ Collection  │
      └───────────────┘ └─────────┘ └─────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Run e2e tests
npm run test:e2e
```

## Links

- [GitHub Repository](https://github.com/ozanturksever/remote-cmd-relay)
- [npm: @fatagnus/remote-cmd-relay](https://www.npmjs.com/package/@fatagnus/remote-cmd-relay)
- [Releases](https://github.com/ozanturksever/remote-cmd-relay/releases)

## License

Apache-2.0
