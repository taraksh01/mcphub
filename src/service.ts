import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { ConfigManager } from "./config.js";

const LABEL = "com.mcphub";

const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Build the `mcphub start ...` argument list (without the binary itself).
 * The binary is resolved at service RUNTIME via a shell wrapper, so updating
 * the package does not require re-running `install-service`.
 */
function startArgs(config: ConfigManager): string[] {
  const cfg = config.get();
  const port = cfg.port ?? 5431;
  return ["start", "--port", String(port), "--config", config.getConfigPath()];
}

export function installService(config: ConfigManager): void {
  const plat = platform();
  if (plat === "linux") {
    installLinux(config);
  } else if (plat === "darwin") {
    installMacOS(config);
  } else if (plat === "win32") {
    installWindows(config);
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

const SYSTEMD_PATH = "/etc/systemd/system/mcphub.service";

function installLinux(config: ConfigManager): void {
  const args = startArgs(config);
  const user = process.env.USER || "root";
  const path = process.env.PATH || DEFAULT_PATH;
  // Resolve `mcphub` at runtime so package updates are picked up automatically.
  const execStart = `/bin/sh -c 'exec "$(command -v mcphub)" ${args.map((a) => `"${a}"`).join(" ")}'`;
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
    writeFileSync(SYSTEMD_PATH, unit);
  } catch {
    const tmp = "/tmp/mcphub.service";
    writeFileSync(tmp, unit);
    try {
      execSync(`sudo cp ${tmp} ${SYSTEMD_PATH}`, { stdio: "inherit" });
    } catch {
      console.error("Could not write to /etc/systemd/system/. To install manually:\n");
      console.error(`  sudo cp ${tmp} ${SYSTEMD_PATH}`);
      console.error("  sudo systemctl daemon-reload");
      console.error("  sudo systemctl enable mcphub");
      console.error("  sudo systemctl start mcphub");
      process.exit(1);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
  }
  try {
    // Stop any crash-looping instance before reconfiguring
    execSync("sudo systemctl stop mcphub 2>/dev/null", { stdio: "ignore" });
    execSync("sudo systemctl daemon-reload", { stdio: "inherit" });
    execSync("sudo systemctl enable mcphub", { stdio: "inherit" });
    execSync("sudo systemctl start mcphub", { stdio: "inherit" });
    console.log("Service installed and started");
  } catch (e) {
    console.error("Service file written but failed to start:", String(e));
    console.error("Run: sudo systemctl daemon-reload && sudo systemctl enable mcphub && sudo systemctl start mcphub");
    process.exit(1);
  }
}

function uninstallLinux(): void {
  try {
    execSync("sudo systemctl stop mcphub 2>/dev/null", { stdio: "ignore" });
    execSync("sudo systemctl disable mcphub 2>/dev/null", { stdio: "ignore" });
    try {
      unlinkSync(SYSTEMD_PATH);
    } catch {
      execSync(`sudo rm ${SYSTEMD_PATH}`, { stdio: "inherit" });
    }
    execSync("sudo systemctl daemon-reload", { stdio: "inherit" });
    console.log("Service removed");
  } catch {
    console.log("Service not installed or could not be removed");
  }
}

const LAUNCHD_PATH = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(homedir(), "Library/Logs");
const LOG_PATH = join(LOG_DIR, "mcphub.log");

function installMacOS(config: ConfigManager): void {
  const args = startArgs(config);
  // Ensure log directory exists
  if (!existsSync(LOG_DIR)) {
    execSync(`mkdir -p "${LOG_DIR}"`, { stdio: "ignore" });
  }
  // Resolve `mcphub` at runtime so package updates are picked up automatically.
  const execCmd = `exec "$(command -v mcphub)" ${args.map((a) => `"${a}"`).join(" ")}`;
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
  try {
    writeFileSync(LAUNCHD_PATH, plist);
  } catch (e) {
    console.error("Failed to write launchd plist:", String(e));
    console.error(`Tried to write to: ${LAUNCHD_PATH}`);
    process.exit(1);
  }
  // Unload existing service first (ignore errors if not loaded)
  execSync(`launchctl bootout gui/$(id -u) ${LAUNCHD_PATH} 2>/dev/null`, { stdio: "ignore" });
  try {
    execSync(`launchctl bootstrap gui/$(id -u) ${LAUNCHD_PATH}`, { stdio: "inherit" });
  } catch {
    try {
      execSync(`launchctl load ${LAUNCHD_PATH}`, { stdio: "inherit" });
    } catch (e) {
      console.error("Failed to load launchd service:", String(e));
      console.error("Try manually: launchctl load " + LAUNCHD_PATH);
      process.exit(1);
    }
  }
  console.log("Service installed and loaded");
}

function uninstallMacOS(): void {
  if (!existsSync(LAUNCHD_PATH)) {
    console.log("Service not installed");
    return;
  }
  try {
    execSync(`launchctl bootout gui/$(id -u) ${LAUNCHD_PATH}`, { stdio: "ignore" });
  } catch {
    execSync(`launchctl unload ${LAUNCHD_PATH}`, { stdio: "ignore" });
  }
  unlinkSync(LAUNCHD_PATH);
  console.log("Service removed");
}

const TASK_NAME = "MCPHub";

function installWindows(config: ConfigManager): void {
  const args = startArgs(config);
  // Resolve `mcphub` at runtime via `where` so package updates are picked up.
  // `for /f "delims="` keeps the full path; `exit /b` runs only the first match.
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
    process.exit(1);
  }
}

function uninstallWindows(): void {
  const cmd = `schtasks /delete /tn "${TASK_NAME}" /f`;
  try {
    execSync(cmd, { stdio: "inherit" });
    console.log("Service removed");
  } catch {
    console.log("Service not installed");
  }
}
