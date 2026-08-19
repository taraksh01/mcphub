import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { homedir, platform } from "os";
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

export function installService(config: ConfigManager, pinVersion = false): void {
  const plat = platform();
  if (plat === "linux") {
    installLinux(config, pinVersion);
  } else if (plat === "darwin") {
    installMacOS(config, pinVersion);
  } else if (plat === "win32") {
    installWindows(config, pinVersion);
  } else {
    console.error(`Unsupported platform: ${plat}`);
    process.exit(1);
  }
}

export function uninstallService(): void {
  const plat = platform();
  if (plat === "linux") {
    uninstallLinux();
  } else if (plat === "darwin") {
    uninstallMacOS();
  } else if (plat === "win32") {
    uninstallWindows();
  } else {
    console.error(`Unsupported platform: ${plat}`);
    process.exit(1);
  }
}

function installLinux(config: ConfigManager, pinVersion = false): void {
  const args = serviceArgs(config, pinVersion);
  const user = process.env.USER || "root";
  const path = process.env.PATH || DEFAULT_PATH;
  const execStart = args.join(" ");
  const unit = `[Unit]
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
  try {
    writeFileSync("/etc/systemd/system/mcphub.service", unit);
  } catch {
    console.error("Could not write systemd service file. Run as root.");
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

function uninstallLinux(): void {
  try {
    execSync(`systemctl stop mcphub 2>/dev/null; systemctl disable mcphub 2>/dev/null; rm -f /etc/systemd/system/mcphub.service`, { stdio: "ignore" });
    console.log("Linux service uninstalled");
  } catch {
    console.log("Could not uninstall Linux service");
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