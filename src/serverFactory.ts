import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getAccountStore } from "./auth/accountStore.js";
import { getGoogleAuthClient } from "./auth/googleAuth.js";
import {
  getMessage,
  listLabels,
  listMessages,
  moveMessage,
  replyToMessage,
  sendMessage,
} from "./services/gmail.js";
import { createCalendarEvent, listUpcomingEvents } from "./services/calendar.js";
import { createTask, listTasks } from "./services/tasks.js";
import { adsTools, handleAdsTool } from "./adsTools.js";
import { analyticsTools, handleAnalyticsTool } from "./analyticsTools.js";
import { linkedinTools, handleLinkedInTool } from "./linkedinTools.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description:
      "Google account email to use (e.g. you@gmail.com). Defaults to the configured default account.",
  },
} as const;

const tools = [
  {
    name: "google_list_accounts",
    description:
      "List all authorized Google accounts (emails) and which one is the default for MCP tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "google_set_default_account",
    description: "Set the default Google account used when accountEmail is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        accountEmail: {
          type: "string",
          description: "Email of an already-authorized account",
        },
      },
      required: ["accountEmail"],
    },
  },
  {
    name: "google_remove_account",
    description:
      "Remove an authorized Google account and its stored refresh token from the account store.",
    inputSchema: {
      type: "object",
      properties: {
        accountEmail: {
          type: "string",
          description: "Email of the account to remove",
        },
      },
      required: ["accountEmail"],
    },
  },
  {
    name: "gmail_list_messages",
    description:
      "Search and list Gmail messages. Supports Gmail search syntax (e.g. is:unread, from:alice@example.com).",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        query: { type: "string", description: "Gmail search query" },
        maxResults: {
          type: "number",
          description: "Maximum messages to return (default 10)",
        },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional Gmail label IDs to filter by",
        },
      },
    },
  },
  {
    name: "gmail_get_message",
    description: "Read a single Gmail message by ID, including body text.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        messageId: { type: "string", description: "Gmail message ID" },
      },
      required: ["messageId"],
    },
  },
  {
    name: "gmail_reply",
    description: "Reply to a Gmail message in its existing thread.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        messageId: { type: "string", description: "Gmail message ID to reply to" },
        body: { type: "string", description: "Plain-text reply body" },
        replyAll: {
          type: "boolean",
          description: "Reply to all recipients (default false)",
        },
      },
      required: ["messageId", "body"],
    },
  },
  {
    name: "gmail_send",
    description:
      "Compose and send a new Gmail message (not a reply). Use for Ads ops status reports and digests. Requires gmail.compose scope.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        to: {
          type: "string",
          description: "Recipient email (comma-separated allowed for multiple To)",
        },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain-text body" },
        cc: { type: "string", description: "Optional Cc recipients" },
        bcc: { type: "string", description: "Optional Bcc recipients" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_move",
    description:
      "Move a Gmail message by adding/removing labels. Archive with removeLabelIds=['INBOX']; trash with addLabelIds=['TRASH'].",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        messageId: { type: "string", description: "Gmail message ID" },
        addLabelIds: {
          type: "array",
          items: { type: "string" },
          description: "Label IDs to add",
        },
        removeLabelIds: {
          type: "array",
          items: { type: "string" },
          description: "Label IDs to remove",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "gmail_list_labels",
    description: "List Gmail labels with IDs (useful before moving mail).",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty },
    },
  },
  {
    name: "calendar_create_event",
    description: "Create a Google Calendar event on the primary calendar.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        summary: { type: "string", description: "Event title" },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
        start: {
          type: "string",
          description: "ISO 8601 start datetime, e.g. 2026-07-06T10:00:00",
        },
        end: {
          type: "string",
          description: "ISO 8601 end datetime",
        },
        timeZone: {
          type: "string",
          description: "IANA timezone (defaults to system timezone)",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee email addresses",
        },
        calendarId: {
          type: "string",
          description: "Calendar ID (default primary)",
        },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "calendar_list_upcoming",
    description: "List upcoming events from the primary Google Calendar.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        maxResults: { type: "number", description: "Max events (default 10)" },
        calendarId: { type: "string", description: "Calendar ID (default primary)" },
      },
    },
  },
  {
    name: "tasks_create",
    description: "Create a Google Tasks action item.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        title: { type: "string", description: "Task title" },
        notes: { type: "string", description: "Task notes/details" },
        due: {
          type: "string",
          description: "Due date as RFC 3339 date, e.g. 2026-07-06",
        },
        listTitle: {
          type: "string",
          description: "Task list title (creates list if missing)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "tasks_list",
    description: "List open action items from Google Tasks.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        listTitle: { type: "string", description: "Task list title" },
        maxResults: { type: "number", description: "Max tasks (default 20)" },
      },
    },
  },
  ...adsTools,
  ...analyticsTools,
  ...linkedinTools,
] as const;

