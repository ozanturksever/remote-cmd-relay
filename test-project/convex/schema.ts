import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Table for mapping raw test API keys to their Better Auth key IDs
  // This allows test verification to bypass Better Auth's Scrypt hashing
  testApiKeyMappings: defineTable({
    rawKey: v.string(),
    keyId: v.string(),
    createdAt: v.number(),
  }).index("by_rawKey", ["rawKey"]),
});
