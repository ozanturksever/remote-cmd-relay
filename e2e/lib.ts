import { beforeAll, afterAll, beforeEach } from "vitest";
import { api } from "../test-project/convex/_generated/api";
import { ConvexBackend } from "./lib/ConvexBackend";
import { exportPKCS8, generateKeyPair } from "jose";

export const setupE2E = () => {
  const backend = new ConvexBackend({
    projectDir: process.cwd() + "/test-project",
    stdio: "ignore",
  });

  beforeAll(async () => {
    await backend.init();

    // Generate and set auth keys for Better Auth
    const authKeys = await generateTestKeys();
    await backend.setEnv("BETTER_AUTH_SECRET", authKeys.BETTER_AUTH_SECRET);
  });

  afterAll(async () => {
    await backend.stop();
    console.log("--- E2E Run Finished ---");
  });

  beforeEach(async () => {
    await backend.client.mutation(api.testing.testing.clearAll);
  });

  return {
    backend,
    auth: {
      /**
       * Create a test user and authenticate them.
       */
      signInAs: async (options: AuthenticateOptions) => {
        const result = await backend.client.mutation(
          api.testing.testing.authenticateTestUser,
          {
            email: options.email,
            name: options.name,
            role: options.isAdmin ? "admin" : "user",
          },
        );
        return result;
      },

      /**
       * Create an admin user and authenticate them.
       */
      signInAsAdmin: async (options: Omit<AuthenticateOptions, "isAdmin"> = {}) => {
        const result = await backend.client.mutation(
          api.testing.testing.authenticateAdminUser,
          {
            email: options.email ?? "admin@example.com",
            name: options.name ?? "Admin User",
          },
        );
        return result;
      },
    },
  };
};

type AuthenticateOptions = {
  email?: string;
  name?: string;
  isAdmin?: boolean;
};

/**
 * Generates a secret key for Better Auth testing purposes.
 */
async function generateTestKeys(): Promise<{
  BETTER_AUTH_SECRET: string;
}> {
  const keys = await generateKeyPair("RS256", {
    extractable: true,
  });
  const privateKey = await exportPKCS8(keys.privateKey);
  const secret = privateKey.slice(0, 64).replace(/[\n\r]/g, "");

  return {
    BETTER_AUTH_SECRET: secret,
  };
}
