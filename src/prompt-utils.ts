/** Max characters allowed for heartbeat content to prevent context bloat. */
export const MAX_HEARTBEAT_CHARS = 2000;

/** Max characters allowed for memory content to prevent context bloat. */
export const MAX_MEMORY_CHARS = 4000;

/** Clamp content to a max character count, appending a truncation marker. */
export function clampContent(content: string, maxChars: number): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd() + "\n...[truncated]";
}
