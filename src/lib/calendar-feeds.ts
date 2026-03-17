import "server-only";

import * as ical from "node-ical";

import type { CalendarEvent, CalendarFeed } from "@/lib/types";

function toIsoString(value: Date) {
  return value.toISOString();
}

export async function loadFeedEvents(feed: CalendarFeed): Promise<CalendarEvent[]> {
  const response = await ical.async.fromURL(feed.url);
  const now = Date.now();

  return Object.values(response)
    .filter((entry): entry is ical.VEvent => entry.type === "VEVENT")
    .map((event) => {
      const start = event.start ? toIsoString(event.start) : null;
      const end = event.end ? toIsoString(event.end) : null;
      const isAllDay = event.datetype === "date";

      return {
        id: `${feed.id}:${event.uid}`,
        summary: event.summary || "Untitled event",
        description: event.description || null,
        htmlLink: event.url || null,
        start,
        end,
        isAllDay,
        source: "ics" as const,
        sourceName: feed.name ?? new URL(feed.url).hostname
      };
    })
    .filter((event) => {
      if (!event.start) {
        return false;
      }

      return new Date(event.start).getTime() >= now - 24 * 60 * 60 * 1000;
    })
    .sort((left, right) => {
      if (!left.start || !right.start) {
        return 0;
      }

      return new Date(left.start).getTime() - new Date(right.start).getTime();
    })
    .slice(0, 40);
}

