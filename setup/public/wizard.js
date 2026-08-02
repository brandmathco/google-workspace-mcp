/* global fetch */

const $ = (id) => document.getElementById(id);

let statusCache = null;
let pollTimer = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

function setStep(step) {
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("active", el.dataset.step === String(step));
  });
  document.querySelectorAll(".panel").forEach((el) => {
    el.classList.toggle("active", el.id === `panel-${step}`);
  });
  if (step === 3) {
    startAccountPoll();
  } else {
    stopAccountPoll();
  }
  if (step === 4) {
    loadCursorConfig();
  }
}

function checklistItem(ok, text) {
  const li = document.createElement("li");
  const dot = document.createElement("span");
  dot.className = `dot ${ok ? "ok" : "bad"}`;
  const span = document.createElement("span");
  span.textContent = text;
  li.append(dot, span);
  return li;
}

function renderInstall(status) {
  const list = $("installChecklist");
  const packaged = Boolean(status.packaged);
  if (packaged) {
    $("installTitle").textContent = "Installer ready";
    $("installIntro").textContent =
      "This app already includes everything Cursor needs (including Node.js). No Terminal, npm, or separate downloads.";
    $("stepBtn1").textContent = "1. Ready";
    $("btnInstall").classList.add("hidden");
    $("btnInstall").style.display = "none";
  }
  list.replaceChildren(
    checklistItem(status.node.ok, status.node.message),
    checklistItem(
      status.depsInstalled,
      packaged
        ? "MCP server bundled in this app"
        : status.depsInstalled
          ? "Dependencies installed"
          : "Dependencies not installed yet",
    ),
    checklistItem(
      status.distBuilt,
      status.distBuilt ? "Server files ready" : "Server files missing",
    ),
    checklistItem(
      true,
      status.envPath
        ? `Secrets folder: ${status.userConfigDir || status.envPath}`
        : "Secrets stay on this computer only",
    ),
  );
  $("btnToStep2").disabled = !(status.node.ok && status.depsInstalled && status.distBuilt);
  $("versionLine").textContent = `v${status.version} · ${status.platform}${packaged ? " · installer" : ""}`;
  $("redirectUriCode").textContent = status.redirectUri;
}

function renderAccounts(accounts) {
  const list = $("accountsList");
  if (!accounts.length) {
    list.innerHTML = "<li><span class=\"dot warn\"></span><span>No accounts connected yet.</span></li>";
    return;
  }
  list.replaceChildren(
    ...accounts.map((account) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot ok";
      const span = document.createElement("span");
      const label = account.label ? ` (${account.label})` : "";
      const def = account.isDefault ? " · default" : "";
      span.textContent = `${account.email}${label}${def}`;
      li.append(dot, span);
      return li;
    }),
  );
}

async function refreshStatus() {
  statusCache = await api("/api/status");
  renderInstall(statusCache);
  renderAccounts(statusCache.accounts || []);
  $("btnToStep3").disabled = !statusCache.hasEnv;
  if (statusCache.hasEnv) {
    $("envHint").textContent = `Saved Client ID: ${statusCache.clientIdPreview}`;
  }
  return statusCache;
}

async function loadCursorConfig() {
  const data = await api("/api/cursor-config");
  $("cursorSnippet").textContent = data.snippet;
}

function startAccountPoll() {
  stopAccountPoll();
  pollTimer = setInterval(async () => {
    try {
      const data = await api("/api/accounts");
      renderAccounts(data.accounts || []);
      if (!data.oauthBusy && $("authHint").dataset.waiting === "1") {
        $("authHint").dataset.waiting = "0";
        $("authHint").textContent = "If Google finished successfully, your account should appear above.";
        refreshStatus();
      }
    } catch {
      // ignore transient errors while polling
    }
  }, 2000);
}

function stopAccountPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

document.querySelectorAll(".step").forEach((btn) => {
  btn.addEventListener("click", () => setStep(btn.dataset.step));
});

$("btnToStep2").addEventListener("click", () => setStep(2));
$("btnToStep3").addEventListener("click", () => setStep(3));
$("btnToStep4").addEventListener("click", () => setStep(4));

$("btnInstall").addEventListener("click", async () => {
  const log = $("installLog");
  log.classList.remove("hidden");
  log.textContent = "Installing… this can take a minute.\n";
  $("btnInstall").disabled = true;
  try {
    const result = await api("/api/install", { method: "POST", body: "{}" });
    log.textContent = result.log || "Done.";
    await refreshStatus();
  } catch (error) {
    log.textContent = error.message;
  } finally {
    $("btnInstall").disabled = false;
  }
});

$("envForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("envHint").textContent = "Saving…";
  try {
    await api("/api/save-env", {
      method: "POST",
      body: JSON.stringify({
        clientId: $("clientId").value.trim(),
        clientSecret: $("clientSecret").value.trim(),
      }),
    });
    $("clientSecret").value = "";
    $("envHint").textContent = "Saved on this computer. Continue to connect Google.";
    await refreshStatus();
    $("btnToStep3").disabled = false;
  } catch (error) {
    $("envHint").textContent = error.message;
  }
});

$("btnCopyRedirect").addEventListener("click", async () => {
  const text = $("redirectUriCode").textContent;
  await navigator.clipboard.writeText(text);
  $("btnCopyRedirect").textContent = "Copied";
  setTimeout(() => {
    $("btnCopyRedirect").textContent = "Copy";
  }, 1500);
});

$("btnAuthorize").addEventListener("click", async () => {
  $("authHint").textContent = "Opening Google sign-in…";
  $("authHint").dataset.waiting = "1";
  try {
    const result = await api("/api/authorize", {
      method: "POST",
      body: JSON.stringify({ label: $("accountLabel").value.trim() || undefined }),
    });
    $("authHint").textContent = result.authUrl
      ? "Browser opened. Sign in and click Allow. Come back here afterward."
      : "Waiting for Google…";
    startAccountPoll();
  } catch (error) {
    $("authHint").dataset.waiting = "0";
    $("authHint").textContent = error.message;
  }
});

$("btnRefreshAccounts").addEventListener("click", () => refreshStatus());
$("btnCancelAuth").addEventListener("click", async () => {
  await api("/api/authorize/cancel", { method: "POST", body: "{}" });
  $("authHint").dataset.waiting = "0";
  $("authHint").textContent = "Authorization wait cancelled.";
});

$("btnCopySnippet").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("cursorSnippet").textContent);
  $("cursorHint").textContent = "JSON copied. Paste into Cursor MCP settings if you prefer manual setup.";
});

$("btnWriteCursor").addEventListener("click", async () => {
  $("cursorHint").textContent = "Writing…";
  try {
    const result = await api("/api/write-cursor-config", { method: "POST", body: "{}" });
    $("cursorHint").textContent = `Saved to ${result.path}. Restart Cursor next.`;
  } catch (error) {
    $("cursorHint").textContent = error.message;
  }
});

refreshStatus()
  .then((status) => {
    if (status.packaged && status.depsInstalled && status.distBuilt) {
      setStep(status.hasEnv ? (status.accounts?.length ? 4 : 3) : 2);
      return;
    }
    if (status.depsInstalled && status.distBuilt) {
      if (status.hasEnv) {
        setStep(status.accounts?.length ? 4 : 3);
      } else {
        setStep(2);
      }
    } else {
      setStep(1);
    }
  })
  .catch((error) => {
    $("versionLine").textContent = error.message;
  });
