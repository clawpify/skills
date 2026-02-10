/** Result of loadWithStatus() — distinguishes empty history from a storage error. */
export interface LoadResult {
  history: any[];
  error: boolean;
}

/**
 * Interface for persisting conversation history across sessions.
 * Implement this interface to plug in any storage backend (Redis, SQLite, etc.).
 *
 * History is stored as raw MessageParam arrays — the same type the agent
 * accepts and returns — so round-tripping is lossless.
 */
export interface MemoryStore {
  /** Save conversation history for a session. */
  save(sessionId: string, history: any[]): Promise<void>;

  /** Load conversation history for a session. Returns empty array if not found. */
  load(sessionId: string): Promise<any[]>;

  /** Clear conversation history for a session. */
  clear(sessionId: string): Promise<void>;

  /** Optional: load with error status for callers that need to distinguish empty from failed. */
  loadWithStatus?(sessionId: string): Promise<LoadResult>;
}

/**
 * Simple in-memory implementation of MemoryStore.
 * Data is lost when the process restarts — use for dev/testing only.
 */
export class InMemoryStore implements MemoryStore {
  private store = new Map<string, any[]>();

  async save(sessionId: string, history: any[]): Promise<void> {
    this.store.set(sessionId, structuredClone(history));
  }

  async load(sessionId: string): Promise<any[]> {
    const data = this.store.get(sessionId);
    return data ? structuredClone(data) : [];
  }

  async clear(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async loadWithStatus(sessionId: string): Promise<LoadResult> {
    return { history: await this.load(sessionId), error: false };
  }
}
