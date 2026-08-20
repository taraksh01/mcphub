import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir, platform, tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { ConfigManager } from "./config.js";

const LABEL = "com.mcphub";

const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Get the pnpm bin path for auto-update mode.
 */
function getPnpmBinPath(): string {
  return join(homedir(), ".local", "share", "pnpm", "bin", "mcphub");
}

/**
 * Get the script path for pin-version mode.
 */
function getScriptPath(): string {
  return resolve(process.argv[1]);
}

/**
 * Resolve the node binary path at install time.
 * This ensures the service uses the correct node executable.
 */
function nodeBin(): string {
  return process.execPath;
}

function serviceArgs(config: ConfigManager, pinVersion = false): string[] {
  const cfg = config.get();
  const port = cfg.port ?? 5431;

  if (pinVersion) {
    // Pin to exact version using node binary + script path
    const args = [nodeBin(), getScriptPath(), "start", "--port", String(port)];
    args.push("--config", config.getConfigPath());
    return args;
  }

  // Default: use pnpm shim (auto-updates on version bump)
  const args = [getPnpmBinPath(), "start", "--port", String(port)];
  args.push("--config", config.getConfigPath());
  return args;
}

export function installService(config: ConfigManager, pinVersion = false, system = false): void {
  const plat = platform();
  if (plat === "linux") {
    installLinux(config, pinVersion, system);
  } else if (plat === "darwin") {
    installMacOS(config, pinVersion);
  } else if (plat === "win32") {
    installWindows(config, pinVersion);
  } else {
    console.error(`Unsupported platform: ${plat}`);
    process.exit(1);
  }
}

export function uninstallService(system = false): void {
  const plat = platform();
  if (plat === "linux") {
    uninstallLinux(system);
  } else if (plat === "darwin") {
    uninstallMacOS();
  } else if (plat === "win32") {
    uninstallWindows();
  } else {
    console.error(`Unsupported platform: ${plat}`);
    process.exit(1);
  }
}

/**
 * Returns the "sudo " prefix when the current user is not root (POSIX only).
 * On Windows or when already root, returns an empty string so the same
 * command works without privilege escalation.
 */
function sudoPrefix(): string {
  if (typeof process.getuid === "function" && process.getuid() === 0) return "";
  return "sudo ";
}

