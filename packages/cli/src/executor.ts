import { spawn } from "node:child_process";
import { Client } from "ssh2";
import { logger } from "./logger.js";

export interface ExecutionResult {
  success: boolean;
  output: string;
  stderr: string;
  exitCode: number;
  error?: string;
  durationMs: number;
}

export interface LocalExecuteOptions {
  command: string;
  timeoutMs: number;
}

export interface SSHExecuteOptions {
  command: string;
  host: string;
  port: number;
  username: string;
  privateKey: string;
  timeoutMs: number;
}

/**
 * Execute a command locally using child_process.spawn
 */
export async function executeLocal(options: LocalExecuteOptions): Promise<ExecutionResult> {
  const startTime = Date.now();
  
  logger.debug(`Executing local command: ${options.command}`);
  
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const proc = spawn("sh", ["-c", options.command], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({
          success: false,
          output: stdout,
          stderr: stderr,
          exitCode: -1,
          error: "Command timed out",
          durationMs: Date.now() - startTime,
        });
      }
    }, options.timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        const exitCode = code ?? 0;
        const durationMs = Date.now() - startTime;
        logger.debug(`Command completed with exit code ${exitCode}`, { durationMs });
        resolve({
          success: exitCode === 0,
          output: stdout,
          stderr: stderr,
          exitCode,
          durationMs,
        });
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        const errorMessage = err.message;
        logger.error(`Local command failed: ${errorMessage}`);
        resolve({
          success: false,
          output: stdout,
          stderr: stderr,
          exitCode: -1,
          error: errorMessage,
          durationMs: Date.now() - startTime,
        });
      }
    });
  });
}

/**
 * Execute a command via SSH
 */
export async function executeSSH(options: SSHExecuteOptions): Promise<ExecutionResult> {
  const startTime = Date.now();
  
  logger.debug(`Executing SSH command on ${options.host}: ${options.command}`);
  
  return new Promise((resolve) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        conn.end();
        resolve({
          success: false,
          output: stdout,
          stderr: stderr,
          exitCode: -1,
          error: "Command timed out",
          durationMs: Date.now() - startTime,
        });
      }
    }, options.timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(options.command, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            resolved = true;
            conn.end();
            resolve({
              success: false,
              output: "",
              stderr: err.message,
              exitCode: -1,
              error: err.message,
              durationMs: Date.now() - startTime,
            });
            return;
          }

          stream
            .on("close", (code: number) => {
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                conn.end();
                const durationMs = Date.now() - startTime;
                logger.debug(`SSH command completed with exit code ${code}`, { durationMs });
                resolve({
                  success: code === 0,
                  output: stdout,
                  stderr: stderr,
                  exitCode: code ?? 0,
                  durationMs,
                });
              }
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err) => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          logger.error(`SSH connection error: ${err.message}`);
          resolve({
            success: false,
            output: "",
            stderr: err.message,
            exitCode: -1,
            error: err.message,
            durationMs: Date.now() - startTime,
          });
        }
      })
      .connect({
        host: options.host,
        port: options.port,
        username: options.username,
        privateKey: options.privateKey,
        readyTimeout: 10000,
      });
  });
}
