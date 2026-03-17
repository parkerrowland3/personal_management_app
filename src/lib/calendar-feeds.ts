import "server-only";

import * as ical from "node-ical";

import type { CalendarEvent, CalendarFeed } from "@/lib/types";

function toIsoString(value: Date) {
  return value.toISOString();
}

function toDateOnlyString(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export async function loadFeedEvents(feed: CalendarFeed): Promise<CalendarEvent[]> {
  const response = await ical.async.fromURL(feed.url);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  return Object.values(response)
    .filter((entry): entry is ical.VEvent => entry.type === "VEVENT")
    .map((event) => {
      const isAllDay = event.datetype === "date";
      const start = event.start
        ? isAllDay
          ? toDateOnlyString(event.start)
          : toIsoString(event.start)
        : null;
      const end = event.end
        ? isAllDay
          ? toDateOnlyString(event.end)
          : toIsoString(event.end)
        : null;

      return {
        id: `${feed.id}:${event.uid}`,
        summary: event.summary || "Untitled event",
        description: event.description || null,
        htmlLink: event.url || null,
        start,
        end,
        isAllDay,
        source: "ics" as const,
        sourceName: feed.name ?? new URL(feed.url).hostname,
        domain: feed.domain
      };
    })
    .filter((event) => {
      if (!event.start) {
        return false;
      }

      if (event.isAllDay) {
        return parseEventDate(event.start).getTime() >= startOfToday().getTime();
      }

      return new Date(event.start).getTime() >= cutoff;
    })
    .sort((left, right) => {
      if (!left.start || !right.start) {
        return 0;
      }

      return new Date(left.start).getTime() - new Date(right.start).getTime();
    })
    .slice(0, 40);
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function parseEventDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}
