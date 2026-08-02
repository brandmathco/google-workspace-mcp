#!/usr/bin/env node
/**
 * Builds packaging/mcp (compiled server + wizard + prod node_modules + public UI)
 * and downloads a portable Node.js runtime into packaging/runtime/<platform>-<arch>/.
 *
 * Usage:
 *   node scripts/prepare-desktop-bundle.mjs
 *   node scripts/prepare-desktop-bundle.mjs --platform=darwin --arch=arm64
 *   node scripts/prepare-desktop-bundle.mjs --platform=win32 --arch=x64
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NODE_VERSION = "22.14.0";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const platform = argValue("platform", process.platform);
const arch = argValue("arch", process.arch === "arm64" ? "arm64" : "x64");

function nodeDistName() {
  if (platform === "darwin") {
    return `node-v${NODE_VERSION}-darwin-${arch}`;
  }
  if (platform === "win32") {
    return `node-v${NODE_VERSION}-win-x64`;
  }
  return `node-v${NODE_VERSION}-linux-${arch}`;
}

function nodeDownloadUrl(distName) {
  const ext = platform === "win32" ? "zip" : "tar.gz";
  return `https://nodejs.org/dist/v${NODE_VERSION}/${distName}.${ext}`;
}

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function writeShim(path, target) {
  // Side-effect import so MCP stdio server starts when Cursor runs dist/index.js
  writeFileSync(
    path,
    `import ${JSON.stringify(target)};\nexport * from ${JSON.stringify(target)};\n`,
    "utf8",
  );
}

function extractArchive(archivePath, runtimeDir, distName) {
  mkdirSync(runtimeDir, { recursive: true });
  if (platform === "win32") {
    execSync(`unzip -qo ${JSON.stringify(archivePath)} -d ${JSON.stringify(runtimeDir)}`, {
      stdio: "inherit",
    });
    const extracted = join(runtimeDir, distName);
    const nodeExe = join(extracted, "node.exe");
    if (!existsSync(nodeExe)) {
      throw new Error(`node.exe missing after extract: ${extracted}`);
    }
    cpSync(nodeExe, join(runtimeDir, "node.exe"));
    rmSync(extracted, { recursive: true, force: true });
    return join(runtimeDir, "node.exe");
  }

  execSync(
    `tar -xzf ${JSON.stringify(archivePath)} -C ${JSON.stringify(runtimeDir)}`,
    { stdio: "inherit" },
  );
  const extracted = join(runtimeDir, distName);
  const nodeBin = join(extracted, "bin", "node");
  if (!existsSync(nodeBin)) {
    throw new Error(`node binary missing after extract: ${nodeBin}`);
  }
  cpSync(nodeBin, join(runtimeDir, "node"));
  chmodSync(join(runtimeDir, "node"), 0o755);
  rmSync(extracted, { recursive: true, force: true });
  return join(runtimeDir, "node");
}

async function main() {
  const out = join(ROOT, "packaging", "mcp");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  console.log("Compiling MCP + wizard…");
  execSync("npx tsc -p tsconfig.packaging.json", { cwd: ROOT, stdio: "inherit" });

  cpSync(join(ROOT, "setup", "public"), join(out, "setup", "public"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(out, "package.json"));
  if (existsSync(join(ROOT, "package-lock.json"))) {
    cpSync(join(ROOT, "package-lock.json"), join(out, "package-lock.json"));
  }

  console.log("Installing production dependencies into packaging/mcp…");
  execSync("npm install --omit=dev --ignore-scripts", {
    cwd: out,
    stdio: "inherit",
    env: { ...process.env, npm_config_fund: "false" },
  });

  mkdirSync(join(out, "dist"), { recursive: true });
  writeShim(join(out, "dist", "index.js"), "../src/index.js");
  writeShim(join(out, "dist", "http.js"), "../src/http.js");

  const distName = nodeDistName();
  const runtimeKey = `${platform}-${platform === "win32" ? "x64" : arch}`;
  const runtimeDir = join(ROOT, "packaging", "runtime", runtimeKey);
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(join(ROOT, "packaging"), { recursive: true });

  const archiveExt = platform === "win32" ? "zip" : "tar.gz";
  const archivePath = join(ROOT, "packaging", `${distName}.${archiveExt}`);
  if (!existsSync(archivePath)) {
    await download(nodeDownloadUrl(distName), archivePath);
  } else {
    console.log(`Using cached ${archivePath}`);
  }

  const nodePath = extractArchive(archivePath, runtimeDir, distName);

  // Flat folder electron-builder always copies as Resources/runtime/
  const activeDir = join(ROOT, "packaging", "runtime", "active");
  rmSync(activeDir, { recursive: true, force: true });
  mkdirSync(activeDir, { recursive: true });
  const activeName = platform === "win32" ? "node.exe" : "node";
  cpSync(nodePath, join(activeDir, activeName));
  if (platform !== "win32") {
    chmodSync(join(activeDir, activeName), 0o755);
  }

  console.log(`Bundled Node: ${nodePath}`);
  console.log(`Active runtime: ${join(activeDir, activeName)}`);
  console.log(`MCP bundle: ${out}`);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
