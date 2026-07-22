import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getGoogleAuthClient } from "./auth/googleAuth.js";
import {
  getMessage,
  listLabels,
  listMessages,
  moveMessage,
  replyToMessage,
} from "./services/gmail.js";
import { createCalendarEvent, listUpcomingEvents } from "./services/calendar.js";
import { createTask, listTasks } from "./services/tasks.js";

const tools = [
  {
    name: "gmail_list_messages",
    description:
      "Search and list Gmail messages. Supports Gmail search syntax (e.g. is:unread, from:alice@example.com).",
    inputSchema: {
      type: "object",
      properties: {
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
    name: "gmail_move",
    description:
      "Move a Gmail message by adding/removing labels. Archive with removeLabelIds=['INBOX']; trash with addLabelIds=['TRASH'].",
    inputSchema: {
      type: "object",
      properties: {
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
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "calendar_create_event",
    description: "Create a Google Calendar event on the primary calendar.",
    inputSchema: {
      type: "object",
      properties: {
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
        listTitle: { type: "string", description: "Task list title" },
        maxResults: { type: "number", description: "Max tasks (default 20)" },
      },
    },
  },
] as const;

const listMessagesSchema = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  labelIds: z.array(z.string()).optional(),
});

const getMessageSchema = z.object({
  messageId: z.string().min(1),
});

const replySchema = z.object({
  messageId: z.string().min(1),
  body: z.string().min(1),
  replyAll: z.boolean().optional(),
});

const moveSchema = z.object({
  messageId: z.string().min(1),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
});

const createEventSchema = z.object({
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
  maxResults: z.number().int().positive().max(50).optional(),
  calendarId: z.string().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  due: z.string().optional(),
  listTitle: z.string().optional(),
});

const listTasksSchema = z.object({
  listTitle: z.string().optional(),
  maxResults: z.number().int().positive().max(100).optional(),
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
      version: "1.0.0",
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
      const auth = await getGoogleAuthClient();
      const { name, arguments: args } = request.params;

      switch (name) {
        case "gmail_list_messages": {
          const input = listMessagesSchema.parse(args ?? {});
          return jsonResult(await listMessages(auth, input));
        }
        case "gmail_get_message": {
          const input = getMessageSchema.parse(args ?? {});
          return jsonResult(await getMessage(auth, input.messageId));
        }
        case "gmail_reply": {
          const input = replySchema.parse(args ?? {});
          return jsonResult(await replyToMessage(auth, input));
        }
        case "gmail_move": {
          const input = moveSchema.parse(args ?? {});
          if (!input.addLabelIds?.length && !input.removeLabelIds?.length) {
            return errorResult("Provide addLabelIds and/or removeLabelIds");
          }
          return jsonResult(await moveMessage(auth, input));
        }
        case "gmail_list_labels": {
          return jsonResult(await listLabels(auth));
        }
        case "calendar_create_event": {
          const input = createEventSchema.parse(args ?? {});
          return jsonResult(await createCalendarEvent(auth, input));
        }
        case "calendar_list_upcoming": {
          const input = listEventsSchema.parse(args ?? {});
          return jsonResult(await listUpcomingEvents(auth, input));
        }
        case "tasks_create": {
          const input = createTaskSchema.parse(args ?? {});
          return jsonResult(await createTask(auth, input));
        }
        case "tasks_list": {
          const input = listTasksSchema.parse(args ?? {});
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
