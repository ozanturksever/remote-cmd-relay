import { logger } from "./logger.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type CredentialType = "ssh_key" | "password" | "api_key";
export type StorageMode = "relay_only" | "shared";

export interface Credential {
  name: string;
  type: CredentialType;
  value: string;
  targetHost?: string;
  storageMode: StorageMode;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialMetadata {
  credentialName: string;
  credentialType: CredentialType;
  targetHost?: string;
  storageMode: StorageMode;
  lastUpdatedAt: number;
}

interface CredentialStore {
  version: number;
  salt: string;
  credentials: Credential[];
}

const STORE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

export class CredentialManager {
  private storePath: string;
  private encryptionKey: Buffer | null = null;
  private credentials: Map<string, Credential> = new Map();
  private salt: string = "";

  constructor(storeDir?: string) {
    const dir = storeDir || path.join(os.homedir(), ".remote-cmd-relay");
    this.storePath = path.join(dir, "credentials.enc");
  }

  /**
   * Initialize the credential manager
   * @param apiKey - API key used for encryption key derivation
   * @param machineId - Machine identifier for key derivation
   */
  async initialize(apiKey: string, machineId: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Load existing store or create new one
    if (fs.existsSync(this.storePath)) {
      await this.load(apiKey, machineId);
    } else {
      // Generate new salt for new store
      this.salt = crypto.randomBytes(32).toString("hex");
      this.encryptionKey = this.deriveKey(apiKey, machineId, this.salt);
      await this.save();
      logger.info("Created new credential store");
    }
  }

  /**
   * Derive encryption key from API key, machine ID, and salt
   */
  private deriveKey(apiKey: string, machineId: string, salt: string): Buffer {
    const combined = `${apiKey}:${machineId}`;
    return crypto.pbkdf2Sync(
      combined,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      "sha256"
    );
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private encrypt(data: string): string {
    if (!this.encryptionKey) {
      throw new Error("Credential manager not initialized");
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private decrypt(encryptedData: string): string {
    if (!this.encryptionKey) {
      throw new Error("Credential manager not initialized");
    }

    const parts = encryptedData.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Load credentials from encrypted store
   */
  private async load(apiKey: string, machineId: string): Promise<void> {
    const fileContent = fs.readFileSync(this.storePath, "utf8");
    const outer = JSON.parse(fileContent) as { salt: string; data: string };

    this.salt = outer.salt;
    this.encryptionKey = this.deriveKey(apiKey, machineId, this.salt);

    let decrypted: string;
    try {
      decrypted = this.decrypt(outer.data);
    } catch (err) {
      // AES-GCM decryption fails when the key doesn't match (wrong API key)
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("Unsupported state") || errorMessage.includes("unable to authenticate")) {
        throw new Error(
          `Failed to decrypt credential store: The API key doesn't match the one used to create the store.\n` +
          `The credential store at '${this.storePath}' was encrypted with a different API key.\n` +
          `To fix this, either:\n` +
          `  1. Use the original API key that created this store, or\n` +
          `  2. Delete the store file and start fresh: rm '${this.storePath}'`
        );
      }
      throw err;
    }

    const store = JSON.parse(decrypted) as CredentialStore;

    if (store.version !== STORE_VERSION) {
      logger.warn("Credential store version mismatch, migrating...");
      // Handle migration if needed
    }

    this.credentials.clear();
    for (const cred of store.credentials) {
      this.credentials.set(cred.name, cred);
    }

    logger.info(`Loaded ${this.credentials.size} credentials from store`);
  }

  /**
   * Save credentials to encrypted store
   */
  private async save(): Promise<void> {
    if (!this.encryptionKey) {
      throw new Error("Credential manager not initialized");
    }

    const store: CredentialStore = {
      version: STORE_VERSION,
      salt: this.salt,
      credentials: Array.from(this.credentials.values()),
    };

    const encrypted = this.encrypt(JSON.stringify(store));
    const outer = {
      salt: this.salt,
      data: encrypted,
    };

    // Write atomically using temp file
    const tempPath = `${this.storePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(outer), { mode: 0o600 });
    fs.renameSync(tempPath, this.storePath);
  }

  /**
   * Get a credential by name
   */
  get(name: string): Credential | undefined {
    return this.credentials.get(name);
  }

  /**
   * Get a credential for a specific target host
   */
  getForTarget(targetHost: string): Credential | undefined {
    for (const cred of this.credentials.values()) {
      if (cred.targetHost === targetHost) {
        return cred;
      }
    }
    return undefined;
  }

  /**
   * Set a credential
   */
  async set(credential: Omit<Credential, "createdAt" | "updatedAt">): Promise<void> {
    const now = Date.now();
    const existing = this.credentials.get(credential.name);

    const fullCredential: Credential = {
      ...credential,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.credentials.set(credential.name, fullCredential);
    await this.save();
    logger.info(`Saved credential: ${credential.name}`);
  }

  /**
   * Delete a credential
   */
  async delete(name: string): Promise<boolean> {
    const deleted = this.credentials.delete(name);
    if (deleted) {
      await this.save();
      logger.info(`Deleted credential: ${name}`);
    }
    return deleted;
  }

  /**
   * List all credentials (metadata only, no values)
   */
  list(): CredentialMetadata[] {
    return Array.from(this.credentials.values()).map((cred) => ({
      credentialName: cred.name,
      credentialType: cred.type,
      targetHost: cred.targetHost,
      storageMode: cred.storageMode,
      lastUpdatedAt: cred.updatedAt,
    }));
  }

  /**
   * Get all credentials (with values) - use with caution
   */
  getAll(): Credential[] {
    return Array.from(this.credentials.values());
  }

  /**
   * Import shared credentials from center
   * These are already encrypted and need to be decrypted with a shared key
   */
  async importSharedCredentials(
    sharedCreds: Array<{
      name: string;
      credentialType: CredentialType;
      targetHost?: string;
      encryptedValue: string;
      updatedAt: number;
    }>,
    decryptSharedValue: (encryptedValue: string) => string
  ): Promise<number> {
    let imported = 0;

    for (const cred of sharedCreds) {
      const existing = this.credentials.get(cred.name);
      
      // Only update if newer or doesn't exist
      if (!existing || existing.updatedAt < cred.updatedAt) {
        const decryptedValue = decryptSharedValue(cred.encryptedValue);
        
        await this.set({
          name: cred.name,
          type: cred.credentialType,
          value: decryptedValue,
          targetHost: cred.targetHost,
          storageMode: "shared",
        });
        imported++;
      }
    }

    return imported;
  }

  /**
   * Check if credential store has been initialized
   */
  isInitialized(): boolean {
    return this.encryptionKey !== null;
  }
}

// Export singleton instance
export const credentialManager = new CredentialManager();
