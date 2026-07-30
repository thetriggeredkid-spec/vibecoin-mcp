import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TokenDraft {
  name: string;
  symbol: string;
  description: string;
  website?: string;
  github?: string;
  imagePath?: string;
  imageSource: "repo" | "placeholder";
  sources: string[];
}

const IMAGE_CANDIDATES = [
  "logo.png",
  "logo.jpg",
  "logo.jpeg",
  "logo.webp",
  "icon.png",
  "assets/logo.png",
  "images/logo.png",
  "public/logo.png",
  "public/icon.png",
  "public/apple-touch-icon.png",
];

export function suggestSymbol(name: string): string {
  const words = name
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0);
  let sym: string;
  if (words.length === 0) sym = "COIN";
  else if (words.length >= 3) sym = words.slice(0, 8).map((w) => w[0]).join("");
  else if (words.length === 2) sym = (words[0] + words[1]).slice(0, 6);
  else sym = words[0].slice(0, 6);
  sym = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (sym.length < 2) sym = (sym + "COIN").slice(0, 4);
  return sym;
}

function titleCase(kebab: string): string {
  return kebab
    .replace(/^@[^/]+\//, "")
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function parseReadme(cwd: string): { title?: string; paragraph?: string; file?: string } {
  const candidates = ["README.md", "readme.md", "Readme.md"];
  for (const f of candidates) {
    const p = path.join(cwd, f);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    const lines = raw.split(/\r?\n/);
    let title: string | undefined;
    let paragraph: string | undefined;
    let buf: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!title) {
        const m = t.match(/^#\s+(.+)$/);
        if (m) title = m[1].replace(/[#*`]/g, "").trim();
        continue;
      }
      const isNoise =
        t === "" ||
        t.startsWith("#") ||
        t.startsWith("![") ||
        t.startsWith("[!") ||
        t.startsWith("<") ||
        t.startsWith("```") ||
        t.startsWith("---") ||
        t.startsWith("|");
      if (isNoise) {
        if (buf.length > 0) break;
        continue;
      }
      buf.push(t);
      if (buf.join(" ").length > 400) break;
    }
    if (buf.length > 0) {
      paragraph = buf
        .join(" ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim()
        .slice(0, 500);
    }
    return { title, paragraph, file: f };
  }
  return {};
}

export function readGitRemote(cwd: string): string | undefined {
  const cfg = path.join(cwd, ".git", "config");
  if (!fs.existsSync(cfg)) return undefined;
  const raw = fs.readFileSync(cfg, "utf8");
  const originBlock = raw.split(/\[remote "origin"\]/)[1];
  if (!originBlock) return undefined;
  const m = originBlock.match(/url\s*=\s*(\S+)/);
  if (!m) return undefined;
  let url = m[1];
  const ssh = url.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`;
  url = url.replace(/\.git$/, "");
  return url.startsWith("http") ? url : undefined;
}

export function placeholderImagePath(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const idx = crypto.createHash("sha256").update(name).digest()[0] % 4;
  return path.join(here, "..", "assets", `placeholder-${idx}.png`);
}

export async function draftFromProject(cwd: string): Promise<TokenDraft> {
  const sources: string[] = [];
  const readme = parseReadme(cwd);
  if (readme.file) sources.push(readme.file);

  let pkg: { name?: string; description?: string; homepage?: string } = {};
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      sources.push("package.json");
    } catch {
      // unparseable package.json is not fatal to a draft
    }
  }

  const github = readGitRemote(cwd);
  if (github) sources.push(".git/config");

  const name =
    readme.title ??
    (pkg.name ? titleCase(pkg.name) : undefined) ??
    titleCase(path.basename(cwd));

  const description =
    readme.paragraph ??
    pkg.description ??
    "Launched from a Claude Code session with vibecoin.";

  let imagePath: string | undefined;
  let imageSource: TokenDraft["imageSource"] = "placeholder";
  for (const candidate of IMAGE_CANDIDATES) {
    const p = path.join(cwd, candidate);
    if (fs.existsSync(p)) {
      imagePath = p;
      imageSource = "repo";
      sources.push(candidate);
      break;
    }
  }
  if (!imagePath) imagePath = placeholderImagePath(name);

  return {
    name: name.slice(0, 32),
    symbol: suggestSymbol(name),
    description,
    website: pkg.homepage,
    github,
    imagePath,
    imageSource,
    sources,
  };
}
