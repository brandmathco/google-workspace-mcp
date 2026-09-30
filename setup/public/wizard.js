/* global fetch */

const $ = (id) => document.getElementById(id);

let statusCache = null;
let pollTimer = null;
let flyCursorSnippet = "";
let userChoseStep = false;

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

const ADVANCED_STEPS = new Set(["4", "6"]);

function isQuickMode() {
  return document.body.classList.contains("mode-quick");
}

function applyMode(mode) {
  const quick = mode !== "full";
  document.body.classList.toggle("mode-quick", quick);
  document.body.classList.toggle("mode-full", !quick);
  $("ledeQuick").classList.toggle("hidden", !quick);
  $("ledeFull").classList.toggle("hidden", quick);
  $("modeQuick").classList.toggle("active", quick);
  $("modeFull").classList.toggle("active", !quick);
  $("modeQuick").setAttribute("aria-checked", quick ? "true" : "false");
  $("modeFull").setAttribute("aria-checked", quick ? "false" : "true");
  try {
    localStorage.setItem("gwmcp-setup-mode", quick ? "quick" : "full");
  } catch {
    // ignore private mode
  }
  const active = document.querySelector(".step.active");
  const step = active ? Number(active.dataset.step) : 1;
  if (quick && ADVANCED_STEPS.has(String(step))) setStep(5);
  else setStep(step);
}

function visibleSteps() {
  return [...document.querySelectorAll(".step")].filter(
    (el) => getComputedStyle(el).display !== "none",
  );
}

function paintRail(next) {
  const visible = visibleSteps();
  const index = visible.findIndex((el) => el.dataset.step === String(next));
  visible.forEach((el, i) => {
    const num = el.querySelector(".num");
    if (num) num.textContent = String(i + 1);
    el.classList.toggle("done", index > -1 && i < index);
  });
  const count = $("stepCount");
  if (count && index > -1) count.textContent = `Step ${index + 1} of ${visible.length}`;
  const back = $("btnBack");
  const cont = $("btnContinue");
  if (back) back.disabled = index <= 0;
  if (cont) cont.disabled = index < 0 || index >= visible.length - 1;
}

function moveStep(delta) {
  const visible = visibleSteps();
  const index = visible.findIndex((el) => el.classList.contains("active"));
  const next = visible[index + delta];
  if (next) setStep(next.dataset.step);
}

function setStep(step) {
  let next = Number(step);
  if (isQuickMode() && ADVANCED_STEPS.has(String(next))) {
    next = next === 4 ? 5 : 7;
  }
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("active", el.dataset.step === String(next));
  });
  document.querySelectorAll(".panel").forEach((el) => {
    el.classList.toggle("active", el.id === `panel-${next}`);
  });
  if (next === 5) startAccountPoll();
  else stopAccountPoll();
  if (next === 6) refreshFlyStatus();
  if (next === 7) loadCursorConfig();
  const arts = {
    1: "cursor",
    2: "computer",
    3: "google",
    4: "supabase",
    5: "connect",
    6: "fly",
    7: "finish",
    8: "tools",
    9: "status",
  };
  const artKey = arts[next] || "cursor";
  const artCopy = {
    cursor: "Illustrated Cursor window",
    computer: "Illustrated laptop on a purple desk",
    google: "Illustrated gold key",
    supabase: "Illustrated database",
    connect: "Illustrated connected account",
    fly: "Illustrated cloud path",
    finish: "Illustrated setup complete check",
    tools: "Illustrated tool tiles",
    status: "Illustrated MCP status board",
  };
  const picture = $("stepPicture");
  if (picture) {
    picture.src = `/art/${artKey}.svg`;
    picture.alt = artCopy[artKey] || "Setup illustration";
  }
  if (next === 9) loadManage();
  paintRail(next);
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
  btn.addEventListener("click", () => {
    userChoseStep = true;
    setStep(btn.dataset.step);
  });
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

$("btnToStep2").addEventListener("click", () => {
  userChoseStep = true;
  setStep(2);
});
$("btnToStep3").addEventListener("click", () => {
  userChoseStep = true;
  setStep(3);
});
$("btnToStep4").addEventListener("click", () => {
  userChoseStep = true;
  setStep(4);
});
$("btnToStep5").addEventListener("click", () => {
  userChoseStep = true;
  setStep(5);
});
$("btnToStep6").addEventListener("click", () => {
  userChoseStep = true;
  setStep(6);
});
$("btnToStep7").addEventListener("click", () => {
  userChoseStep = true;
  setStep(7);
});
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
      body: JSON.stringify({
        label: $("accountLabel").value.trim() || undefined,
        preset: isQuickMode() ? "quick" : "full",
      }),
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


const REACH = {
  up: "Responding",
  down: "Not responding",
  local: "On this computer",
  stopped: "Disconnected",
};

function mcpGlyph(server) {
  if (server.name === "google-workspace") return "link";
  if (server.kind === "local") return "computer";
  if (server.name === "github") return "tools";
  return "cloud";
}

