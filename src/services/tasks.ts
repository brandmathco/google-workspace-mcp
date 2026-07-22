import { google } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";

export interface TaskInput {
  title: string;
  notes?: string;
  due?: string;
  listTitle?: string;
}

async function resolveTaskListId(
  auth: OAuth2Client | JWT,
  listTitle: string,
): Promise<string> {
  const tasks = google.tasks({ version: "v1", auth });
  const lists = await tasks.tasklists.list({ maxResults: 100 });
  const existing = (lists.data.items ?? []).find(
    (item) => item.title?.toLowerCase() === listTitle.toLowerCase(),
  );

  if (existing?.id) {
    return existing.id;
  }

  const created = await tasks.tasklists.insert({
    requestBody: { title: listTitle },
  });

  if (!created.data.id) {
    throw new Error(`Failed to create task list "${listTitle}"`);
  }

  return created.data.id;
}

export async function createTask(auth: OAuth2Client | JWT, input: TaskInput) {
  const tasks = google.tasks({ version: "v1", auth });
  const listTitle =
    input.listTitle ??
    process.env.GOOGLE_TASKS_DEFAULT_LIST?.trim() ??
    "Action items";

  const taskListId = await resolveTaskListId(auth, listTitle);

  const response = await tasks.tasks.insert({
    tasklist: taskListId,
    requestBody: {
      title: input.title,
      notes: input.notes,
      due: input.due,
    },
  });

  return {
    id: response.data.id ?? "",
    title: response.data.title ?? input.title,
    status: response.data.status ?? "needsAction",
    due: response.data.due ?? input.due,
    listTitle,
  };
}

export async function listTasks(
  auth: OAuth2Client | JWT,
  options: { listTitle?: string; maxResults?: number } = {},
) {
  const tasks = google.tasks({ version: "v1", auth });
  const listTitle =
    options.listTitle ??
    process.env.GOOGLE_TASKS_DEFAULT_LIST?.trim() ??
    "Action items";

  const taskListId = await resolveTaskListId(auth, listTitle);
  const response = await tasks.tasks.list({
    tasklist: taskListId,
    maxResults: options.maxResults ?? 20,
    showCompleted: false,
  });

  return (response.data.items ?? []).map((task) => ({
    id: task.id ?? "",
    title: task.title ?? "",
    status: task.status ?? "",
    due: task.due ?? "",
    notes: task.notes ?? "",
    listTitle,
  }));
}
