import { getGoogleAuthClient, googleAuthOverride } from "./auth/googleAuth.js";
import {
  createCalendarEvent,
  listUpcomingEvents,
} from "./services/calendar.js";
import {
  createDraftMessage,
  createGmailClient,
  listMessages,
} from "./services/gmail.js";

export type PrimeGoogleToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Run Gmail/Calendar tools with a short-lived access token from Prime Copilot.
 * Does not persist the token or change the MCP account store.
 */
export async function runPrimeGoogleTool(
  name: string,
  args: Record<string, unknown>,
  accessToken: string,
): Promise<PrimeGoogleToolResult> {
  const token = accessToken.trim();
  if (!token) {
    return { ok: false, error: "accessToken is required" };
  }

  try {
    return await googleAuthOverride.run({ accessToken: token }, async () => {
      const accountEmail =
        typeof args.accountEmail === "string" ? args.accountEmail : undefined;
      const auth = await getGoogleAuthClient(accountEmail);

      switch (name) {
        case "gmail_get_profile": {
          const gmail = await createGmailClient(auth);
          const profile = await gmail.users.getProfile({ userId: "me" });
          return {
            ok: true,
            data: { emailAddress: profile.data.emailAddress ?? "" },
          };
        }
        case "gmail_list_messages": {
          const maxResults =
            typeof args.maxResults === "number" ? args.maxResults : 10;
          const data = await listMessages(auth, {
            query: str(args, "query") || undefined,
            maxResults,
          });
          return { ok: true, data };
        }
        case "gmail_create_draft": {
          const to = str(args, "to");
          const subject = str(args, "subject");
          const body = str(args, "body");
          if (!to || !subject || !body) {
            return { ok: false, error: "to, subject, and body are required" };
          }
          const data = await createDraftMessage(auth, {
            to,
            subject,
            body,
            cc: str(args, "cc") || undefined,
            bcc: str(args, "bcc") || undefined,
          });
          return { ok: true, data };
        }
        case "calendar_list_upcoming": {
          const maxResults =
            typeof args.maxResults === "number" ? args.maxResults : 10;
          const data = await listUpcomingEvents(auth, {
            maxResults,
            calendarId: str(args, "calendarId") || undefined,
          });
          return { ok: true, data };
        }
        case "calendar_create_event": {
          const summary = str(args, "summary");
          const start = str(args, "start");
          const end = str(args, "end");
          if (!summary || !start || !end) {
            return { ok: false, error: "summary, start, and end are required" };
          }
          const attendees = Array.isArray(args.attendees)
            ? args.attendees.filter((item): item is string => typeof item === "string")
            : undefined;
          const data = await createCalendarEvent(auth, {
            summary,
            start,
            end,
            description: str(args, "description") || undefined,
            location: str(args, "location") || undefined,
            timeZone: str(args, "timeZone") || undefined,
            attendees,
            calendarId: str(args, "calendarId") || undefined,
          });
          return { ok: true, data };
        }
        default:
          return { ok: false, error: `Unsupported Prime Google tool: ${name}` };
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Google tool failed",
    };
  }
}