function installLinux(config: ConfigManager, pinVersion = false, system = false): void {
  const args = serviceArgs(config, pinVersion);
  const execStart = args.join(" ");
  const path = process.env.PATH || DEFAULT_PATH;

  let unit: string;
  let unitPath: string;
  let reloadCmd: string;
  let startCmd: string;

  if (system) {
    // System-wide: requires root. Runs as the invoking user via User=.
    const user = process.env.USER || "root";
    unit = `[Unit]
Description=MCP Hub
After=network.target

[Service]
Type=simple
User=${user}
Environment=PATH=${path}
ExecStart=${execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
    unitPath = "/etc/systemd/system/mcphub.service";
    reloadCmd = "systemctl daemon-reload";
    startCmd = "systemctl enable --now mcphub";
  } else {
    // Per-user: no root required. Runs in the user session.
    unit = `[Unit]
Description=MCP Hub
After=network.target

[Service]
Type=simple
Environment=PATH=${path}
ExecStart=${execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
    unitPath = join(homedir(), ".config", "systemd", "user", "mcphub.service");
    reloadCmd = "systemctl --user daemon-reload";
    startCmd = "systemctl --user enable --now mcphub";
  }

  try {
    if (system) {
      const tmp = join(tmpdir(), "mcphub.service");
      writeFileSync(tmp, unit);
      const sudo = sudoPrefix();
      execSync(`${sudo}cp "${tmp}" "${unitPath}"`, { stdio: "ignore" });
      execSync(`${sudo}${reloadCmd}`, { stdio: "ignore" });
      execSync(`${sudo}${startCmd}`, { stdio: "inherit" });
      console.log("System-wide systemd service installed.");
    } else {
      mkdirSync(dirname(unitPath), { recursive: true });
      writeFileSync(unitPath, unit);
      execSync(reloadCmd, { stdio: "ignore" });
      execSync(startCmd, { stdio: "inherit" });
      console.log("User systemd service installed.");
      console.log("Starts at login. For boot-without-login: loginctl enable-linger $USER");
    }
  } catch {
    console.error(`Could not install systemd service${system ? " (try running with sudo)" : ""}.`);
  }
}

function installMacOS(config: ConfigManager, pinVersion = false): void {
  const args = serviceArgs(config, pinVersion);
  // Ensure log directory exists
  const LOG_DIR = join(homedir(), "Library/Logs");
  const LOG_PATH = join(LOG_DIR, "mcphub.log");
  if (!existsSync(LOG_DIR)) {
    execSync(`mkdir -p "${LOG_DIR}"`, { stdio: "ignore" });
  }
  const execCmd = args.join(" ");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${execCmd}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH || DEFAULT_PATH}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
`;
  const LAUNCHD_PATH = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
  try {
    mkdirSync(dirname(LAUNCHD_PATH), { recursive: true });
    writeFileSync(LAUNCHD_PATH, plist);
    execSync(`launchctl load "${LAUNCHD_PATH}"`, { stdio: "ignore" });
    console.log("MacOS service installed");
  } catch {
    console.error("Could not install MacOS service");
  }
}

function installWindows(config: ConfigManager, pinVersion = false): void {
  const args = serviceArgs(config, pinVersion);
  // Resolve mcphub at runtime via where so package updates are picked up.
  // Each argument is double-quoted; the outer quotes are escaped as \" for schtasks.
  const quotedArgs = args.map((a) => `"${a}"`).join(" ");
  const inner = `for /f \\"delims=\\" %i in ('where mcphub 2^>nul') do @\\"%i\\" ${quotedArgs} & exit /b`;
  const trArg = `cmd /c \\"${inner}\\"`;
  const cmd = `schtasks /create /tn "${TASK_NAME}" /tr "${trArg}" /sc onstart /ru "%USERNAME%" /f`;
  try {
    execSync(cmd, { stdio: "inherit" });
    console.log("Service installed (starts on next boot)");
    console.log('Start now with: schtasks /run /tn "MCPHub"');
  } catch {
    console.log("Could not install. Run as Administrator:");
    console.log(`  ${cmd}`);
  }
}

const TASK_NAME = "MCPHub";

function uninstallLinux(system = false): void {
  const sudo = sudoPrefix();
  if (system) {
    const cmd = `${sudo}systemctl stop mcphub 2>/dev/null; ${sudo}systemctl disable mcphub 2>/dev/null; ${sudo}rm -f /etc/systemd/system/mcphub.service; ${sudo}systemctl daemon-reload`;
    try {
      execSync(cmd, { stdio: "ignore" });
      console.log("System-wide systemd service uninstalled");
    } catch {
      console.log("Could not uninstall system-wide systemd service");
    }
  } else {
    const unitPath = join(homedir(), ".config", "systemd", "user", "mcphub.service");
    const cmd = `systemctl --user stop mcphub 2>/dev/null; systemctl --user disable mcphub 2>/dev/null; rm -f "${unitPath}"; systemctl --user daemon-reload`;
    try {
      execSync(cmd, { stdio: "ignore" });
      console.log("User systemd service uninstalled");
    } catch {
      console.log("Could not uninstall user systemd service");
    }
  }
}

function uninstallMacOS(): void {
  const LAUNCHD_PATH = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
  try {
    execSync(`launchctl unload "${LAUNCHD_PATH}" 2>/dev/null; rm -f "${LAUNCHD_PATH}"`, { stdio: "ignore" });
    console.log("MacOS service uninstalled");
  } catch {
    console.log("Could not uninstall MacOS service");
  }
}

function uninstallWindows(): void {
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f 2>nul`, { stdio: "ignore" });
    console.log("Windows service uninstalled");
  } catch {
    console.log("Could not uninstall Windows service");
  }
}