const accountEmailSchema = z.string().email().optional();

const listMessagesSchema = z.object({
  accountEmail: accountEmailSchema,
  query: z.string().optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  labelIds: z.array(z.string()).optional(),
});

const getMessageSchema = z.object({
  accountEmail: accountEmailSchema,
  messageId: z.string().min(1),
});

const replySchema = z.object({
  accountEmail: accountEmailSchema,
  messageId: z.string().min(1),
  body: z.string().min(1),
  replyAll: z.boolean().optional(),
});

const sendSchema = z.object({
  accountEmail: accountEmailSchema,
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

const moveSchema = z.object({
  accountEmail: accountEmailSchema,
  messageId: z.string().min(1),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
});

const createEventSchema = z.object({
  accountEmail: accountEmailSchema,
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  timeZone: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  calendarId: z.string().optional(),
});

const listEventsSchema = z.object({
  accountEmail: accountEmailSchema,
  maxResults: z.number().int().positive().max(50).optional(),
  calendarId: z.string().optional(),
});

const createTaskSchema = z.object({
  accountEmail: accountEmailSchema,
  title: z.string().min(1),
  notes: z.string().optional(),
  due: z.string().optional(),
  listTitle: z.string().optional(),
});

const listTasksSchema = z.object({
  accountEmail: accountEmailSchema,
  listTitle: z.string().optional(),
  maxResults: z.number().int().positive().max(100).optional(),
});

const setDefaultAccountSchema = z.object({
  accountEmail: z.string().email(),
});

const removeAccountSchema = z.object({
  accountEmail: z.string().email(),
});

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createGoogleWorkspaceMcpServer(): Server {
  const server = new Server(
    {
      name: "google-workspace-mcp",
      version: "1.7.1",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      const adsResult = await handleAdsTool(name, args);
      if (adsResult) return adsResult;

      const analyticsResult = await handleAnalyticsTool(name, args);
      if (analyticsResult) return analyticsResult;

      const linkedinResult = await handleLinkedInTool(name, args);
      if (linkedinResult) return linkedinResult;

      switch (name) {
        case "google_list_accounts": {
          const store = getAccountStore();
          await store.migrateLegacyIfNeeded();
          const accounts = await store.listAccounts();
          const defaultEmail = await store.getDefaultEmail();
          return jsonResult({ defaultAccountEmail: defaultEmail, accounts });
        }
        case "google_set_default_account": {
          const input = setDefaultAccountSchema.parse(args ?? {});
          const store = getAccountStore();
          await store.setDefaultEmail(input.accountEmail);
          return jsonResult({ ok: true, defaultAccountEmail: input.accountEmail });
        }
        case "google_remove_account": {
          const input = removeAccountSchema.parse(args ?? {});
          const store = getAccountStore();
          const removed = await store.removeAccount(input.accountEmail);
          if (!removed) {
            return errorResult(`Account not found: ${input.accountEmail}`);
          }
          const defaultEmail = await store.getDefaultEmail();
          return jsonResult({
            ok: true,
            removed: input.accountEmail,
            defaultAccountEmail: defaultEmail,
          });
        }
        case "gmail_list_messages": {
          const input = listMessagesSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await listMessages(auth, input));
        }
        case "gmail_get_message": {
          const input = getMessageSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await getMessage(auth, input.messageId));
        }
        case "gmail_reply": {
          const input = replySchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await replyToMessage(auth, input));
        }
        case "gmail_send": {
          const input = sendSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await sendMessage(auth, input));
        }
        case "gmail_move": {
          const input = moveSchema.parse(args ?? {});
          if (!input.addLabelIds?.length && !input.removeLabelIds?.length) {
            return errorResult("Provide addLabelIds and/or removeLabelIds");
          }
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await moveMessage(auth, input));
        }
        case "gmail_list_labels": {
          const accountEmail = accountEmailSchema.parse(
            (args as { accountEmail?: string } | undefined)?.accountEmail,
          );
          const auth = await getGoogleAuthClient(accountEmail);
          return jsonResult(await listLabels(auth));
        }
        case "calendar_create_event": {
          const input = createEventSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await createCalendarEvent(auth, input));
        }
        case "calendar_list_upcoming": {
          const input = listEventsSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await listUpcomingEvents(auth, input));
        }
        case "tasks_create": {
          const input = createTaskSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await createTask(auth, input));
        }
        case "tasks_list": {
          const input = listTasksSchema.parse(args ?? {});
          const auth = await getGoogleAuthClient(input.accountEmail);
          return jsonResult(await listTasks(auth, input));
        }
        default:
          return errorResult(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult(message);
    }
  });

  return server;
}
