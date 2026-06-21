import { v5 as uuidv5 } from "uuid";

// Stable namespace UUID for deterministic generation
const CLERK_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // Standard UUID Namespace DNS

/**
 * Converts a Clerk ID (e.g., 'user_2N7...' or 'org_2N8...') to a deterministic UUID v5.
 */
export function toUUID(clerkId: string): string {
  if (!clerkId) {
    throw new Error("clerkId is required to generate UUID");
  }
  return uuidv5(clerkId, CLERK_NAMESPACE);
}
