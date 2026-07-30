import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { draftFromProject, readGitRemote, suggestSymbol } from "../src/draft.js";

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-fixture-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

describe("suggestSymbol", () => {
  it("uses initials for 3+ words", () => {
    expect(suggestSymbol("My Cool App")).toBe("MCA");
  });
  it("concatenates 2 words to 6 chars", () => {
    expect(suggestSymbol("vibe coin")).toBe("VIBECO");
  });
  it("slices a single word", () => {
    expect(suggestSymbol("solanaland")).toBe("SOLANA");
  });
  it("always matches ticker shape", () => {
    for (const n of ["x", "a b c d e f g h i", "---", "Ünïcode Náme"]) {
      expect(suggestSymbol(n)).toMatch(/^[A-Z0-9]{2,8}$/);
    }
  });
});

describe("readGitRemote", () => {
  it("normalizes ssh remotes", () => {
    const dir = makeRepo({
      ".git/config": `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:someuser/some-repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    });
    expect(readGitRemote(dir)).toBe("https://github.com/someuser/some-repo");
  });
  it("strips .git from https remotes", () => {
    const dir = makeRepo({
      ".git/config": `[remote "origin"]\n\turl = https://github.com/u/r.git\n`,
    });
    expect(readGitRemote(dir)).toBe("https://github.com/u/r");
  });
});

describe("draftFromProject", () => {
  it("drafts from a full repo", async () => {
    const dir = makeRepo({
      "README.md": `# Rocket Notes\n\n![badge](https://img.shields.io/x)\n\nA note-taking app that [syncs](https://example.com) your thoughts to the moon.\nBuilt with love.\n\n## Install\n`,
      "package.json": JSON.stringify({ name: "rocket-notes", description: "notes app", homepage: "https://rocketnotes.app" }),
      ".git/config": `[remote "origin"]\n\turl = https://github.com/u/rocket-notes.git\n`,
      "logo.png": "fakepng",
    });
    const d = await draftFromProject(dir);
    expect(d.name).toBe("Rocket Notes");
    expect(d.symbol).toBe("ROCKET");
    expect(d.description).toContain("note-taking app");
    expect(d.description).toContain("syncs");
    expect(d.description).not.toContain("](");
    expect(d.website).toBe("https://rocketnotes.app");
    expect(d.github).toBe("https://github.com/u/rocket-notes");
    expect(d.imageSource).toBe("repo");
    expect(d.imagePath).toBe(path.join(dir, "logo.png"));
    expect(d.sources).toContain("README.md");
  });

  it("falls back gracefully on a bare directory", async () => {
    const dir = makeRepo({});
    const d = await draftFromProject(dir);
    expect(d.name.length).toBeGreaterThan(0);
    expect(d.symbol).toMatch(/^[A-Z0-9]{2,8}$/);
    expect(d.description).toContain("vibecoin");
    expect(d.imageSource).toBe("placeholder");
    expect(d.imagePath).toMatch(/placeholder-[0-3]\.png$/);
  });
});
