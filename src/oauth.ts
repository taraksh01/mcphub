import { randomBytes } from "crypto";
import { createServer, type Server } from "http";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const CALLBACK_PORT = 8765;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_DIR = join(homedir(), ".config", "mcphub", "tokens");

export class McphubOAuthProvider implements OAuthClientProvider {
  private tokensState: OAuthTokens | null = null;
  private discoveryCache: OAuthDiscoveryState | null = null;
  private clientInfo: OAuthClientInformationMixed | null = null;
  private codeVerifierValue: string | null = null;
  private stateValue: string | null = null;

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
  ) {
    this.tokensState = this.readJson<OAuthTokens>(this.tokenPath());
    this.discoveryCache = this.readJson<OAuthDiscoveryState>(this.discoveryPath());
    this.clientInfo = this.readJson<OAuthClientInformationMixed>(this.clientInfoPath());
  }

  get redirectUrl(): string {
    return CALLBACK_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `mcphub-${this.serverName}`,
      redirect_uris: [CALLBACK_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  state(): string {
    if (!this.stateValue) this.stateValue = randomBytes(16).toString("hex");
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo ?? undefined;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.clientInfo = info;
    this.persist(this.clientInfoPath(), info);
  }

  tokens(): OAuthTokens | undefined {
    return this.tokensState ?? undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokensState = tokens;
    this.persist(this.tokenPath(), tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const { default: open } = await import("open");
    await open(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.codeVerifierValue = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this.codeVerifierValue) this.codeVerifierValue = randomBytes(32).toString("base64url");
    return this.codeVerifierValue;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discoveryCache ?? undefined;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discoveryCache = state;
    this.persist(this.discoveryPath(), state);
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") this.clientInfo = null;
    if (scope === "all" || scope === "tokens") {
      this.tokensState = null;
      this.persist(this.tokenPath(), null);
    }
    if (scope === "all" || scope === "verifier") this.codeVerifierValue = null;
    if (scope === "all" || scope === "discovery") this.discoveryCache = null;
  }

  async startAuthFlow(): Promise<OAuthTokens> {
    const server = createServer(() => {});
    const callbackPromise = this.waitForCallback(server);
    callbackPromise.catch(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(CALLBACK_PORT, resolve);
    });
    try {
      const first = await auth(this, { serverUrl: this.serverUrl });
      if (first === "AUTHORIZED") {
        return this.requireTokens();
      }
      const code = await callbackPromise;
      const second = await auth(this, { serverUrl: this.serverUrl, authorizationCode: code });
      if (second !== "AUTHORIZED") {
        throw new Error("Authorization did not complete");
      }
      return this.requireTokens();
    } finally {
      server.close();
    }
  }

  private requireTokens(): OAuthTokens {
    const tokens = this.tokensState;
    if (!tokens) throw new Error("No tokens after authorization");
    return tokens;
  }

  private waitForCallback(server: Server): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error("Timed out waiting for authorization callback"));
      }, CALLBACK_TIMEOUT_MS);
      server.on("close", () => clearTimeout(timeout));
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", CALLBACK_URL);
        if (url.pathname !== "/callback") return;
        clearTimeout(timeout);
        server.close();
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        if (error) {
          res.end(`Authorization failed: ${error}`);
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }
        if (!code) {
          res.end("Authorization failed: no code in callback");
          reject(new Error("Authorization failed: no code in callback"));
          return;
        }
        res.end("Authorization complete! You can close this tab.");
        resolve(code);
      });
    });
  }

  private tokenPath(): string {
    return join(TOKEN_DIR, `${this.serverName}.json`);
  }

  private discoveryPath(): string {
    return join(TOKEN_DIR, `${this.serverName}.discovery.json`);
  }

  private clientInfoPath(): string {
    return join(TOKEN_DIR, `${this.serverName}.client.json`);
  }

  private readJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    } catch {
      return null;
    }
  }

  private persist(path: string, data: unknown): void {
    mkdirSync(TOKEN_DIR, { recursive: true });
    if (data === null) {
      rmSync(path, { force: true });
    } else {
      writeFileSync(path, JSON.stringify(data, null, 2));
    }
  }
}

export { McphubOAuthProvider as OAuthClientProvider };
