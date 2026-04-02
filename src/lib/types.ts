export const DOMAIN_OPTIONS = ["personal", "work", "school"] as const;
export const STATUS_OPTIONS = [
  "inbox",
  "backlog",
  "today",
  "in_progress",
  "waiting",
  "done"
] as const;
export const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;
export const REVIEW_TYPES = ["daily", "weekly"] as const;
export const RECURRENCE_UNITS = ["day", "week", "month"] as const;

export type Domain = (typeof DOMAIN_OPTIONS)[number];
export type TaskStatus = (typeof STATUS_OPTIONS)[number];
export type TaskPriority = (typeof PRIORITY_OPTIONS)[number];
export type ReviewType = (typeof REVIEW_TYPES)[number];
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];
export type TaskCompletionKind = "completed" | "skipped" | null;

export type Task = {
  id: string;
  user_id?: string;
  title: string;
  description: string | null;
  domain: Domain;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  planned_date?: string | null;
  follow_up_date?: string | null;
  area_id?: string | null;
  recurring_template_id?: string | null;
  google_calendar_event_id?: string | null;
  google_calendar_event_url?: string | null;
  google_calendar_last_synced_at?: string | null;
  completion_kind?: TaskCompletionKind;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaskDraft = Pick<
  Task,
  | "title"
  | "description"
  | "domain"
  | "status"
  | "priority"
  | "due_date"
  | "planned_date"
  | "follow_up_date"
  | "area_id"
>;

export type Area = {
  id: string;
  user_id?: string;
  name: string;
  position: number;
  archived: boolean;
  created_at?: string;
  updated_at?: string;
};

export type TaskChecklistItem = {
  id: string;
  user_id?: string;
  task_id: string;
  label: string;
  position: number;
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RecurringTaskTemplate = {
  id: string;
  user_id?: string;
  title: string;
  description: string | null;
  domain: Domain;
  priority: TaskPriority;
  area_id: string | null;
  anchor_date: string;
  interval_unit: RecurrenceUnit;
  interval_count: number;
  due_offset_days: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ReviewSession = {
  id: string;
  user_id?: string;
  review_type: ReviewType;
  review_date: string;
  note: string | null;
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

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

export type Bookmark = {
  id: string;
  label: string;
  url: string;
  position: number;
};
