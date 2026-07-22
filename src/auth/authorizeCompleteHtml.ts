export function renderAuthorizationCompleteHtml(accountEmail?: string): string {
  const accountLine = accountEmail
    ? `<p><strong>${accountEmail}</strong> is connected.</p>`
    : `<p>Google Workspace MCP is connected.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorization complete</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
      color: #202124;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      text-align: center;
      padding: 2rem 1.5rem;
      max-width: 28rem;
    }
    .icon {
      width: 4.5rem;
      height: 4.5rem;
      margin: 0 auto 2rem;
      border-radius: 50%;
      border: 3px solid #34a853;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #34a853;
    }
    .icon svg {
      width: 2.25rem;
      height: 2.25rem;
      stroke: currentColor;
      stroke-width: 3;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
      color: #202124;
    }
    p {
      font-size: 1.0625rem;
      line-height: 1.5;
      color: #5f6368;
    }
    p + p {
      margin-top: 0.35rem;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <h1>Authorization complete</h1>
    ${accountLine}
    <p>Authorize another account anytime with the same /authorize link.</p>
    <p>You can close this tab.</p>
  </main>
</body>
</html>`;
}
