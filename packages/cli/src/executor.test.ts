import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeSSH, type ExecutionResult } from "./executor";

// Mock ssh2 module
vi.mock("ssh2", () => {
  return {
    Client: vi.fn().mockImplementation(() => {
      return {
        on: vi.fn().mockReturnThis(),
        connect: vi.fn(),
        exec: vi.fn(),
        end: vi.fn(),
      };
    }),
  };
});

// Mock logger to avoid console output during tests
vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("executor", () => {
  // Note: executeLocal tests are skipped in Node.js environment because they use Bun.spawn
  // These tests should be run with Bun runtime: `bun test remote-cmd-relay/executor.test.ts`
  describe("executeLocal", () => {
    it.skip("executes a simple command successfully (requires Bun runtime)", async () => {
      // This test requires Bun runtime
      // Run with: bun test remote-cmd-relay/executor.test.ts
    });

    it.skip("captures stdout correctly (requires Bun runtime)", async () => {});
    it.skip("captures stderr correctly (requires Bun runtime)", async () => {});
    it.skip("handles command failure with non-zero exit code (requires Bun runtime)", async () => {});
    it.skip("handles command not found (requires Bun runtime)", async () => {});
    it.skip("handles command timeout (requires Bun runtime)", async () => {});
    it.skip("returns duration in milliseconds (requires Bun runtime)", async () => {});
    it.skip("executes complex shell commands (requires Bun runtime)", async () => {});
    it.skip("handles piped commands (requires Bun runtime)", async () => {});
  });

  describe("executeSSH", () => {
    let mockClient: {
      on: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
      exec: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      vi.clearAllMocks();
      const { Client } = await import("ssh2");
      mockClient = {
        on: vi.fn().mockReturnThis(),
        connect: vi.fn(),
        exec: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(Client).mockImplementation(() => mockClient as unknown as InstanceType<typeof Client>);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("executes SSH command successfully", async () => {
      // Setup mock to simulate successful connection and command execution
      mockClient.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
        if (event === "ready") {
          setTimeout(() => callback(), 10);
        }
        return mockClient;
      });

      mockClient.exec.mockImplementation((cmd: string, callback: (err: Error | null, stream: unknown) => void) => {
        const mockStream = {
          on: vi.fn().mockImplementation((event: string, cb: (data: unknown) => void) => {
            if (event === "data") {
              setTimeout(() => cb(Buffer.from("command output")), 5);
            }
            if (event === "close") {
              setTimeout(() => cb(0), 10);
            }
            return mockStream;
          }),
          stderr: {
            on: vi.fn().mockReturnThis(),
          },
        };
        setTimeout(() => callback(null, mockStream), 0);
      });

      const result = await executeSSH({
        command: "uptime",
        host: "192.168.1.100",
        port: 22,
        username: "root",
        privateKey: "fake-private-key",
        timeoutMs: 5000,
      });

      expect(mockClient.connect).toHaveBeenCalledWith({
        host: "192.168.1.100",
        port: 22,
        username: "root",
        privateKey: "fake-private-key",
        readyTimeout: 10000,
      });
    });

    it("handles SSH connection error", async () => {
      mockClient.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
        if (event === "error") {
          setTimeout(() => callback(new Error("Connection refused")), 10);
        }
        return mockClient;
      });

      const result = await executeSSH({
        command: "uptime",
        host: "192.168.1.100",
        port: 22,
        username: "root",
        privateKey: "fake-key",
        timeoutMs: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("handles SSH command timeout", async () => {
      // Mock a connection that never completes
      mockClient.on.mockReturnThis();

      const result = await executeSSH({
        command: "sleep 100",
        host: "192.168.1.100",
        port: 22,
        username: "root",
        privateKey: "fake-key",
        timeoutMs: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command timed out");
    });

    it("handles exec error", async () => {
      mockClient.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
        if (event === "ready") {
          setTimeout(() => callback(), 10);
        }
        return mockClient;
      });

      mockClient.exec.mockImplementation((cmd: string, callback: (err: Error | null, stream: unknown) => void) => {
        setTimeout(() => callback(new Error("Exec failed"), null), 0);
      });

      const result = await executeSSH({
        command: "uptime",
        host: "192.168.1.100",
        port: 22,
        username: "root",
        privateKey: "fake-key",
        timeoutMs: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Exec failed");
    });
  });
});
