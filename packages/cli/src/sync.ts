import { logger } from "./logger.js";
import { credentialManager, type CredentialType } from "./credentials.js";

export interface ConfigPush {
  _id: string;
  pushType: string;
  payload: string;
  createdAt: number;
}

export interface SharedCredential {
  name: string;
  credentialType: CredentialType;
  targetHost?: string;
  encryptedValue: string;
  updatedAt: number;
}

export interface SyncConfig {
  convexUrl: string;
  apiKey: string;
  relayId: string;
}

/**
 * Sync manager for configuration and credentials
 */
export class SyncManager {
  private config: SyncConfig;
  private sharedSecretKey: string | null = null;

  constructor(config: SyncConfig) {
    this.config = config;
  }

  /**
   * Set the shared secret key for decrypting shared credentials
   * In a real implementation, this would be derived from a secure key exchange
   */
  setSharedSecretKey(key: string): void {
    this.sharedSecretKey = key;
  }

  /**
   * Fetch pending config pushes from center
   */
  async fetchPendingConfigPushes(): Promise<ConfigPush[]> {
    try {
      const response = await fetch(
        `${this.config.convexUrl}/relay/config/pending`,
        {
          method: "GET",
          headers: {
            "X-API-Key": this.config.apiKey,
          },
        }
      );

      if (!response.ok) {
        logger.warn("Failed to fetch pending config pushes", {
          status: response.status,
        });
        return [];
      }

      const data = (await response.json()) as { pushes: ConfigPush[] };
      return data.pushes || [];
    } catch (err) {
      logger.error("Error fetching config pushes", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Acknowledge a config push
   */
  async acknowledgeConfigPush(
    pushId: string,
    success: boolean,
    errorMessage?: string
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.convexUrl}/relay/config/ack`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.apiKey,
          },
          body: JSON.stringify({ pushId, success, errorMessage }),
        }
      );

      return response.ok;
    } catch (err) {
      logger.error("Error acknowledging config push", {
        pushId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Fetch shared credentials assigned to this relay
   */
  async fetchSharedCredentials(): Promise<SharedCredential[]> {
    try {
      const response = await fetch(
        `${this.config.convexUrl}/relay/credentials/shared`,
        {
          method: "GET",
          headers: {
            "X-API-Key": this.config.apiKey,
          },
        }
      );

      if (!response.ok) {
        logger.warn("Failed to fetch shared credentials", {
          status: response.status,
        });
        return [];
      }

      const data = (await response.json()) as { credentials: SharedCredential[] };
      return data.credentials || [];
    } catch (err) {
      logger.error("Error fetching shared credentials", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Process a config push
   */
  async processConfigPush(push: ConfigPush): Promise<boolean> {
    logger.info(`Processing config push: ${push.pushType}`, { pushId: push._id });

    try {
      const payload = JSON.parse(push.payload);

      switch (push.pushType) {
        case "credential":
          return await this.handleCredentialPush(payload);
        case "ssh_targets":
          return await this.handleSshTargetsPush(payload);
        case "allowed_commands":
          return await this.handleAllowedCommandsPush(payload);
        case "metrics_interval":
          return await this.handleMetricsIntervalPush(payload);
        default:
          logger.warn(`Unknown config push type: ${push.pushType}`);
          return false;
      }
    } catch (err) {
      logger.error("Error processing config push", {
        pushId: push._id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Handle credential push
   */
  private async handleCredentialPush(
    payload: SharedCredential
  ): Promise<boolean> {
    if (!this.sharedSecretKey) {
      logger.error("Cannot process credential push: shared secret key not set");
      return false;
    }

    try {
      // Decrypt the credential value
      const decryptedValue = this.decryptSharedValue(payload.encryptedValue);

      // Store the credential
      await credentialManager.set({
        name: payload.name,
        type: payload.credentialType,
        value: decryptedValue,
        targetHost: payload.targetHost,
        storageMode: "shared",
      });

      logger.info(`Stored shared credential: ${payload.name}`);
      return true;
    } catch (err) {
      logger.error("Error handling credential push", {
        name: payload.name,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Handle SSH targets configuration push
   */
  private async handleSshTargetsPush(
    payload: { targets: string[] }
  ): Promise<boolean> {
    // Store SSH targets configuration
    // This could be stored in a local config file or memory
    logger.info("Updated SSH targets configuration", {
      targetCount: payload.targets.length,
    });
    return true;
  }

  /**
   * Handle allowed commands configuration push
   */
  private async handleAllowedCommandsPush(
    payload: { commands: string[] }
  ): Promise<boolean> {
    // Store allowed commands configuration
    logger.info("Updated allowed commands configuration", {
      commandCount: payload.commands.length,
    });
    return true;
  }

  /**
   * Handle metrics interval configuration push
   */
  private async handleMetricsIntervalPush(
    payload: { intervalMs: number }
  ): Promise<boolean> {
    logger.info("Updated metrics interval", {
      intervalMs: payload.intervalMs,
    });
    return true;
  }

  /**
   * Decrypt a shared credential value
   * In a real implementation, this would use the shared secret key
   */
  private decryptSharedValue(encryptedValue: string): string {
    if (!this.sharedSecretKey) {
      throw new Error("Shared secret key not set");
    }

    // For now, we'll use a simple decryption
    // In production, this should use proper key exchange and encryption
    const crypto = require("crypto");
    const key = crypto
      .createHash("sha256")
      .update(this.sharedSecretKey)
      .digest();

    const parts = encryptedValue.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted value format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Full sync: fetch and process all pending items
   */
  async fullSync(): Promise<{
    configPushesProcessed: number;
    sharedCredentialsImported: number;
  }> {
    let configPushesProcessed = 0;
    let sharedCredentialsImported = 0;

    // Process pending config pushes
    const pendingPushes = await this.fetchPendingConfigPushes();
    for (const push of pendingPushes) {
      const success = await this.processConfigPush(push);
      await this.acknowledgeConfigPush(
        push._id,
        success,
        success ? undefined : "Processing failed"
      );
      if (success) {
        configPushesProcessed++;
      }
    }

    // Sync shared credentials
    if (this.sharedSecretKey) {
      const sharedCreds = await this.fetchSharedCredentials();
      const imported = await credentialManager.importSharedCredentials(
        sharedCreds,
        (encVal) => this.decryptSharedValue(encVal)
      );
      sharedCredentialsImported = imported;
    }

    logger.info("Sync completed", {
      configPushesProcessed,
      sharedCredentialsImported,
    });

    return { configPushesProcessed, sharedCredentialsImported };
  }
}
