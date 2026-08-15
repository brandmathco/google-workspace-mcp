export function renderAuthorizationCompleteHtml(
  accountEmail?: string,
  provider = "Google Workspace",
): string {
  const accountLine = accountEmail
    ? `<p><strong>${accountEmail}</strong> is connected.</p>`
    : `<p>${provider} MCP is connected.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorization complete — BrandMatchGrowth</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(900px 420px at 20% 0%, rgba(123, 44, 240, 0.28), transparent 55%),
        linear-gradient(180deg, #07040f, #140a28);
      color: #f4f5f8;
      font-family: Futura, "Century Gothic", "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      padding: 1.5rem;
    }
    .card {
      text-align: center;
      padding: 2rem 1.5rem;
      max-width: 28rem;
      background: rgba(20, 10, 40, 0.85);
      border: 1px solid rgba(163, 113, 255, 0.25);
      border-radius: 16px;
    }
    .brand {
      display: inline-block;
      margin-bottom: 1.25rem;
      color: #a371ff;
      font-size: 0.75rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-decoration: none;
      font-weight: 700;
    }
    .icon {
      width: 4.5rem;
      height: 4.5rem;
      margin: 0 auto 1.5rem;
      border-radius: 50%;
      border: 3px solid #a371ff;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #a371ff;
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
      font-size: 1.6rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
    }
    p {
      font-size: 1.05rem;
      line-height: 1.5;
      color: #d8ccec;
    }
    p + p { margin-top: 0.35rem; }
    .site {
      display: inline-block;
      margin-top: 1.5rem;
      color: #f5c97a;
      text-decoration: none;
      font-size: 0.95rem;
      border-bottom: 1px solid rgba(245, 201, 122, 0.4);
    }
  </style>
</head>
<body>
  <main class="card">
    <a class="brand" href="https://www.brandmatchgrowth.com/" target="_blank" rel="noopener noreferrer">BrandMatchGrowth</a>
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <h1>Authorization complete</h1>
    ${accountLine}
    <p>Authorize another account anytime with the same authorize link.</p>
    <p>You can close this tab.</p>
    <a class="site" href="https://www.brandmatchgrowth.com/" target="_blank" rel="noopener noreferrer">www.brandmatchgrowth.com</a>
  </main>
</body>
</html>`;
}
