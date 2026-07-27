import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { homedir, platform } from "os";
import { join, resolve } from "path";
import { ConfigManager } from "./config.js";

const LABEL = "com.mcphub";

function nodeBin(): string {
  return process.execPath;
}

function scriptPath(): string {
  return resolve(process.argv[1]);
}

function serviceArgs(config: ConfigManager): string[] {
  const cfg = config.get();
  const port = cfg.port ?? 5431;
  const args = [nodeBin(), scriptPath(), "start", "--port", String(port)];
  return args;
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

export function uninstallService(config: ConfigManager): void {
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

// ─── Linux (systemd) ──────────────────────────────────────────────

const SYSTEMD_PATH = "/etc/systemd/system/mcphub.service";

function installLinux(config: ConfigManager): void {
  const args = serviceArgs(config);
  const user = process.env.USER || "root";
  const unit = `[Unit]
Description=MCP Hub
After=network.target

[Service]
Type=simple
User=${user}
ExecStart=${args.join(" ")}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  try {
    writeFileSync(SYSTEMD_PATH, unit);
    execSync("systemctl daemon-reload", { stdio: "inherit" });
    execSync("systemctl enable mcphub", { stdio: "inherit" });
    console.log("Service installed. Start with: systemctl start mcphub");
  } catch {
    console.log("Could not write to /etc/systemd/system/. To install manually:\n");
    console.log(`  sudo tee ${SYSTEMD_PATH} > /dev/null << 'EOF'`);
    console.log(unit);
    console.log("EOF");
    console.log("  sudo systemctl daemon-reload");
    console.log("  sudo systemctl enable mcphub");
    console.log("  sudo systemctl start mcphub");
  }
}

function uninstallLinux(): void {
  try {
    execSync("systemctl stop mcphub 2>/dev/null", { stdio: "ignore" });
    execSync("systemctl disable mcphub 2>/dev/null", { stdio: "ignore" });
    unlinkSync(SYSTEMD_PATH);
    execSync("systemctl daemon-reload", { stdio: "inherit" });
    console.log("Service removed");
  } catch {
    if (existsSync(SYSTEMD_PATH)) {
      console.log(`Remove manually: sudo rm ${SYSTEMD_PATH} && sudo systemctl daemon-reload`);
    } else {
      console.log("Service not installed");
    }
  }
}

// ─── macOS (launchd) ──────────────────────────────────────────────

const LAUNCHD_PATH = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);

function installMacOS(config: ConfigManager): void {
  const args = serviceArgs(config);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${args.join("</string>\n    <string>")}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/mcphub.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mcphub.log</string>
</dict>
</plist>
`;
  writeFileSync(LAUNCHD_PATH, plist);
  execSync(`launchctl load ${LAUNCHD_PATH}`, { stdio: "inherit" });
  console.log("Service installed and loaded");
}

function uninstallMacOS(): void {
  if (!existsSync(LAUNCHD_PATH)) {
    console.log("Service not installed");
    return;
  }
  execSync(`launchctl unload ${LAUNCHD_PATH} 2>/dev/null`, { stdio: "ignore" });
  unlinkSync(LAUNCHD_PATH);
  console.log("Service removed");
}

// ─── Windows (scheduled task) ─────────────────────────────────────

const TASK_NAME = "MCPHub";

function installWindows(config: ConfigManager): void {
  const args = serviceArgs(config);
  const cmd = `schtasks /create /tn "${TASK_NAME}" /tr "${args.join(" ")}" /sc onstart /ru "%USERNAME%" /f`;
  try {
    execSync(cmd, { stdio: "inherit" });
    console.log("Service installed (starts on next boot)");
    console.log("Start now with: schtasks /run /tn \"MCPHub\"");
  } catch {
    console.log("Could not install. Run as Administrator:");
    console.log(`  ${cmd}`);
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
