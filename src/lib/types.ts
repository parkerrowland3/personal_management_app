export const DOMAIN_OPTIONS = ["personal", "work", "school"] as const;
export const STATUS_OPTIONS = ["backlog", "today", "in_progress", "done"] as const;
export const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;

export type Domain = (typeof DOMAIN_OPTIONS)[number];
export type TaskStatus = (typeof STATUS_OPTIONS)[number];
export type TaskPriority = (typeof PRIORITY_OPTIONS)[number];

export type Task = {
  id: string;
  user_id?: string;
  title: string;
  description: string | null;
  domain: Domain;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  google_calendar_event_id?: string | null;
  google_calendar_event_url?: string | null;
  google_calendar_last_synced_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaskDraft = Pick<
  Task,
  "title" | "description" | "domain" | "status" | "priority" | "due_date"
>;

export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  defaultDomain: Domain | null;
};

export type GoogleChatStatus = {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
};

export type GoogleChatAliasTargetType = "space" | "sender";

export type GoogleChatAlias = {
  targetType: GoogleChatAliasTargetType;
  targetName: string;
  label: string;
};

export type GoogleChatSpaceType = "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE";

export type GoogleChatSpace = {
  name: string;
  displayName: string;
  spaceType: GoogleChatSpaceType;
  lastActiveTime: string | null;
  lastReadTime: string | null;
  unread: boolean;
  previewText: string | null;
};

export type GoogleChatMessage = {
  name: string;
  text: string;
  createTime: string | null;
  senderName: string | null;
  senderType: string | null;
  senderLabel: string;
  isSelf: boolean;
  threadName: string | null;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  description: string | null;
  htmlLink: string | null;
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  source: "google" | "ics";
  sourceName: string | null;
  domain: Domain | null;
};

export type CalendarFeed = {
  id: string;
  name: string | null;
  url: string;
  domain: Domain;
};
