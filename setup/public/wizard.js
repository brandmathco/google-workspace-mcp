/* global fetch */

const $ = (id) => document.getElementById(id);

let statusCache = null;
let pollTimer = null;
let flyCursorSnippet = "";

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
  if (step === 5) startAccountPoll();
  else stopAccountPoll();
  if (step === 6) refreshFlyStatus();
  if (step === 7) loadCursorConfig();
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
      "This app already includes everything Cursor needs (including Node.js). No Terminal or npm.";
    $("btnInstall").style.display = "none";
  }
  list.replaceChildren(
    checklistItem(status.node.ok, status.node.message),
    checklistItem(
      status.depsInstalled,
      packaged ? "MCP server bundled in this app" : status.depsInstalled
        ? "Dependencies installed"
        : "Dependencies not installed yet",
    ),
    checklistItem(status.distBuilt, status.distBuilt ? "Server files ready" : "Server files missing"),
    checklistItem(
      true,
      status.userConfigDir
        ? `Secrets folder: ${status.userConfigDir}`
        : "Secrets stay on this computer only",
    ),
  );
  $("btnToStep3").disabled = !(status.node.ok && status.depsInstalled && status.distBuilt);
  $("versionLine").textContent = `v${status.version} · ${status.platform}${packaged ? " · installer" : ""}`;
  $("redirectUriCode").textContent = status.redirectUri;
}

function renderAccounts(accounts) {
  const list = $("accountsList");
  if (!accounts.length) {
    list.innerHTML =
      '<li><span class="dot warn"></span><span>No accounts connected yet.</span></li>';
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

function renderFly(fly) {
  const list = $("flyChecklist");
  if (!fly) {
    list.replaceChildren(checklistItem(false, "Checking Fly CLI…"));
    return;
  }
  list.replaceChildren(
    checklistItem(fly.installed, fly.installed ? `Fly CLI: ${fly.version || "installed"}` : "Fly CLI not installed"),
    checklistItem(fly.loggedIn, fly.loggedIn ? `Signed in: ${fly.whoami}` : "Not signed in to Fly.io"),
  );
  $("flyHint").textContent = fly.message || "";
}

async function refreshStatus() {
  statusCache = await api("/api/status");
  renderInstall(statusCache);
  renderAccounts(statusCache.accounts || []);
  renderFly(statusCache.fly);
  $("btnToStep4").disabled = !statusCache.hasEnv;
  if (statusCache.hasEnv) {
    $("envHint").textContent = `Saved Client ID: ${statusCache.clientIdPreview}`;
    if (!$("flyClientId").value) $("flyClientId").value = "";
  }
  if (statusCache.hasSupabase) {
    $("supabaseHint").textContent = `Saved Supabase: ${statusCache.supabaseUrlPreview}`;
  }
  // Prefill fly form from status hints only for non-secrets
  return statusCache;
}

async function refreshFlyStatus() {
  try {
    const fly = await api("/api/fly/status");
    renderFly(fly);
  } catch (error) {
    $("flyHint").textContent = error.message;
  }
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
        $("authHint").textContent =
          "If Google finished successfully, your account should appear above.";
        refreshStatus();
      }
    } catch {
      // ignore
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

document.querySelectorAll("[data-open]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const url = btn.getAttribute("data-open");
    try {
      await api("/api/open-url", { method: "POST", body: JSON.stringify({ url }) });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
});

$("btnToStep2").addEventListener("click", () => setStep(2));
$("btnToStep3").addEventListener("click", () => setStep(3));
$("btnToStep4").addEventListener("click", () => setStep(4));
$("btnToStep5").addEventListener("click", () => setStep(5));
$("btnToStep6").addEventListener("click", () => setStep(6));
$("btnToStep7").addEventListener("click", () => setStep(7));
$("btnSkipSupabase").addEventListener("click", () => setStep(5));
$("btnSkipFly").addEventListener("click", () => setStep(7));

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
        adsDeveloperToken: $("adsDeveloperToken").value.trim() || undefined,
        adsLoginCustomerId: $("adsLoginCustomerId").value.trim() || undefined,
        adsDefaultCustomerId: $("adsDefaultCustomerId").value.trim() || undefined,
        adsMaxDailyBudgetMicros: $("adsMaxDailyBudgetMicros").value.trim() || undefined,
      }),
    });
    $("clientSecret").value = "";
    $("adsDeveloperToken").value = "";
    $("envHint").textContent =
      "Saved on this computer only (never committed to GitHub). Re-authorize accounts if you added Ads.";
    $("flyClientId").value = $("clientId").value.trim();
    $("flyAdsLoginCustomerId").value = $("adsLoginCustomerId").value.trim();
    $("flyAdsDefaultCustomerId").value = $("adsDefaultCustomerId").value.trim();
    await refreshStatus();
    $("btnToStep4").disabled = false;
  } catch (error) {
    $("envHint").textContent = error.message;
  }
});

$("supabaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("supabaseHint").textContent = "Saving…";
  try {
    await api("/api/save-supabase", {
      method: "POST",
      body: JSON.stringify({
        supabaseUrl: $("supabaseUrl").value.trim(),
        supabaseServiceRoleKey: $("supabaseServiceRoleKey").value.trim(),
      }),
    });
    $("flySupabaseUrl").value = $("supabaseUrl").value.trim();
    $("flySupabaseKey").value = $("supabaseServiceRoleKey").value.trim();
    $("supabaseServiceRoleKey").value = "";
    $("supabaseHint").textContent = "Supabase keys saved for Fly multi-account.";
    await refreshStatus();
  } catch (error) {
    $("supabaseHint").textContent = error.message;
  }
});

