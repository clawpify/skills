import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load all skill files from the clawpify skills directory.
 * Works both locally and when installed as an npm package.
 *
 * Optionally provide a custom directory path to load skills from.
 */
export async function loadSkills(customDir?: string): Promise<string> {
  const baseDir =
    customDir ??
    join(fileURLToPath(import.meta.url), "..", "..", "clawpify");

  const skillParts: string[] = [];
  await collectMarkdown(baseDir, skillParts);

  return skillParts.join("\n\n---\n\n");
}

async function collectMarkdown(
  dir: string,
  parts: string[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(fullPath, parts);
    } else if (entry.name.endsWith(".md")) {
      const content = await readFile(fullPath, "utf-8");
      parts.push(content);
    }
  }
}
