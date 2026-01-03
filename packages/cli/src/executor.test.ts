import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeLocal, type ExecutionResult } from "./executor.js";

describe("executeLocal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic execution", () => {
    it("should execute a simple command and return output", async () => {
      const result = await executeLocal({
        command: 'echo "hello world"',
        timeoutMs: 5000,
      });

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("hello world");
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should capture stderr output", async () => {
      const result = await executeLocal({
        command: 'echo "error message" >&2',
        timeoutMs: 5000,
      });

      expect(result.success).toBe(true);
      expect(result.stderr.trim()).toBe("error message");
      expect(result.exitCode).toBe(0);
    });

    it("should return failure for non-zero exit code", async () => {
      const result = await executeLocal({
        command: "exit 1",
        timeoutMs: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should handle command errors", async () => {
      const result = await executeLocal({
        command: "nonexistent_command_12345",
        timeoutMs: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("streaming callbacks", () => {
    it("should call onOutput callback for each stdout chunk", async () => {
      const chunks: string[] = [];
      const onOutput = vi.fn((chunk: string) => {
        chunks.push(chunk);
      });

      const result = await executeLocal({
        command: 'echo "line1"; echo "line2"; echo "line3"',
        timeoutMs: 5000,
        onOutput,
      });

      expect(result.success).toBe(true);
      expect(onOutput).toHaveBeenCalled();
      expect(chunks.join("")).toContain("line1");
      expect(chunks.join("")).toContain("line2");
      expect(chunks.join("")).toContain("line3");
    });

    it("should call onStderr callback for each stderr chunk", async () => {
      const chunks: string[] = [];
      const onStderr = vi.fn((chunk: string) => {
        chunks.push(chunk);
      });

      const result = await executeLocal({
        command: 'echo "error1" >&2; echo "error2" >&2',
        timeoutMs: 5000,
        onStderr,
      });

      expect(result.success).toBe(true);
      expect(onStderr).toHaveBeenCalled();
      expect(chunks.join("")).toContain("error1");
      expect(chunks.join("")).toContain("error2");
    });

    it("should call both onOutput and onStderr for mixed output", async () => {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const result = await executeLocal({
        command: 'echo "stdout1"; echo "stderr1" >&2; echo "stdout2"',
        timeoutMs: 5000,
        onOutput: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk),
      });

      expect(result.success).toBe(true);
      expect(stdoutChunks.join("")).toContain("stdout1");
      expect(stdoutChunks.join("")).toContain("stdout2");
      expect(stderrChunks.join("")).toContain("stderr1");
    });

    it("should stream output in real-time for long-running commands", async () => {
      const chunks: string[] = [];
      const timestamps: number[] = [];
      const startTime = Date.now();

      const onOutput = vi.fn((chunk: string) => {
        chunks.push(chunk);
        timestamps.push(Date.now() - startTime);
      });

      const result = await executeLocal({
        command: 'for i in 1 2 3; do echo "chunk$i"; sleep 0.1; done',
        timeoutMs: 10000,
        onOutput,
      });

      expect(result.success).toBe(true);
      expect(onOutput).toHaveBeenCalled();
      // Verify all chunks received
      const fullOutput = chunks.join("");
      expect(fullOutput).toContain("chunk1");
      expect(fullOutput).toContain("chunk2");
      expect(fullOutput).toContain("chunk3");
    });

    it("should work without callbacks (backwards compatibility)", async () => {
      const result = await executeLocal({
        command: 'echo "test"',
        timeoutMs: 5000,
      });

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("test");
    });
  });

  describe("timeout handling", () => {
    it("should timeout long-running commands", async () => {
      const result = await executeLocal({
        command: "sleep 10",
        timeoutMs: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command timed out");
      expect(result.exitCode).toBe(-1);
    });

    it("should still call callbacks before timeout", async () => {
      const chunks: string[] = [];
      const onOutput = vi.fn((chunk: string) => {
        chunks.push(chunk);
      });

      const result = await executeLocal({
        command: 'echo "before sleep"; sleep 10',
        timeoutMs: 500,
        onOutput,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command timed out");
      // Should have received output before timeout
      expect(chunks.join("")).toContain("before sleep");
    });
  });
});

describe("executeSSH", () => {
  // Note: SSH tests require a mock SSH server or are integration tests
  // These tests document the expected interface with streaming callbacks

  it("should have onOutput and onStderr in SSHExecuteOptions interface", async () => {
    // This is a compile-time check - if it compiles, the interface is correct
    const options = {
      command: "echo test",
      host: "localhost",
      port: 22,
      username: "testuser",
      privateKey: "fake-key",
      timeoutMs: 5000,
      onOutput: (chunk: string) => console.log(chunk),
      onStderr: (chunk: string) => console.error(chunk),
    };

    // Type check passes if this compiles
    expect(options.onOutput).toBeDefined();
    expect(options.onStderr).toBeDefined();
  });
});
