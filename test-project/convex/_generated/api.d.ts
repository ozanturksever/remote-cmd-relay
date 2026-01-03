/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as relayAuth from "../relayAuth.js";
import type * as testing_lib from "../testing/lib.js";
import type * as testing_relay from "../testing/relay.js";
import type * as testing_testing from "../testing/testing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  relayAuth: typeof relayAuth;
  "testing/lib": typeof testing_lib;
  "testing/relay": typeof testing_relay;
  "testing/testing": typeof testing_testing;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  remoteCmdRelay: {
    assignments: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          apiKeyId: string;
          createdBy: string;
          machineId: string;
          name: string;
        },
        string
      >;
      getByApiKeyId: FunctionReference<
        "query",
        "internal",
        { apiKeyId: string },
        {
          _id: string;
          apiKeyId: string;
          createdAt: number;
          createdBy: string;
          enabled: boolean;
          lastSeenAt?: number;
          machineId: string;
          name: string;
          updatedAt: number;
        } | null
      >;
      heartbeat: FunctionReference<
        "mutation",
        "internal",
        { apiKeyId: string },
        null
      >;
      listAll: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: string;
          apiKeyId: string;
          createdAt: number;
          createdBy: string;
          enabled: boolean;
          lastSeenAt?: number;
          machineId: string;
          name: string;
          updatedAt: number;
        }>
      >;
      listByMachineId: FunctionReference<
        "query",
        "internal",
        { machineId: string },
        Array<{
          _id: string;
          apiKeyId: string;
          createdAt: number;
          createdBy: string;
          enabled: boolean;
          lastSeenAt?: number;
          machineId: string;
          name: string;
          updatedAt: number;
        }>
      >;
      remove: FunctionReference<"mutation", "internal", { id: string }, null>;
      update: FunctionReference<
        "mutation",
        "internal",
        { enabled?: boolean; id: string; name?: string },
        null
      >;
    };
    commands: {
      claim: FunctionReference<
        "mutation",
        "internal",
        { claimedBy: string; id: string },
        boolean
      >;
      complete: FunctionReference<
        "mutation",
        "internal",
        {
          durationMs?: number;
          error?: string;
          exitCode?: number;
          id: string;
          output?: string;
          stderr?: string;
          success: boolean;
        },
        null
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
          _id: string;
          claimedAt?: number;
          claimedBy?: string;
          command: string;
          completedAt?: number;
          createdAt: number;
          createdBy: string;
          durationMs?: number;
          error?: string;
          exitCode?: number;
          machineId: string;
          output?: string;
          status:
            | "pending"
            | "claimed"
            | "executing"
            | "completed"
            | "failed"
            | "timeout";
          stderr?: string;
          targetHost?: string;
          targetPort?: number;
          targetType: "local" | "ssh";
          targetUsername?: string;
          timeoutMs: number;
          updatedAt: number;
        } | null
      >;
      listPending: FunctionReference<
        "query",
        "internal",
        { limit?: number; machineId: string },
        Array<{
          _id: string;
          command: string;
          createdAt: number;
          createdBy: string;
          machineId: string;
          status:
            | "pending"
            | "claimed"
            | "executing"
            | "completed"
            | "failed"
            | "timeout";
          targetHost?: string;
          targetPort?: number;
          targetType: "local" | "ssh";
          targetUsername?: string;
          timeoutMs: number;
        }>
      >;
      listRecent: FunctionReference<
        "query",
        "internal",
        { limit?: number; machineId: string },
        Array<{
          _id: string;
          command: string;
          completedAt?: number;
          createdAt: number;
          durationMs?: number;
          error?: string;
          exitCode?: number;
          machineId: string;
          status:
            | "pending"
            | "claimed"
            | "executing"
            | "completed"
            | "failed"
            | "timeout";
          targetType: "local" | "ssh";
        }>
      >;
      queue: FunctionReference<
        "mutation",
        "internal",
        {
          command: string;
          createdBy: string;
          machineId: string;
          targetHost?: string;
          targetPort?: number;
          targetType: "local" | "ssh";
          targetUsername?: string;
          timeoutMs?: number;
        },
        string
      >;
      startExecution: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        null
      >;
    };
    configPush: {
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
          _id: string;
          ackedAt?: number;
          createdAt: number;
          errorMessage?: string;
          payload: string;
          pushType: string;
          relayId: string;
          status: string;
        } | null
      >;
      listAll: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: string;
          createdAt: number;
          payload: string;
          pushType: string;
          relayId: string;
          status: string;
        }>
      >;
      queue: FunctionReference<
        "mutation",
        "internal",
        { payload: string; pushType: string; relayId: string },
        string
      >;
    };
    credentials: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          assignedRelays: Array<string>;
          credentialType: "ssh_key" | "password" | "api_key";
          encryptedValue: string;
          name: string;
          targetHost?: string;
        },
        string
      >;
      listAll: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: string;
          assignedRelays: Array<string>;
          createdAt: number;
          credentialType: "ssh_key" | "password" | "api_key";
          name: string;
          targetHost?: string;
          updatedAt: number;
        }>
      >;
      listByRelay: FunctionReference<
        "query",
        "internal",
        { relayId: string },
        Array<{
          _id: string;
          credentialName: string;
          credentialType: "ssh_key" | "password" | "api_key";
          lastUpdatedAt: number;
          relayId: string;
          reportedAt: number;
          storageMode: "relay_only" | "shared";
          targetHost?: string;
        }>
      >;
      remove: FunctionReference<"mutation", "internal", { id: string }, null>;
    };
    public: {
      acknowledgeConfigPush: FunctionReference<
        "mutation",
        "internal",
        { errorMessage?: string; pushId: string; success: boolean },
        { success: boolean }
      >;
      claimCommand: FunctionReference<
        "mutation",
        "internal",
        { assignmentId: string; commandId: string },
        | {
            command: {
              _id: string;
              command: string;
              targetHost?: string;
              targetPort?: number;
              targetType: "local" | "ssh";
              targetUsername?: string;
              timeoutMs: number;
            };
            success: true;
          }
        | { error: string; success: false }
      >;
      getPendingCommands: FunctionReference<
        "query",
        "internal",
        { machineId: string },
        Array<{
          _id: string;
          command: string;
          createdAt: number;
          targetHost?: string;
          targetPort?: number;
          targetType: "local" | "ssh";
          targetUsername?: string;
          timeoutMs: number;
        }>
      >;
      getPendingConfigPushes: FunctionReference<
        "query",
        "internal",
        { relayId: string },
        Array<{
          _id: string;
          createdAt: number;
          payload: string;
          pushType: string;
        }>
      >;
      getSharedCredentials: FunctionReference<
        "query",
        "internal",
        { relayId: string },
        Array<{
          credentialType: "ssh_key" | "password" | "api_key";
          encryptedValue: string;
          name: string;
          targetHost?: string;
          updatedAt: number;
        }>
      >;
      reportFullStatus: FunctionReference<
        "mutation",
        "internal",
        {
          capabilities: Array<"ssh" | "local_cmd" | "perf_metrics">;
          credentials: Array<{
            credentialName: string;
            credentialType: "ssh_key" | "password" | "api_key";
            lastUpdatedAt: number;
            storageMode: "relay_only" | "shared";
            targetHost?: string;
          }>;
          hostname?: string;
          metrics?: {
            cpuPercent?: number;
            diskPercent?: number;
            diskTotalGb?: number;
            diskUsedGb?: number;
            loadAvg15m?: number;
            loadAvg1m?: number;
            loadAvg5m?: number;
            memoryPercent?: number;
            memoryTotalMb?: number;
            memoryUsedMb?: number;
          };
          platform?: string;
          relayId: string;
          version?: string;
        },
        {
          pendingConfigPushes: number;
          sharedCredentialsCount: number;
          success: boolean;
        }
      >;
      sendHeartbeat: FunctionReference<
        "mutation",
        "internal",
        { apiKeyId: string },
        { success: boolean }
      >;
      submitResult: FunctionReference<
        "mutation",
        "internal",
        {
          commandId: string;
          durationMs?: number;
          error?: string;
          exitCode?: number;
          output?: string;
          stderr?: string;
          success: boolean;
        },
        { success: boolean }
      >;
      verifyRelay: FunctionReference<
        "query",
        "internal",
        { apiKeyId: string },
        | { assignmentId: string; machineId: string; name: string; valid: true }
        | { error: string; valid: false }
      >;
    };
    rpc: {
      getCommandResult: FunctionReference<
        "query",
        "internal",
        { commandId: string },
        | {
            durationMs?: number;
            error?: string;
            exitCode?: number;
            found: true;
            output?: string;
            status:
              | "pending"
              | "claimed"
              | "executing"
              | "completed"
              | "failed"
              | "timeout";
            stderr?: string;
          }
        | { found: false }
      >;
      queueRpcCommand: FunctionReference<
        "mutation",
        "internal",
        {
          command: string;
          createdBy: string;
          machineId: string;
          targetHost?: string;
          targetPort?: number;
          targetType: "local" | "ssh";
          targetUsername?: string;
          timeoutMs?: number;
        },
        { commandId?: string; error?: string; success: boolean }
      >;
    };
    status: {
      findByCapability: FunctionReference<
        "query",
        "internal",
        { capability: "ssh" | "local_cmd" | "perf_metrics" },
        Array<{
          capabilities: Array<"ssh" | "local_cmd" | "perf_metrics">;
          isOnline: boolean;
          lastHeartbeatAt: number;
          relayId: string;
        }>
      >;
      getByRelayId: FunctionReference<
        "query",
        "internal",
        { relayId: string },
        {
          _id: string;
          capabilities: Array<"ssh" | "local_cmd" | "perf_metrics">;
          createdAt: number;
          hostname?: string;
          lastHeartbeatAt: number;
          metrics?: {
            cpuPercent?: number;
            diskPercent?: number;
            diskTotalGb?: number;
            diskUsedGb?: number;
            loadAvg15m?: number;
            loadAvg1m?: number;
            loadAvg5m?: number;
            memoryPercent?: number;
            memoryTotalMb?: number;
            memoryUsedMb?: number;
          };
          platform?: string;
          relayId: string;
          updatedAt: number;
          version?: string;
        } | null
      >;
      listAll: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: string;
          capabilities: Array<"ssh" | "local_cmd" | "perf_metrics">;
          hostname?: string;
          isOnline: boolean;
          lastHeartbeatAt: number;
          metrics?: {
            cpuPercent?: number;
            diskPercent?: number;
            diskTotalGb?: number;
            diskUsedGb?: number;
            loadAvg15m?: number;
            loadAvg1m?: number;
            loadAvg5m?: number;
            memoryPercent?: number;
            memoryTotalMb?: number;
            memoryUsedMb?: number;
          };
          platform?: string;
          relayId: string;
          version?: string;
        }>
      >;
      reportStatus: FunctionReference<
        "mutation",
        "internal",
        {
          capabilities: Array<"ssh" | "local_cmd" | "perf_metrics">;
          hostname?: string;
          metrics?: {
            cpuPercent?: number;
            diskPercent?: number;
            diskTotalGb?: number;
            diskUsedGb?: number;
            loadAvg15m?: number;
            loadAvg1m?: number;
            loadAvg5m?: number;
            memoryPercent?: number;
            memoryTotalMb?: number;
            memoryUsedMb?: number;
          };
          platform?: string;
          relayId: string;
          version?: string;
        },
        { statusId?: string; success: boolean }
      >;
    };
  };
};
