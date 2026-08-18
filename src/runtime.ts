import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";

const RUNTIME_FILE = "hub.runtime.json";

export interface RuntimeInfo {
  port: number;
  host: string;
}

function runtimeFile(baseDir?: string): string {
  return join(baseDir ?? process.cwd(), RUNTIME_FILE);
}

export function readRuntime(baseDir?: string): RuntimeInfo | null {
  try {
    return JSON.parse(readFileSync(runtimeFile(baseDir), "utf-8")) as RuntimeInfo;
  } catch {
    return null;
  }
}

export function writeRuntime(port: number, host: string, baseDir?: string): void {
  mkdirSync(dirname(runtimeFile(baseDir)), { recursive: true });
  writeFileSync(runtimeFile(baseDir), JSON.stringify({ port, host }));
}

export function removeRuntime(baseDir?: string): void {
  const f = runtimeFile(baseDir);
  if (existsSync(f)) unlinkSync(f);
}
