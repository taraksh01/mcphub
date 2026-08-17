import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const RC_FILES = [".bashrc", ".zshrc", ".profile"];

export function parseExport(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("export ")) return null;
  const rest = trimmed.slice(7).trim();
  const eq = rest.indexOf("=");
  if (eq <= 0) return null;
  const key = rest.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = rest.slice(eq + 1).trim();

  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return [key, value.slice(1, -1)];
  }

  const hash = value.indexOf(" #");
  if (hash !== -1) value = value.slice(0, hash).trim();

  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return [key, value.slice(1, -1)];
  }

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    const inner = value.slice(1, -1);
    const expanded = inner
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v: string) => process.env[v] ?? "")
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, v: string) => process.env[v] ?? "");
    return [key, expanded];
  }

  value = value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v: string) => process.env[v] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, v: string) => process.env[v] ?? "");
  return [key, value];
}

export function loadShellEnv(overwrite = false): void {
  const home = homedir();
  for (const file of RC_FILES) {
    const path = join(home, file);
    if (!existsSync(path)) continue;
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const parsed = parseExport(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (overwrite || process.env[key] === undefined) process.env[key] = value;
    }
  }
}