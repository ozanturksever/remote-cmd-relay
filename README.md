# Remote Command Relay

A monorepo containing tools for executing commands on remote machines through a Convex backend.

## Packages

### [@fatagnus/remote-cmd-relay](./packages/cli)

A standalone CLI tool that connects to Convex and executes commands on machines in restricted network segments. Features secure credential management, capability reporting, and real-time status updates.

```bash
npm install -g @fatagnus/remote-cmd-relay
```

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
```

## License

Apache-2.0
