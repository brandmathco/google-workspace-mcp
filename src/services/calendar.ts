import { google } from "googleapis";
import type { OAuth2Client, JWT } from "google-auth-library";

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timeZone?: string;
  attendees?: string[];
  calendarId?: string;
}

export async function createCalendarEvent(
  auth: OAuth2Client | JWT,
  input: CalendarEventInput,
) {
  const calendar = google.calendar({ version: "v3", auth });
  const timeZone = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const response = await calendar.events.insert({
    calendarId: input.calendarId ?? "primary",
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.start,
        timeZone,
      },
      end: {
        dateTime: input.end,
        timeZone,
      },
      attendees: input.attendees?.map((email) => ({ email })),
    },
  });

  return {
    id: response.data.id ?? "",
    htmlLink: response.data.htmlLink ?? "",
    summary: response.data.summary ?? input.summary,
    start: response.data.start?.dateTime ?? input.start,
    end: response.data.end?.dateTime ?? input.end,
  };
}

export async function listUpcomingEvents(
  auth: OAuth2Client | JWT,
  options: { maxResults?: number; calendarId?: string } = {},
) {
  const calendar = google.calendar({ version: "v3", auth });
  const response = await calendar.events.list({
    calendarId: options.calendarId ?? "primary",
    maxResults: options.maxResults ?? 10,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: new Date().toISOString(),
  });

  return (response.data.items ?? []).map((event) => ({
    id: event.id ?? "",
    summary: event.summary ?? "(no title)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    htmlLink: event.htmlLink ?? "",
  }));
}
