import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL(".", import.meta.resolve("#zerion")));
const skillsDir = join(ROOT, "skills");

const EXPECTED_SKILLS = ["wallet-analysis", "wallet-trading", "chains", "zerion"];

const REQUIRED_FRONTMATTER = ["name", "description", "license", "allowed-tools"];

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const fields = {};
  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1 || line.startsWith(" ") || line.startsWith("\t")) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    fields[key] = value;
  }
  return { raw: yaml, fields };
}

describe("skills directory", () => {
  it("has all expected skill directories", () => {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of EXPECTED_SKILLS) {
      assert.ok(dirs.includes(name), `Missing skill directory: ${name}`);
    }
  });

  for (const skill of EXPECTED_SKILLS) {
    describe(skill, () => {
      const skillDir = join(skillsDir, skill);

      it("has SKILL.md", () => {
        assert.ok(existsSync(join(skillDir, "SKILL.md")));
      });

      it("has LICENSE.txt", () => {
        assert.ok(existsSync(join(skillDir, "LICENSE.txt")));
      });

      it("SKILL.md has valid frontmatter with required fields", () => {
        const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
        const fm = parseSkillFrontmatter(content);
        assert.ok(fm, "SKILL.md must have YAML frontmatter");
        for (const field of REQUIRED_FRONTMATTER) {
          assert.ok(fm.fields[field], `Missing frontmatter field: ${field}`);
        }
      });

      it("frontmatter name matches directory name", () => {
        const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
        const fm = parseSkillFrontmatter(content);
        assert.equal(fm.fields.name, skill);
      });

      it("frontmatter declares zerion as openclaw dependency", () => {
        const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
        assert.ok(
          content.includes('package: "zerion"'),
          "Must declare zerion as openclaw install package"
        );
      });
    });
  }
});

describe("wallet-analysis extras", () => {
  it("has EXAMPLES.md", () => {
    assert.ok(existsSync(join(skillsDir, "wallet-analysis", "EXAMPLES.md")));
  });

  it("EXAMPLES.md contains example wallet addresses", () => {
    const content = readFileSync(
      join(skillsDir, "wallet-analysis", "EXAMPLES.md"),
      "utf8"
    );
    assert.match(content, /0x[a-fA-F0-9]{40}/);
  });

  it("documents ENS names as supported input", () => {
    const content = readFileSync(
      join(skillsDir, "wallet-analysis", "SKILL.md"),
      "utf8"
    );
    assert.match(content, /ENS names.*also work/i);
    assert.doesNotMatch(content, /ENS names are not currently supported/i);
  });
});

describe("skill guidance consistency", () => {
  it("documents WALLET_PRIVATE_KEY for x402 in zerion skill", () => {
    const content = readFileSync(join(skillsDir, "zerion", "SKILL.md"), "utf8");
    assert.match(content, /WALLET_PRIVATE_KEY/);
  });

  it("does not claim wallet commands accept more chains than the CLI validator", () => {
    const content = readFileSync(join(skillsDir, "chains", "SKILL.md"), "utf8");
    assert.match(content, /currently accepted by the wallet commands/i);
    assert.doesNotMatch(content, /50\+\s+chains are supported/i);
  });
});
