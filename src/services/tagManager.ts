import { google } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";
import { getGoogleAuthClient } from "../auth/googleAuth.js";

type AuthClient = OAuth2Client | JWT;

function tagManager(auth: AuthClient) {
  return google.tagmanager({ version: "v2", auth });
}

function requirePathPart(name: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

/** Accept bare ids or full resource paths; return accounts/{id}. */
export function normalizeAccountPath(accountId: string): string {
  const trimmed = requirePathPart("accountId", accountId);
  if (trimmed.startsWith("accounts/")) return trimmed;
  return `accounts/${trimmed}`;
}

/** Return accounts/{a}/containers/{c}. */
export function normalizeContainerPath(accountId: string, containerId: string): string {
  const c = requirePathPart("containerId", containerId);
  if (c.startsWith("accounts/") && c.includes("/containers/")) return c;
  return `${normalizeAccountPath(accountId)}/containers/${c}`;
}

/** Return .../workspaces/{w}. */
export function normalizeWorkspacePath(
  accountId: string,
  containerId: string,
  workspaceId: string,
): string {
  const w = requirePathPart("workspaceId", workspaceId);
  if (w.includes("/workspaces/")) return w;
  return `${normalizeContainerPath(accountId, containerId)}/workspaces/${w}`;
}

export async function tagManagerListAccounts(accountEmail?: string) {
  const auth = await getGoogleAuthClient(accountEmail);
  const api = tagManager(auth);

  const accounts: Array<{
    path: string;
    accountId: string;
    name: string;
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await api.accounts.list({ pageToken });
    for (const account of res.data.account ?? []) {
      accounts.push({
        path: account.path ?? "",
        accountId: account.accountId ?? "",
        name: account.name ?? "",
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return {
    accountCount: accounts.length,
    accounts,
    hint:
      "Pass accountId to tagmanager_list_containers. Re-authorize if you see insufficient scopes (tagmanager.*).",
  };
}

export async function tagManagerListContainers(input: {
  accountEmail?: string;
  accountId: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const parent = normalizeAccountPath(input.accountId);

  const containers: Array<{
    path: string;
    accountId: string;
    containerId: string;
    name: string;
    publicId?: string;
    usageContext?: string[];
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await api.accounts.containers.list({ parent, pageToken });
    for (const container of res.data.container ?? []) {
      containers.push({
        path: container.path ?? "",
        accountId: container.accountId ?? "",
        containerId: container.containerId ?? "",
        name: container.name ?? "",
        publicId: container.publicId ?? undefined,
        usageContext: container.usageContext ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return {
    parent,
    containerCount: containers.length,
    containers,
    hint: "publicId is the GTM-XXXX id used on sites. Pass containerId to list workspaces/tags.",
  };
}

export async function tagManagerListWorkspaces(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const parent = normalizeContainerPath(input.accountId, input.containerId);

  const workspaces: Array<{
    path: string;
    workspaceId: string;
    name: string;
    description?: string;
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await api.accounts.containers.workspaces.list({ parent, pageToken });
    for (const workspace of res.data.workspace ?? []) {
      workspaces.push({
        path: workspace.path ?? "",
        workspaceId: workspace.workspaceId ?? "",
        name: workspace.name ?? "",
        description: workspace.description ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { parent, workspaceCount: workspaces.length, workspaces };
}

export async function tagManagerListTags(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const parent = normalizeWorkspacePath(
    input.accountId,
    input.containerId,
    input.workspaceId,
  );

  const tags: Array<{
    path: string;
    tagId: string;
    name: string;
    type?: string;
    fingerprint?: string;
    paused?: boolean;
    parameter?: Array<{ key?: string; type?: string; value?: string }>;
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await api.accounts.containers.workspaces.tags.list({
      parent,
      pageToken,
    });
    for (const tag of res.data.tag ?? []) {
      tags.push({
        path: tag.path ?? "",
        tagId: tag.tagId ?? "",
        name: tag.name ?? "",
        type: tag.type ?? undefined,
        fingerprint: tag.fingerprint ?? undefined,
        paused: tag.paused ?? undefined,
        parameter: (tag.parameter ?? []).map((p) => ({
          key: p.key ?? undefined,
          type: p.type ?? undefined,
          value: p.value ?? undefined,
        })),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { parent, tagCount: tags.length, tags };
}

export async function tagManagerListTriggers(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const parent = normalizeWorkspacePath(
    input.accountId,
    input.containerId,
    input.workspaceId,
  );

  const triggers: Array<{
    path: string;
    triggerId: string;
    name: string;
    type?: string;
  }> = [];

  let pageToken: string | undefined;
  do {
    const res = await api.accounts.containers.workspaces.triggers.list({
      parent,
      pageToken,
    });
    for (const trigger of res.data.trigger ?? []) {
      triggers.push({
        path: trigger.path ?? "",
        triggerId: trigger.triggerId ?? "",
        name: trigger.name ?? "",
        type: trigger.type ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { parent, triggerCount: triggers.length, triggers };
}

export async function tagManagerGetContainer(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const path = normalizeContainerPath(input.accountId, input.containerId);
  const res = await api.accounts.containers.get({ path });
  const c = res.data;
  return {
    path: c.path ?? path,
    accountId: c.accountId ?? "",
    containerId: c.containerId ?? "",
    name: c.name ?? "",
    publicId: c.publicId ?? undefined,
    domainName: c.domainName ?? undefined,
    usageContext: c.usageContext ?? undefined,
    fingerprint: c.fingerprint ?? undefined,
    tagIds: c.tagIds ?? undefined,
  };
}

const BUILTIN_ALL_PAGES_TRIGGER_ID = "2147479553";

export async function tagManagerCreateTrigger(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  name: string;
  type: string;
  customEventFilter?: Array<{
    type: string;
    parameter: Array<{ type: string; key: string; value: string }>;
  }>;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const parent = normalizeWorkspacePath(
    input.accountId,
    input.containerId,
    input.workspaceId,
  );

  const body: Record<string, unknown> = {
    name: input.name,
    type: input.type,
  };
  if (input.customEventFilter) {
    body.customEventFilter = input.customEventFilter;
  }

  const res = await api.accounts.containers.workspaces.triggers.create({
    parent,
    requestBody: body,
  });

  return {
    path: res.data.path ?? "",
    triggerId: res.data.triggerId ?? "",
    name: res.data.name ?? input.name,
    type: res.data.type ?? input.type,
    fingerprint: res.data.fingerprint ?? undefined,
  };
}

export async function tagManagerCreateTag(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  name: string;
  type: string;
  parameter?: Array<{ type: string; key: string; value?: string }>;
  firingTriggerId?: string[];
  tagFiringOption?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const parent = normalizeWorkspacePath(
    input.accountId,
    input.containerId,
    input.workspaceId,
  );

  const res = await api.accounts.containers.workspaces.tags.create({
    parent,
    requestBody: {
      name: input.name,
      type: input.type,
      parameter: input.parameter,
      firingTriggerId: input.firingTriggerId ?? [BUILTIN_ALL_PAGES_TRIGGER_ID],
      tagFiringOption: input.tagFiringOption ?? "oncePerEvent",
    },
  });

  return {
    path: res.data.path ?? "",
    tagId: res.data.tagId ?? "",
    name: res.data.name ?? input.name,
    type: res.data.type ?? input.type,
    firingTriggerId: res.data.firingTriggerId ?? [],
    fingerprint: res.data.fingerprint ?? undefined,
  };
}

export async function tagManagerPublishWorkspace(input: {
  accountEmail?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  name: string;
  notes?: string;
}) {
  const auth = await getGoogleAuthClient(input.accountEmail);
  const api = tagManager(auth);
  const workspacePath = normalizeWorkspacePath(
    input.accountId,
    input.containerId,
    input.workspaceId,
  );

  const created = await api.accounts.containers.workspaces.create_version({
    path: workspacePath,
    requestBody: {
      name: input.name,
      notes: input.notes ?? "",
    },
  });

  const versionPath = created.data.containerVersion?.path;
  if (!versionPath) {
    throw new Error("create_version did not return containerVersion.path");
  }

  const published = await api.accounts.containers.versions.publish({
    path: versionPath,
  });

  return {
    workspacePath,
    versionPath,
    versionId: created.data.containerVersion?.containerVersionId ?? "",
    versionName: created.data.containerVersion?.name ?? input.name,
    compilerError: created.data.compilerError ?? false,
    publishStatus: published.data.compilerError ? "compiler_error" : "published",
    liveVersionPath: published.data.containerVersion?.path ?? versionPath,
  };
}

export { BUILTIN_ALL_PAGES_TRIGGER_ID };