$("btnLoadSql").addEventListener("click", async () => {
  const data = await api("/api/migration-sql");
  $("migrationSql").textContent = data.sql;
});

$("btnCopySql").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("migrationSql").textContent);
  $("btnCopySql").textContent = "Copied";
  setTimeout(() => {
    $("btnCopySql").textContent = "Copy SQL";
  }, 1500);
});

$("btnCopyRedirect").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("redirectUriCode").textContent);
  $("btnCopyRedirect").textContent = "Copied";
  setTimeout(() => {
    $("btnCopyRedirect").textContent = "Copy";
  }, 1500);
});

$("btnAuthorize").addEventListener("click", async () => {
  $("authHint").textContent = "Opening Google sign-in…";
  $("authHint").dataset.waiting = "1";
  try {
    await api("/api/authorize", {
      method: "POST",
      body: JSON.stringify({ label: $("accountLabel").value.trim() || undefined }),
    });
    $("authHint").textContent =
      "Browser opened. Sign in and click Allow. Come back here afterward.";
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

$("btnFlyInstall").addEventListener("click", async () => {
  $("flyHint").textContent = "Installing Fly CLI…";
  $("flyLog").classList.remove("hidden");
  $("flyLog").textContent = "Working…\n";
  try {
    const result = await api("/api/fly/install", { method: "POST", body: "{}" });
    $("flyLog").textContent = result.log || "Installed.";
    renderFly(result.status);
    $("flyHint").textContent = result.status?.message || "Installed. Sign in next.";
  } catch (error) {
    $("flyLog").textContent = error.message;
    $("flyHint").textContent = error.message;
  }
});

$("btnFlyLogin").addEventListener("click", async () => {
  $("flyHint").textContent = "Opening Fly sign-in…";
  try {
    const result = await api("/api/fly/login", { method: "POST", body: "{}" });
    $("flyHint").textContent = result.message;
    const timer = setInterval(async () => {
      const fly = await api("/api/fly/status");
      renderFly(fly);
      if (fly.loggedIn) {
        clearInterval(timer);
        $("flyHint").textContent = `Signed in as ${fly.whoami}`;
      }
    }, 3000);
    setTimeout(() => clearInterval(timer), 180000);
  } catch (error) {
    $("flyHint").textContent = error.message;
  }
});

$("btnFlyRefresh").addEventListener("click", () => refreshFlyStatus());

$("flyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("flyLog").classList.remove("hidden");
  $("flyLog").textContent = "Deploying… this can take several minutes.\n";
  $("btnFlyDeploy").disabled = true;
  $("flySuccess").classList.add("hidden");
  try {
    const result = await api("/api/fly/deploy", {
      method: "POST",
      body: JSON.stringify({
        appName: $("flyAppName").value.trim(),
        region: $("flyRegion").value,
        googleClientId: $("flyClientId").value.trim() || $("clientId").value.trim(),
        googleClientSecret: $("flyClientSecret").value.trim() || $("clientSecret").value.trim(),
        supabaseUrl: $("flySupabaseUrl").value.trim() || $("supabaseUrl").value.trim(),
        supabaseServiceRoleKey:
          $("flySupabaseKey").value.trim() || $("supabaseServiceRoleKey").value.trim(),
        adsDeveloperToken: $("flyAdsDeveloperToken").value.trim() || undefined,
        adsLoginCustomerId: $("flyAdsLoginCustomerId").value.trim() || undefined,
        adsDefaultCustomerId: $("flyAdsDefaultCustomerId").value.trim() || undefined,
        adsMaxDailyBudgetMicros: $("adsMaxDailyBudgetMicros").value.trim() || undefined,
      }),
    });
    $("flyAdsDeveloperToken").value = "";
    $("flyLog").textContent = result.log || "Done.";
    if (result.ok) {
      $("flySuccess").classList.remove("hidden");
      $("flySuccessText").textContent = `App URL: ${result.appUrl}`;
      $("flyRedirect").textContent = result.redirectUri;
      $("flyAuthorize").textContent = result.authorizeUrl;
      flyCursorSnippet = result.cursorRemoteSnippet || "";
      $("flyCursorSnippet").textContent = flyCursorSnippet;
      $("flyHint").textContent = "Deploy succeeded. Add the redirect URI in Google, then authorize.";
    }
  } catch (error) {
    $("flyLog").textContent = error.message;
    $("flyHint").textContent = error.message;
  } finally {
    $("btnFlyDeploy").disabled = false;
  }
});

$("btnCopyFlyRedirect").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("flyRedirect").textContent);
});

$("btnOpenFlyAuthorize").addEventListener("click", () => {
  const url = $("flyAuthorize").textContent;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
});

$("btnCopyFlyCursor").addEventListener("click", async () => {
  await navigator.clipboard.writeText(flyCursorSnippet || $("flyCursorSnippet").textContent);
});

$("btnCopySnippet").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("cursorSnippet").textContent);
  $("cursorHint").textContent = "JSON copied.";
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
      setStep(status.hasEnv ? 4 : 1);
      return;
    }
    setStep(1);
  })
  .catch((error) => {
    $("versionLine").textContent = error.message;
  });
