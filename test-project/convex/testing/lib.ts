import {
  customQuery,
  customMutation,
  customAction,
} from "convex-helpers/server/customFunctions";
import {
  query,
  mutation,
  action,
} from "../_generated/server";
import { components } from "../_generated/api";

/**
 * Check if running in test mode.
 * Throws an error if IS_TEST environment variable is not set.
 */
function requireTestEnv(): void {
  if (process.env.IS_TEST === undefined) {
    throw new Error(
      "Calling a test-only function in an unexpected environment. Set IS_TEST=true to enable test functions.",
    );
  }
}

/**
 * A test-only query that checks for IS_TEST environment variable.
 */
export const testingQuery = customQuery(query, {
  args: {},
  input: async (_ctx) => {
    requireTestEnv();
    return { ctx: {}, args: {} };
  },
});

/**
 * A test-only mutation that checks for IS_TEST environment variable.
 */
export const testingMutation = customMutation(mutation, {
  args: {},
  input: async (_ctx) => {
    requireTestEnv();
    return { ctx: {}, args: {} };
  },
});

/**
 * A test-only action that checks for IS_TEST environment variable.
 */
export const testingAction = customAction(action, {
  args: {},
  input: async (_ctx) => {
    requireTestEnv();
    return { ctx: {}, args: {} };
  },
});

// For BetterAuth component tables, we use the component's query/mutation directly
// These are accessed via ctx.runQuery/ctx.runMutation with components.betterAuth
export { components };
