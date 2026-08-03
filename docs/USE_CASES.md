# Use cases — automate Gmail, Calendar, Tasks, and Google Ads with AI

These are example prompts you can run in **Cursor** (or any MCP client) after connecting this server. The AI calls the MCP tools on your behalf — always review before sending replies to clients or enabling ads spend.

**Google Ads:** see **[ADS_SAFETY.md](./ADS_SAFETY.md)** — creates stay PAUSED; dry-run defaults on; enable is double-gated.

## Inbox triage and labels

Gmail labels act like tags. The MCP can list labels (`gmail_list_labels`), then apply them with `gmail_move`.

**Prompt:**

> Look at my unread email from the last 24 hours. For each message:
> - If it's a newsletter or marketing email, archive it (remove INBOX).
> - If it's an invoice or receipt, add label `Finance/Invoices`.
> - If it's from a client asking a question, add label `Clients/Needs-reply`.
> - Summarize what you did in a table.

**Prompt (end of day cleanup):**

> Search Gmail for `is:unread older_than:3d`. Archive anything that's clearly automated notifications. List anything still unread that looks like it needs a human reply.

## Draft and send replies

**Prompt:**

> Find unread emails with label `Clients/Needs-reply`. For each one, read the full thread, draft a professional reply, and show me the drafts. After I approve, send the replies.

**Prompt (quick acknowledgment):**

> Reply to the most recent email from *client@example.com* with: "Thanks — I received this and will follow up by end of week."

## Calendar from email

**Prompt:**

> Check my unread mail for meeting requests or "let's schedule" messages. For each one, propose a 30-minute slot tomorrow or Thursday afternoon (America/Edmonton), create calendar events titled with the sender's company name, and draft a reply confirming the time.

**Prompt:**

> List my upcoming calendar events this week, then search Gmail for threads with those attendees I haven't replied to yet.

## Tasks from action items

**Prompt:**

> Read my unread inbox. Create a Google Task for every email that contains a clear action item for me. Use the email subject as the task title and one sentence from the body as notes. Due date = tomorrow for urgent ones, end of week for the rest.

**Prompt:**

> List my open Google Tasks. For any task mentioning a person, search Gmail for the latest thread with them and summarize context.

## Business workflows (templates)

### Lead follow-up

> Search `from:(@yourcrm.com OR leads@) newer_than:7d`. For leads I haven't replied to, add label `Sales/Follow-up`, create a task "Follow up: {name}", and draft a short intro reply.

### Support queue

> List unread with subject containing "support" or "help". Label as `Support/New`, archive auto-replies, and group the rest by topic in your summary.

### Weekly review

> Give me a weekly briefing: unread count by label, calendar events Mon–Fri, open tasks overdue, and the top 5 emails I should handle first.

## Google Ads (spend-safe)

**Prerequisites:** `GOOGLE_ADS_DEVELOPER_TOKEN`, Google Ads API enabled, accounts re-authorized with the `adwords` scope. Upload video creatives to **YouTube** first (pass the video id).

**Prompt (discover only):**

> List my accessible Google Ads customers, then list campaigns on the default customer. Summarize names, status, daily budget, and cost. Do not create or enable anything.

**Prompt (dry-run Demand Gen video — OpenSign-style):**

> Using Google Ads tools only in dry-run mode: draft a PAUSED Demand Gen video campaign for customer `<CUSTOMER_ID>` named "OpenSign Demo — YouTube". Use YouTube video id `<YOUTUBE_VIDEO_ID>`, final URL `https://www.brandmatchgrowth.com/`, business name OpenSign, daily budget $15 (15000000 micros), three short headlines and two descriptions about white-label POS + inventory. Show me the full dry-run preview JSON. Do not set dryRun false. Do not enable the campaign.

**Prompt (apply after approval):**

> I approved the dry-run preview. Upload logo from `<LOGO_HTTPS_URL>` with dryRun false, then create the Demand Gen video campaign with dryRun false using that logo asset. Keep everything PAUSED. Do not call ads_set_campaign_status with ENABLED.

**Prompt (enable — human only, never for unattended automation):**

> Pause is confirmed in the Ads UI. With GOOGLE_ADS_ALLOW_ENABLE already true on this host, dry-run ads_set_campaign_status ENABLED for campaign `<ID>`, show me the preview, then after I say apply, call it with confirmSpend ENABLE_SPEND and dryRun false.

**Automation tip:** Scheduled Cloud agents should only list + dry-run + email/Slack you the preview. Never set `GOOGLE_ADS_ALLOW_ENABLE=true` on unattended Fly secrets.

## Tips

- **Start read-only:** Ask the AI to *list* and *summarize* before *move*, *reply*, or *create*.
- **Use Gmail search syntax** in prompts: `from:`, `label:`, `is:unread`, `newer_than:2d`, `subject:invoice`.
- **Label IDs:** Run `gmail_list_labels` once so the agent knows your exact label names (Gmail API uses IDs internally; the agent maps names).
- **Remote / Cloud Cursor:** Deploy the HTTP server on Fly.io and use the `url` + `Authorization` MCP config so cloud agents can reach your mail stack securely.
- **Ads budget:** Micros — `$1 = 1000000`. Default create/update cap is `$25/day`.

## What this MCP does *not* do (yet)

- Create new Gmail labels via API in one click (Gmail API supports it, but this server exposes *move* to existing labels — ask the agent to list labels first or create labels manually in Gmail).
- Send without your approval unless you explicitly instruct it to send drafted replies.
- Replace proper email marketing or CRM tools — it's best for personal/team inbox automation with an AI assistant in the loop.
- Upload raw video files to YouTube or Google Ads (pass an existing YouTube video id).
- Auto-enable campaigns from Cloud Automations (by design — see ADS_SAFETY.md).
