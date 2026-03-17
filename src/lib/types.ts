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
  created_at?: string;
  updated_at?: string;
};

export type TaskDraft = Pick<
  Task,
  "title" | "description" | "domain" | "status" | "priority" | "due_date"
>;

