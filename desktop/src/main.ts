import {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const WIZARD_PORT = 3951;
const WIZARD_URL = `http://127.0.0.1:${WIZARD_PORT}`;

let mainWindow: BrowserWindow | null = null;
let wizardProcess: ChildProcess | null = null;
let isQuitting = false;

function resourcesRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return join(__dirname, "..", "..", "packaging");
}

function mcpRoot(): string {
  if (app.isPackaged) {
    return join(resourcesRoot(), "mcp");
  }
  return join(resourcesRoot(), "mcp");
}

function bundledNodePath(): string {
  const name = process.platform === "win32" ? "node.exe" : "node";
  if (app.isPackaged) {
    return join(resourcesRoot(), "runtime", name);
  }
  const active = join(resourcesRoot(), "runtime", "active", name);
  if (existsSync(active)) return active;
  const runtimeKey = `${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
  return join(resourcesRoot(), "runtime", runtimeKey, name);
}

function wizardEntry(): string {
  return join(mcpRoot(), "setup", "wizard-server.js");
}

async function waitForWizard(url: string, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return true;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startWizardProcess(): void {
  const nodePath = bundledNodePath();
  const entry = wizardEntry();

  if (!existsSync(nodePath)) {
    dialog.showErrorBox(
      "Missing bundled Node.js",
      `Expected runtime at:\n${nodePath}\n\nRebuild with:\nnpm run desktop:prepare`,
    );
    app.quit();
    return;
  }
  if (!existsSync(entry)) {
    dialog.showErrorBox(
      "Missing setup wizard",
      `Expected wizard at:\n${entry}\n\nRebuild with:\nnpm run desktop:prepare`,
    );
    app.quit();
    return;
  }

  wizardProcess = spawn(nodePath, [entry], {
    cwd: mcpRoot(),
    env: {
      ...process.env,
      GOOGLE_MCP_PACKAGED: "1",
      GOOGLE_MCP_APP_ROOT: mcpRoot(),
      GOOGLE_MCP_BUNDLED_NODE: nodePath,
      SETUP_WIZARD_PORT: String(WIZARD_PORT),
      SETUP_WIZARD_NO_BROWSER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  wizardProcess.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[wizard] ${chunk.toString().trim()}`);
  });
  wizardProcess.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[wizard] ${chunk.toString().trim()}`);
  });
  wizardProcess.on("exit", (code) => {
    wizardProcess = null;
    if (!isQuitting && code && code !== 0) {
      dialog.showErrorBox(
        "Setup wizard stopped",
        `The setup helper exited unexpectedly (code ${code}).`,
      );
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    title: "Google Workspace MCP Setup",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(WIZARD_URL) && !url.startsWith("http://127.0.0.1:3847")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(WIZARD_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    {
      label: "Help",
      submenu: [
        {
          label: "GitHub Releases",
          click: () => {
            void shell.openExternal(
              "https://github.com/brandmathco/google-workspace-mcp/releases",
            );
          },
        },
        {
          label: "Open setup page in browser",
          click: () => {
            void shell.openExternal(WIZARD_URL);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();
  startWizardProcess();

  // Wizard CLI auto-opens a browser; give Electron the window instead.
  // Patch: restart note — we pass no flag to skip browser. Update wizard to respect SETUP_WIZARD_NO_BROWSER.
  const ready = await waitForWizard(WIZARD_URL);
  if (!ready) {
    dialog.showErrorBox(
      "Setup wizard failed to start",
      "Could not reach the local setup UI. Try quitting and opening the app again.",
    );
    app.quit();
    return;
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (wizardProcess && !wizardProcess.killed) {
    wizardProcess.kill("SIGTERM");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
