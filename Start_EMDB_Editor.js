const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const projectDir = path.join(__dirname, "web-editor");
const cliPath = path.join(projectDir, "node_modules", "vinext", "dist", "cli.js");
const lockPath = path.join(projectDir, "package-lock.json");
const localUrl = "http://localhost:3000/";

function print(message) {
  process.stdout.write(`[EMDB Local Editor] ${message}\n`);
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    throw new Error(`Node.js 22 or newer is required. Current version: ${process.versions.node}`);
  }
}

function getServerStatus() {
  return new Promise((resolve) => {
    const request = http.get(localUrl, { timeout: 1200 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 128 * 1024) body += chunk;
      });
      response.on("end", () => {
        const reachable = response.statusCode >= 200 && response.statusCode < 500;
        if (!reachable) resolve("free");
        else resolve(body.includes("EMDB Local Editor") ? "editor" : "occupied");
      });
    });
    request.on("timeout", () => { request.destroy(); resolve("free"); });
    request.on("error", () => resolve("free"));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDir, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function installDependencies() {
  if (existsSync(cliPath)) return;
  print("Installing local dependencies for the first launch...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const installMode = existsSync(lockPath) ? "ci" : "install";
  await run(npm, [installMode, "--ignore-scripts", "--no-audit", "--no-fund"], {
    shell: process.platform === "win32",
  });
}

async function startServer() {
  print(`Starting local editor at ${localUrl}`);
  const server = spawn(process.execPath, [cliPath, "dev"], {
    cwd: projectDir,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: "inherit",
    windowsHide: false,
  });

  const stop = () => {
    if (!server.killed) server.kill("SIGINT");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => code === 0 || code === null ? resolve() : reject(new Error(`Local server exited with code ${code}`)));
  });
}

async function main() {
  checkNodeVersion();
  if (process.argv.includes("--check")) {
    if (!existsSync(cliPath)) throw new Error("Local dependencies are missing. Run the launcher without --check to install them.");
    print(`Launcher check passed with Node.js ${process.versions.node}.`);
    return;
  }
  const serverStatus = await getServerStatus();
  if (serverStatus === "editor") {
    print(`The local editor is already running at ${localUrl}`);
    return;
  }
  if (serverStatus === "occupied") {
    throw new Error(`Port 3000 is already used by another application. Close it before starting EMDB Local Editor.`);
  }
  await installDependencies();
  await startServer();
}

main().catch((error) => {
  process.stderr.write(`\n[EMDB Local Editor] ${error.message}\n`);
  process.exitCode = 1;
});
