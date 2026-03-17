import type { Task } from "@/lib/types";

export const sampleTasks: Task[] = [
  {
    id: "sample-1",
    title: "Plan weekly meals",
    description: "Outline dinners, grocery run, and prep blocks for the week.",
    domain: "personal",
    status: "today",
    priority: "medium",
    due_date: new Date().toISOString().slice(0, 10),
    google_calendar_event_id: null,
    google_calendar_event_url: null,
    google_calendar_last_synced_at: null
  },
  {
    id: "sample-2",
    title: "Prepare sprint review notes",
    description: "Collect wins, blockers, and next-step decisions for Friday.",
    domain: "work",
    status: "in_progress",
    priority: "high",
    due_date: null,
    google_calendar_event_id: null,
    google_calendar_event_url: null,
    google_calendar_last_synced_at: null
  },
  {
    id: "sample-3",
    title: "Read chapter 6 and annotate",
    description: "Focus on the research methods section and pull three key quotes.",
    domain: "school",
    status: "backlog",
    priority: "medium",
    due_date: null,
    google_calendar_event_id: null,
    google_calendar_event_url: null,
    google_calendar_last_synced_at: null
  },
  {
    id: "sample-4",
    title: "Renew car registration",
    description: "Check emissions requirement before submitting the renewal.",
    domain: "personal",
    status: "done",
    priority: "low",
    due_date: null,
    google_calendar_event_id: null,
    google_calendar_event_url: null,
    google_calendar_last_synced_at: null
  }
];
