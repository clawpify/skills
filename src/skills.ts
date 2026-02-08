import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load all skill files from the clawpify skills directory.
 * Works both locally and when installed as an npm package.
 *
 * Optionally provide a custom directory path to load skills from.
 *
 * @deprecated Use `loadSkillMetadata()` for the system prompt and
 * `loadSkillReference(name)` to load individual references on demand.
 */
export async function loadSkills(customDir?: string): Promise<string> {
  const baseDir =
    customDir ??
    join(fileURLToPath(import.meta.url), "..", "..", "clawpify");

  const skillParts: string[] = [];
  await collectMarkdown(baseDir, skillParts);

  return skillParts.join("\n\n---\n\n");
}

/**
 * Load only the SKILL.md metadata file (Level 1+2).
 * Use this for the system prompt instead of `loadSkills()` to keep context small.
 */
export async function loadSkillMetadata(
  customDir?: string
): Promise<string> {
  const baseDir =
    customDir ??
    join(fileURLToPath(import.meta.url), "..", "..", "clawpify");
  const skillPath = join(baseDir, "SKILL.md");
  return readFile(skillPath, "utf-8");
}

/**
 * Load a specific reference file on demand (Level 3).
 * Returns the content of `clawpify/references/{name}.md`.
 */
export async function loadSkillReference(
  name: string,
  customDir?: string
): Promise<string> {
  const baseDir =
    customDir ??
    join(fileURLToPath(import.meta.url), "..", "..", "clawpify");
  const refPath = join(
    baseDir,
    "references",
    name.endsWith(".md") ? name : `${name}.md`
  );
  return readFile(refPath, "utf-8");
}

/**
 * List available reference file names (without the `.md` extension).
 */
export async function listSkillReferences(
  customDir?: string
): Promise<string[]> {
  const baseDir =
    customDir ??
    join(fileURLToPath(import.meta.url), "..", "..", "clawpify");
  const refDir = join(baseDir, "references");
  const entries = await readdir(refDir);
  return entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(".md", ""));
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
