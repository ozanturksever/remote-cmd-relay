import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncManager } from "./sync";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock logger
vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock credentialManager
vi.mock("./credentials", () => ({
  credentialManager: {
    set: vi.fn(),
    importSharedCredentials: vi.fn().mockResolvedValue(0),
  },
}));

describe("SyncManager", () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    syncManager = new SyncManager({
      convexUrl: "https://test.convex.cloud",
      apiKey: "test-api-key",
      relayId: "relay-123",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchPendingConfigPushes", () => {
    it("fetches pending config pushes successfully", async () => {
      const mockPushes = [
        { _id: "push-1", pushType: "credential", payload: "{}", createdAt: Date.now() },
        { _id: "push-2", pushType: "ssh_targets", payload: "{}", createdAt: Date.now() },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ pushes: mockPushes }),
      });

      const result = await syncManager.fetchPendingConfigPushes();

      expect(result).toEqual(mockPushes);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.convex.cloud/relay/config/pending",
        expect.objectContaining({
          method: "GET",
          headers: { "X-API-Key": "test-api-key" },
        })
      );
    });

    it("returns empty array on fetch error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await syncManager.fetchPendingConfigPushes();

      expect(result).toEqual([]);
    });

    it("returns empty array on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await syncManager.fetchPendingConfigPushes();

      expect(result).toEqual([]);
    });
  });

  describe("acknowledgeConfigPush", () => {
    it("acknowledges push successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const result = await syncManager.acknowledgeConfigPush("push-1", true);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.convex.cloud/relay/config/ack",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "test-api-key",
          },
          body: JSON.stringify({ pushId: "push-1", success: true, errorMessage: undefined }),
        })
      );
    });

    it("acknowledges failed push with error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const result = await syncManager.acknowledgeConfigPush(
        "push-1",
        false,
        "Processing failed"
      );

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            pushId: "push-1",
            success: false,
            errorMessage: "Processing failed",
          }),
        })
      );
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await syncManager.acknowledgeConfigPush("push-1", true);

      expect(result).toBe(false);
    });
  });

  describe("fetchSharedCredentials", () => {
    it("fetches shared credentials successfully", async () => {
      const mockCreds = [
        {
          name: "cred-1",
          credentialType: "ssh_key",
          encryptedValue: "encrypted",
          updatedAt: Date.now(),
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ credentials: mockCreds }),
      });

      const result = await syncManager.fetchSharedCredentials();

      expect(result).toEqual(mockCreds);
    });

    it("returns empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await syncManager.fetchSharedCredentials();

      expect(result).toEqual([]);
    });
  });

  describe("processConfigPush", () => {
    beforeEach(() => {
      syncManager.setSharedSecretKey("test-shared-secret");
    });

    it("processes ssh_targets push", async () => {
      const push = {
        _id: "push-1",
        pushType: "ssh_targets",
        payload: JSON.stringify({ targets: ["host1", "host2"] }),
        createdAt: Date.now(),
      };

      const result = await syncManager.processConfigPush(push);

      expect(result).toBe(true);
    });

    it("processes allowed_commands push", async () => {
      const push = {
        _id: "push-1",
        pushType: "allowed_commands",
        payload: JSON.stringify({ commands: ["ls", "cat", "echo"] }),
        createdAt: Date.now(),
      };

      const result = await syncManager.processConfigPush(push);

      expect(result).toBe(true);
    });

    it("processes metrics_interval push", async () => {
      const push = {
        _id: "push-1",
        pushType: "metrics_interval",
        payload: JSON.stringify({ intervalMs: 15000 }),
        createdAt: Date.now(),
      };

      const result = await syncManager.processConfigPush(push);

      expect(result).toBe(true);
    });

    it("returns false for unknown push type", async () => {
      const push = {
        _id: "push-1",
        pushType: "unknown_type",
        payload: "{}",
        createdAt: Date.now(),
      };

      const result = await syncManager.processConfigPush(push);

      expect(result).toBe(false);
    });

    it("returns false on invalid JSON payload", async () => {
      const push = {
        _id: "push-1",
        pushType: "ssh_targets",
        payload: "invalid-json{",
        createdAt: Date.now(),
      };

      const result = await syncManager.processConfigPush(push);

      expect(result).toBe(false);
    });
  });

  describe("setSharedSecretKey", () => {
    it("sets the shared secret key", () => {
      // No error should be thrown
      syncManager.setSharedSecretKey("my-secret-key");
    });
  });

  describe("fullSync", () => {
    it("processes pending config pushes and syncs credentials", async () => {
      // Mock pending pushes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            pushes: [
              {
                _id: "push-1",
                pushType: "ssh_targets",
                payload: JSON.stringify({ targets: ["host1"] }),
                createdAt: Date.now(),
              },
            ],
          }),
      });

      // Mock acknowledge
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await syncManager.fullSync();

      expect(result.configPushesProcessed).toBe(1);
      expect(result.sharedCredentialsImported).toBe(0); // No shared secret key set
    });

    it("syncs shared credentials when secret key is set", async () => {
      syncManager.setSharedSecretKey("test-secret");

      // Mock pending pushes (empty)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ pushes: [] }),
      });

      // Mock shared credentials
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            credentials: [
              {
                name: "shared-cred",
                credentialType: "ssh_key",
                encryptedValue: "encrypted",
                updatedAt: Date.now(),
              },
            ],
          }),
      });

      // Mock the credential manager's importSharedCredentials
      const { credentialManager } = await import("./credentials");
      vi.mocked(credentialManager.importSharedCredentials).mockResolvedValueOnce(1);

      const result = await syncManager.fullSync();

      expect(result.configPushesProcessed).toBe(0);
      expect(result.sharedCredentialsImported).toBe(1);
    });

    it("handles errors gracefully during sync", async () => {
      // Mock fetch to throw
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await syncManager.fullSync();

      expect(result.configPushesProcessed).toBe(0);
      expect(result.sharedCredentialsImported).toBe(0);
    });
  });
});
