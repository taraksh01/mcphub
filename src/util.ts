export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function isSessionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const err = e as Error & { code?: unknown };
  const code = err.code;
  const msg = err.message.toLowerCase();
  // StreamableHTTPError carries the HTTP status as `code` (e.g. 404 on an
  // expired/invalid session when POSTing to the MCP endpoint).
  if (code === 404) return true;
  // JSON-RPC -32000 "Server not initialized" — the server dropped the session.
  if (code === -32000 && /not initialized|session/i.test(msg)) return true;
  // Fallback for server messages that mention a lost/terminated session.
  if (/session (?:not found|invalid|expired|unknown|terminated|timeout)|invalid.*session/i.test(msg)) return true;
  return false;
}

export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else if (inDouble) {
      if (ch === "\\") {
        const next = input[i + 1];
        if (next === '"' || next === "\\") {
          current += next;
          i += 2;
          continue;
        }
        current += ch;
      } else if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
    i++;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}