function renderSecurity(findings) {
  const list = $("securityList");
  list.replaceChildren(
    ...findings.map((item) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = `dot ${item.ok ? "ok" : "bad"}`;
      const span = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = item.title;
      span.append(title, document.createTextNode(` ${item.detail}`));
      li.append(dot, span);
      return li;
    }),
  );
}

function renderManageAccounts(accounts) {
  const list = $("manageAccounts");
  if (!accounts.length) {
    list.replaceChildren(checklistItem(false, "No Google account connected yet."));
    list.className = "checklist";
    return;
  }
  list.className = "account-list";
  list.replaceChildren(
    ...accounts.map((account) => {
      const li = document.createElement("li");
      li.textContent = account.isDefault ? `${account.email} · default` : account.email;
      return li;
    }),
  );
}

function renderServers(servers) {
  const list = $("mcpList");
  if (!servers.length) {
    const li = document.createElement("li");
    li.className = "mcp-row";
    li.textContent = "No MCPs are saved in Cursor yet. Finish setup, then come back here.";
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...servers.map((server) => {
      const li = document.createElement("li");
      li.className = "mcp-row";
      const glyph = document.createElement("span");
      glyph.className = "glyph";
      glyph.dataset.icon = mcpGlyph(server);
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = server.name;
      const meta = document.createElement("span");
      meta.className = "meta-line";
      const ready =
        server.localReady === false ? "Files missing" : REACH[server.reachability] || server.detail;
      const access = server.readonly ? " · Read only" : server.hasAuth ? " · Signed in" : "";
      meta.textContent = `${server.detail} · ${ready}${access}`;
      const badge = document.createElement("span");
      badge.className = server.state === "running" ? "badge" : "badge off";
      badge.textContent = server.state === "running" ? "Running" : "Stopped";
      copy.append(title, meta, badge);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn tiny";
      button.textContent = server.state === "running" ? "Stop" : "Start";
      button.addEventListener("click", () =>
        setMcpPower({ name: server.name, running: server.state !== "running" }),
      );
      li.append(glyph, copy, button);
      return li;
    }),
  );
}

async function loadManage() {
  const hint = $("mcpHint");
  if (hint) hint.textContent = "Checking…";
  try {
    const data = await api("/api/mcp/status");
    renderServers(data.servers || []);
    renderSecurity(data.security || []);
    renderManageAccounts(data.accounts || []);
    if (hint) hint.textContent = data.path ? `Cursor file: ${data.path}` : "";
  } catch (error) {
    if (hint) hint.textContent = error.message;
  }
}

async function setMcpPower(body) {
  const hint = $("mcpHint");
  if (hint) hint.textContent = "Saving…";
  try {
    const data = await api("/api/mcp/power", { method: "POST", body: JSON.stringify(body) });
    renderServers(data.servers || []);
    renderSecurity(data.security || []);
    renderManageAccounts(data.accounts || []);
    const changed = (data.changed || []).join(", ");
    if (hint) {
      hint.textContent = changed
        ? `Updated ${changed}. Reload MCP servers in Cursor.`
        : "Nothing changed.";
    }
  } catch (error) {
    if (hint) hint.textContent = error.message;
  }
}

$("btnCopySnippet").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("cursorSnippet").textContent);
  $("cursorHint").textContent = "JSON copied.";
});

$("btnOpenStatus").addEventListener("click", () => {
  userChoseStep = true;
  setStep(9);
});

$("btnRefreshMcp").addEventListener("click", () => loadManage());
$("btnStopAll").addEventListener("click", () => setMcpPower({ all: "stop" }));
$("btnStartAll").addEventListener("click", () => setMcpPower({ all: "start" }));

$("btnWriteCursor").addEventListener("click", async () => {
  $("cursorHint").textContent = "Writing…";
  try {
    const result = await api("/api/write-cursor-config", { method: "POST", body: "{}" });
    $("cursorHint").textContent = `Saved to ${result.path}. Restart Cursor next.`;
  } catch (error) {
    $("cursorHint").textContent = error.message;
  }
});

applyMode((() => {
  try {
    return localStorage.getItem("gwmcp-setup-mode") || "quick";
  } catch {
    return "quick";
  }
})());

$("modeQuick").addEventListener("click", () => applyMode("quick"));
$("modeFull").addEventListener("click", () => applyMode("full"));
$("btnBack").addEventListener("click", () => {
  userChoseStep = true;
  moveStep(-1);
});
$("btnContinue").addEventListener("click", () => {
  userChoseStep = true;
  moveStep(1);
});

refreshStatus()
  .then((status) => {
    if (userChoseStep) return;
    if (status.setupComplete) {
      setStep(9);
      return;
    }
    if (status.packaged && status.depsInstalled && status.distBuilt) {
      setStep(status.hasEnv ? (isQuickMode() ? 5 : 4) : 1);
      return;
    }
    setStep(1);
  })
  .catch((error) => {
    $("versionLine").textContent = error.message;
  });
