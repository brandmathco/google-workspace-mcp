import { z } from "zod";
import {
  tagManagerCreateTag,
  tagManagerCreateTrigger,
  tagManagerGetContainer,
  tagManagerListAccounts,
  tagManagerListContainers,
  tagManagerListTags,
  tagManagerListTriggers,
  tagManagerListWorkspaces,
  tagManagerPublishWorkspace,
} from "./services/tagManager.js";

const accountEmailProperty = {
  accountEmail: {
    type: "string",
    description:
      "Google account email to use (e.g. you@gmail.com). Defaults to the configured default account.",
  },
} as const;

const accountIdProperty = {
  accountId: {
    type: "string",
    description: "GTM account ID (numeric) or accounts/{id}",
  },
} as const;

const containerIdProperty = {
  containerId: {
    type: "string",
    description: "GTM container ID (numeric) or full containers path segment",
  },
} as const;

const workspaceIdProperty = {
  workspaceId: {
    type: "string",
    description: "GTM workspace ID (numeric). Use Default Workspace from tagmanager_list_workspaces.",
  },
} as const;

export const tagManagerTools = [
  {
    name: "tagmanager_list_accounts",
    description:
      "List Google Tag Manager accounts accessible to the authorized Google account. Read-only. Requires tagmanager OAuth scopes (re-authorize after upgrade) and Tag Manager API enabled in GCP.",
    inputSchema: {
      type: "object",
      properties: { ...accountEmailProperty },
    },
  },
  {
    name: "tagmanager_list_containers",
    description:
      "List GTM containers in an account (includes publicId like GTM-XXXX). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
      },
      required: ["accountId"],
    },
  },
  {
    name: "tagmanager_get_container",
    description: "Get a single GTM container by accountId + containerId. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
      },
      required: ["accountId", "containerId"],
    },
  },
  {
    name: "tagmanager_list_workspaces",
    description: "List workspaces for a GTM container. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
      },
      required: ["accountId", "containerId"],
    },
  },
  {
    name: "tagmanager_list_tags",
    description:
      "List tags in a GTM workspace (GA4, Ads conversion, custom HTML, etc.). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
        ...workspaceIdProperty,
      },
      required: ["accountId", "containerId", "workspaceId"],
    },
  },
  {
    name: "tagmanager_list_triggers",
    description: "List triggers in a GTM workspace. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
        ...workspaceIdProperty,
      },
      required: ["accountId", "containerId", "workspaceId"],
    },
  },
  {
    name: "tagmanager_create_trigger",
    description:
      "Create a GTM trigger in a workspace (e.g. customEvent for jane_book_click). Requires tagmanager.edit.containers scope.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
        ...workspaceIdProperty,
        name: { type: "string", description: "Trigger display name" },
        type: {
          type: "string",
          description: "Trigger type (e.g. customEvent, pageview, linkClick)",
        },
        customEventName: {
          type: "string",
          description: "For customEvent triggers: the dataLayer event name to match",
        },
      },
      required: ["accountId", "containerId", "workspaceId", "name", "type"],
    },
  },
  {
    name: "tagmanager_create_tag",
    description:
      "Create a GTM tag in a workspace (GA4 event, Google Ads conversion, conversion linker, etc.). Requires tagmanager.edit.containers.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
        ...workspaceIdProperty,
        name: { type: "string", description: "Tag display name" },
        type: {
          type: "string",
          description:
            "Tag type: googtag, gaawe (GA4 event), awct (Ads conversion), gclidw (conversion linker), etc.",
        },
        parameter: {
          type: "array",
          description: "GTM parameter objects {type,key,value}",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              key: { type: "string" },
              value: { type: "string" },
            },
          },
        },
        firingTriggerId: {
          type: "array",
          items: { type: "string" },
          description:
            "Trigger IDs. Defaults to built-in All Pages (2147479553) when omitted.",
        },
      },
      required: ["accountId", "containerId", "workspaceId", "name", "type"],
    },
  },
  {
    name: "tagmanager_publish_workspace",
    description:
      "Create a container version from a workspace and publish it live. Requires tagmanager.publish scope.",
    inputSchema: {
      type: "object",
      properties: {
        ...accountEmailProperty,
        ...accountIdProperty,
        ...containerIdProperty,
        ...workspaceIdProperty,
        name: { type: "string", description: "Version name" },
        notes: { type: "string", description: "Optional version notes" },
      },
      required: ["accountId", "containerId", "workspaceId", "name"],
    },
  },
] as const;

const accountEmailSchema = z.string().email().optional();

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleTagManagerTool(
  name: string,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true } | null> {
  switch (name) {
    case "tagmanager_list_accounts": {
      const input = z.object({ accountEmail: accountEmailSchema }).parse(args ?? {});
      return jsonResult(await tagManagerListAccounts(input.accountEmail));
    }
    case "tagmanager_list_containers": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerListContainers(input));
    }
    case "tagmanager_get_container": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerGetContainer(input));
    }
    case "tagmanager_list_workspaces": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerListWorkspaces(input));
    }
    case "tagmanager_list_tags": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
          workspaceId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerListTags(input));
    }
    case "tagmanager_list_triggers": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
          workspaceId: z.string().min(1),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerListTriggers(input));
    }
    case "tagmanager_create_trigger": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
          workspaceId: z.string().min(1),
          name: z.string().min(1),
          type: z.string().min(1),
          customEventName: z.string().min(1).optional(),
        })
        .parse(args ?? {});
      const customEventFilter =
        input.type === "customEvent" && input.customEventName
          ? [
              {
                type: "equals",
                parameter: [
                  { type: "template", key: "arg0", value: "{{_event}}" },
                  { type: "template", key: "arg1", value: input.customEventName },
                ],
              },
            ]
          : undefined;
      return jsonResult(
        await tagManagerCreateTrigger({
          accountEmail: input.accountEmail,
          accountId: input.accountId,
          containerId: input.containerId,
          workspaceId: input.workspaceId,
          name: input.name,
          type: input.type,
          customEventFilter,
        }),
      );
    }
    case "tagmanager_create_tag": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
          workspaceId: z.string().min(1),
          name: z.string().min(1),
          type: z.string().min(1),
          parameter: z
            .array(
              z.object({
                type: z.string().min(1),
                key: z.string().min(1),
                value: z.string().optional(),
              }),
            )
            .optional(),
          firingTriggerId: z.array(z.string().min(1)).optional(),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerCreateTag(input));
    }
    case "tagmanager_publish_workspace": {
      const input = z
        .object({
          accountEmail: accountEmailSchema,
          accountId: z.string().min(1),
          containerId: z.string().min(1),
          workspaceId: z.string().min(1),
          name: z.string().min(1),
          notes: z.string().optional(),
        })
        .parse(args ?? {});
      return jsonResult(await tagManagerPublishWorkspace(input));
    }
    default:
      return null;
  }
}
