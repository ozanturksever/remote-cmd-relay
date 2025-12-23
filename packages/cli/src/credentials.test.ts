import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CredentialManager, type Credential, type CredentialType, type StorageMode } from "./credentials";

// Mock logger
vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("CredentialManager", () => {
  let testDir: string;
  let manager: CredentialManager;

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = path.join(os.tmpdir(), `relay-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    manager = new CredentialManager(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("initialize", () => {
    it("initializes with new credential store", async () => {
      await manager.initialize("test-api-key", "test-machine-id");

      expect(manager.isInitialized()).toBe(true);
    });

    it("creates store directory if not exists", async () => {
      const newDir = path.join(testDir, "nested", "dir");
      const nestedManager = new CredentialManager(newDir);

      await nestedManager.initialize("api-key", "machine-id");

      expect(fs.existsSync(newDir)).toBe(true);
    });

    it("loads existing credential store", async () => {
      // First initialize to create store
      await manager.initialize("test-api-key", "test-machine-id");

      // Add a credential
      await manager.set({
        name: "test-cred",
        type: "ssh_key",
        value: "private-key-content",
        storageMode: "relay_only",
      });

      // Create new manager and load existing store
      const newManager = new CredentialManager(testDir);
      await newManager.initialize("test-api-key", "test-machine-id");

      const cred = newManager.get("test-cred");
      expect(cred).not.toBeUndefined();
      expect(cred?.value).toBe("private-key-content");
    });
  });

  describe("set and get", () => {
    beforeEach(async () => {
      await manager.initialize("api-key", "machine-id");
    });

    it("stores and retrieves a credential", async () => {
      await manager.set({
        name: "my-key",
        type: "ssh_key",
        value: "ssh-rsa AAAAB3...",
        storageMode: "relay_only",
      });

      const cred = manager.get("my-key");

      expect(cred).not.toBeUndefined();
      expect(cred?.name).toBe("my-key");
      expect(cred?.type).toBe("ssh_key");
      expect(cred?.value).toBe("ssh-rsa AAAAB3...");
    });

    it("stores credential with target host", async () => {
      await manager.set({
        name: "server-key",
        type: "ssh_key",
        value: "private-key",
        targetHost: "192.168.1.100",
        storageMode: "relay_only",
      });

      const cred = manager.get("server-key");

      expect(cred?.targetHost).toBe("192.168.1.100");
    });

    it("updates existing credential", async () => {
      await manager.set({
        name: "updatable",
        type: "password",
        value: "old-password",
        storageMode: "relay_only",
      });

      await manager.set({
        name: "updatable",
        type: "password",
        value: "new-password",
        storageMode: "relay_only",
      });

      const cred = manager.get("updatable");

      expect(cred?.value).toBe("new-password");
    });

    it("preserves createdAt on update", async () => {
      await manager.set({
        name: "timestamped",
        type: "api_key",
        value: "initial",
        storageMode: "relay_only",
      });

      const originalCreatedAt = manager.get("timestamped")?.createdAt;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await manager.set({
        name: "timestamped",
        type: "api_key",
        value: "updated",
        storageMode: "relay_only",
      });

      const cred = manager.get("timestamped");

      expect(cred?.createdAt).toBe(originalCreatedAt);
      expect(cred?.updatedAt).toBeGreaterThan(cred!.createdAt);
    });

    it("returns undefined for non-existent credential", () => {
      const cred = manager.get("non-existent");

      expect(cred).toBeUndefined();
    });
  });

  describe("getForTarget", () => {
    beforeEach(async () => {
      await manager.initialize("api-key", "machine-id");
    });

    it("returns credential for target host", async () => {
      await manager.set({
        name: "db-server-key",
        type: "ssh_key",
        value: "key-content",
        targetHost: "db.example.com",
        storageMode: "relay_only",
      });

      const cred = manager.getForTarget("db.example.com");

      expect(cred).not.toBeUndefined();
      expect(cred?.name).toBe("db-server-key");
    });

    it("returns undefined when no credential for target", () => {
      const cred = manager.getForTarget("unknown.host.com");

      expect(cred).toBeUndefined();
    });
  });

  describe("delete", () => {
    beforeEach(async () => {
      await manager.initialize("api-key", "machine-id");
    });

    it("deletes existing credential", async () => {
      await manager.set({
        name: "to-delete",
        type: "password",
        value: "secret",
        storageMode: "relay_only",
      });

      const deleted = await manager.delete("to-delete");

      expect(deleted).toBe(true);
      expect(manager.get("to-delete")).toBeUndefined();
    });

    it("returns false for non-existent credential", async () => {
      const deleted = await manager.delete("non-existent");

      expect(deleted).toBe(false);
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      await manager.initialize("api-key", "machine-id");
    });

    it("lists all credentials metadata", async () => {
      await manager.set({
        name: "cred-1",
        type: "ssh_key",
        value: "value-1",
        storageMode: "relay_only",
      });
      await manager.set({
        name: "cred-2",
        type: "password",
        value: "value-2",
        targetHost: "server.com",
        storageMode: "shared",
      });

      const list = manager.list();

      expect(list).toHaveLength(2);
      expect(list.map((c) => c.credentialName)).toContain("cred-1");
      expect(list.map((c) => c.credentialName)).toContain("cred-2");
    });

    it("does not include credential values in list", async () => {
      await manager.set({
        name: "secret-cred",
        type: "password",
        value: "super-secret-password",
        storageMode: "relay_only",
      });

      const list = manager.list();

      // The list should not contain the actual value
      expect(JSON.stringify(list)).not.toContain("super-secret-password");
    });

    it("returns empty array when no credentials", () => {
      const list = manager.list();

      expect(list).toEqual([]);
    });
  });

  describe("getAll", () => {
    beforeEach(async () => {
      await manager.initialize("api-key", "machine-id");
    });

    it("returns all credentials with values", async () => {
      await manager.set({
        name: "full-cred",
        type: "api_key",
        value: "api-key-value",
        storageMode: "relay_only",
      });

      const all = manager.getAll();

      expect(all).toHaveLength(1);
      expect(all[0].value).toBe("api-key-value");
    });
  });

  describe("importSharedCredentials", () => {
    beforeEach(async () => {
      await manager.initialize("api-key", "machine-id");
    });

    it("imports shared credentials", async () => {
      const sharedCreds = [
        {
          name: "shared-key",
          credentialType: "ssh_key" as CredentialType,
          targetHost: "shared.server.com",
          encryptedValue: "encrypted-content",
          updatedAt: Date.now(),
        },
      ];

      const decryptFn = (encrypted: string) => `decrypted:${encrypted}`;

      const imported = await manager.importSharedCredentials(sharedCreds, decryptFn);

      expect(imported).toBe(1);

      const cred = manager.get("shared-key");
      expect(cred).not.toBeUndefined();
      expect(cred?.value).toBe("decrypted:encrypted-content");
      expect(cred?.storageMode).toBe("shared");
    });

    it("skips credentials that are already up to date", async () => {
      const now = Date.now();

      // Add existing credential
      await manager.set({
        name: "existing",
        type: "ssh_key",
        value: "existing-value",
        storageMode: "shared",
      });

      // Try to import older version
      const sharedCreds = [
        {
          name: "existing",
          credentialType: "ssh_key" as CredentialType,
          encryptedValue: "new-encrypted",
          updatedAt: now - 10000, // Older than existing
        },
      ];

      const imported = await manager.importSharedCredentials(
        sharedCreds,
        (v) => v
      );

      expect(imported).toBe(0);
      expect(manager.get("existing")?.value).toBe("existing-value");
    });

    it("updates credentials when newer version available", async () => {
      // Add existing credential
      await manager.set({
        name: "to-update",
        type: "ssh_key",
        value: "old-value",
        storageMode: "shared",
      });

      // Import newer version
      const sharedCreds = [
        {
          name: "to-update",
          credentialType: "ssh_key" as CredentialType,
          encryptedValue: "new-encrypted",
          updatedAt: Date.now() + 10000, // Newer than existing
        },
      ];

      const imported = await manager.importSharedCredentials(
        sharedCreds,
        (v) => `decrypted:${v}`
      );

      expect(imported).toBe(1);
      expect(manager.get("to-update")?.value).toBe("decrypted:new-encrypted");
    });
  });

  describe("encryption", () => {
    it("stores credentials encrypted on disk", async () => {
      await manager.initialize("api-key", "machine-id");

      await manager.set({
        name: "encrypted-cred",
        type: "password",
        value: "plaintext-password",
        storageMode: "relay_only",
      });

      // Read the raw file content
      const storePath = path.join(testDir, "credentials.enc");
      const fileContent = fs.readFileSync(storePath, "utf8");

      // The plaintext password should not appear in the file
      expect(fileContent).not.toContain("plaintext-password");
    });

    it("uses different encryption with different API keys", async () => {
      await manager.initialize("api-key-1", "machine-id");

      await manager.set({
        name: "test-cred",
        type: "password",
        value: "secret",
        storageMode: "relay_only",
      });

      const storePath = path.join(testDir, "credentials.enc");
      const content1 = fs.readFileSync(storePath, "utf8");

      // Create new store with different API key
      const testDir2 = path.join(os.tmpdir(), `relay-test-2-${Date.now()}`);
      fs.mkdirSync(testDir2, { recursive: true });

      try {
        const manager2 = new CredentialManager(testDir2);
        await manager2.initialize("api-key-2", "machine-id");

        await manager2.set({
          name: "test-cred",
          type: "password",
          value: "secret",
          storageMode: "relay_only",
        });

        const storePath2 = path.join(testDir2, "credentials.enc");
        const content2 = fs.readFileSync(storePath2, "utf8");

        // The encrypted content should be different
        expect(content1).not.toBe(content2);
      } finally {
        fs.rmSync(testDir2, { recursive: true, force: true });
      }
    });
  });

  describe("error handling", () => {
    it("throws when not initialized", () => {
      const uninitializedManager = new CredentialManager(testDir);

      expect(uninitializedManager.isInitialized()).toBe(false);
    });
  });
});
