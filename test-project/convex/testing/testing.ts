import { testingMutation, testingQuery } from "./lib";
import { v } from "convex/values";

/**
 * Clear all data from the database.
 * This is called before each e2e test to ensure a clean state.
 */
export const clearAll = testingMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Clear test API key mappings from our app table
    const mappings = await ctx.db.query("testApiKeyMappings").collect();
    await Promise.all(mappings.map((doc) => ctx.db.delete(doc._id)));

    // Clear scheduled functions
    const scheduled = await ctx.db.system
      .query("_scheduled_functions")
      .collect();
    await Promise.all(scheduled.map((s) => ctx.scheduler.cancel(s._id)));

    // Clear storage
    const storedFiles = await ctx.db.system.query("_storage").collect();
    await Promise.all(storedFiles.map((s) => ctx.storage.delete(s._id)));

    console.log("Cleared all app tables");
    return null;
  },
});

/**
 * Create a test user for testing purposes.
 * This creates a simple user record that can be used for relay testing.
 * Note: This doesn't use BetterAuth - it's just for relay tests.
 */
export const authenticateTestUser = testingMutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
  },
  returns: v.object({
    userId: v.string(),
    sessionId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = args.email ?? "test@example.com";
    const name = args.name ?? "Test User";

    // Generate a simple user ID for testing
    const userId = `test-user-${now}-${Math.random().toString(36).slice(2)}`;
    const sessionId = `test-session-${now}`;
    const token = `test-token-${userId}`;

    return {
      userId,
      sessionId,
      token,
    };
  },
});

/**
 * Create an admin test user.
 */
export const authenticateAdminUser = testingMutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.object({
    userId: v.string(),
    sessionId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = args.email ?? "admin@example.com";
    const name = args.name ?? "Admin User";

    const userId = `test-admin-${now}-${Math.random().toString(36).slice(2)}`;
    const sessionId = `test-admin-session-${now}`;
    const token = `test-admin-token-${userId}`;

    return {
      userId,
      sessionId,
      token,
    };
  },
});
