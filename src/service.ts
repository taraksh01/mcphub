import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { ConfigManager } from "./config.js";

const LABEL = "com.mcphub";

const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function serviceArgs(config: ConfigManager): string[] {
  const cfg = config.get();
  const port = cfg.port ?? 5431;
  const args = ["mcphub", "start", "--port", String(port)];
  args.push("--config", config.getConfigPath());
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
  const args = serviceArgs(config);
  const user = process.env.USER || "root";
  const path = process.env.PATH || DEFAULT_PATH;
  const unit = `[Unit]
Description=MCP Hub
After=network.target

[Service]
Type=simple
User=${user}
Environment=PATH=${path}
ExecStart=${args.join(" ")}
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
      console.log("Could not write to /etc/systemd/system/. To install manually:\n");
      console.log(`  sudo cp ${tmp} ${SYSTEMD_PATH}`);
      console.log("  sudo systemctl daemon-reload");
      console.log("  sudo systemctl enable mcphub");
      console.log("  sudo systemctl start mcphub");
      return;
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
  }
  try {
    execSync("sudo systemctl daemon-reload", { stdio: "inherit" });
    execSync("sudo systemctl enable mcphub", { stdio: "inherit" });
    execSync("sudo systemctl start mcphub", { stdio: "inherit" });
    console.log("Service installed and started");
  } catch (e) {
    console.log("Service file written but failed to enable:", String(e));
    console.log("Run: sudo systemctl daemon-reload && sudo systemctl enable mcphub");
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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH || DEFAULT_PATH}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/mcphub.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mcphub.log</string>
</dict>
</plist>
`;
  writeFileSync(LAUNCHD_PATH, plist);
  try {
    execSync(`launchctl bootstrap gui/$(id -u) ${LAUNCHD_PATH}`, { stdio: "inherit" });
  } catch {
    try {
      execSync(`launchctl load ${LAUNCHD_PATH}`, { stdio: "inherit" });
    } catch (e) {
      console.error("Failed to load launchd service:", String(e));
      console.log("Try manually: launchctl load " + LAUNCHD_PATH);
      return;
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
  const args = serviceArgs(config);
  const trArg = args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  const cmd = `schtasks /create /tn "${TASK_NAME}" /tr "${trArg}" /sc onstart /ru "%USERNAME%" /f`;
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
