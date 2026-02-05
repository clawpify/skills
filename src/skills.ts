import { Glob } from "bun";
import { join } from "path";

/**
 * Load all skill files from the skills/clawpify directory
 * Works both locally and when installed as an npm package
 */
export async function loadSkills(): Promise<string> {
  // When running locally, skills are in ../skills/clawpify from src/
  // When installed as npm package, skills are in ../skills/clawpify from node_modules/clawpify/src/
  const skillsDir = join(import.meta.dir, "..", "skills", "clawpify");
  
  const glob = new Glob("*.md");
  const skillParts: string[] = [];

  for await (const file of glob.scan(skillsDir)) {
    const content = await Bun.file(join(skillsDir, file)).text();
    skillParts.push(content);
  }

  return skillParts.join("\n\n---\n\n");
}
