import {
  DOMAIN_OPTIONS,
  STATUS_OPTIONS,
  type Area,
  type CalendarEvent,
  type GoogleChatMessage,
  type GoogleChatSpace,
  type RecurrenceUnit,
  type RecurringTaskTemplate,
  type Task,
  type TaskCompletionKind,
  type TaskDraft,
  type TaskStatus
} from "@/lib/types";

export const DEFAULT_TIMELINE_START_HOUR = 7;
export const DEFAULT_TIMELINE_END_HOUR = 21;
export const MIN_TIMED_EVENT_DURATION_MINUTES = 30;
export const DONE_RETENTION_DAYS = 5;
export const INBOX_STALE_DAYS = 1;
export const REVIEW_STALE_DAYS = 7;
export const UPCOMING_LOOKAHEAD_DAYS = 3;
export const STARTER_AREAS = ["Health", "Home", "Money", "Errands", "Relationships"];
export const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((status) => status !== "done");

export type TimelineEventLayout = {
  event: CalendarEvent;
  topPercent: number;
  heightPercent: number;
  column: number;
  totalColumns: number;
};

export function sortTasks(tasks: Task[], todayKey = formatDateInputValue(new Date())) {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return STATUS_OPTIONS.indexOf(left.status) - STATUS_OPTIONS.indexOf(right.status);
    }

    if (left.status === "inbox") {
      return getTaskSortTimestamp(right) - getTaskSortTimestamp(left);
    }

    if (left.status === "backlog" || left.status === "today" || left.status === "waiting") {
      const leftDistance = getTaskDistanceFromToday(left, todayKey);
      const rightDistance = getTaskDistanceFromToday(right, todayKey);

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
    }

    if (left.domain !== right.domain) {
      return DOMAIN_OPTIONS.indexOf(left.domain) - DOMAIN_OPTIONS.indexOf(right.domain);
    }

    if (left.due_date && right.due_date) {
      return left.due_date.localeCompare(right.due_date);
    }

    if (left.planned_date && right.planned_date) {
      return left.planned_date.localeCompare(right.planned_date);
    }

    if (left.due_date) {
      return -1;
    }

    if (right.due_date) {
      return 1;
    }

    return left.title.localeCompare(right.title);
  });
}

export function sortCalendarEvents(events: CalendarEvent[]) {
  return [...events].sort((left, right) => {
    const leftStart = left.start ? new Date(left.start).getTime() : Number.MAX_SAFE_INTEGER;
    const rightStart = right.start ? new Date(right.start).getTime() : Number.MAX_SAFE_INTEGER;

    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    if (left.isAllDay !== right.isAllDay) {
      return left.isAllDay ? -1 : 1;
    }

    return left.summary.localeCompare(right.summary);
  });
}

export function sortAreas(items: Area[]) {
  return [...items].sort((left, right) => {
    if (left.archived !== right.archived) {
      return left.archived ? 1 : -1;
    }

    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.name.localeCompare(right.name);
  });
}

export function getChatTimestampValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortChatSpaces(spaces: GoogleChatSpace[]) {
  return [...spaces].sort((left, right) => {
    if (left.unread !== right.unread) {
      return left.unread ? -1 : 1;
    }

    return getChatTimestampValue(right.lastActiveTime) - getChatTimestampValue(left.lastActiveTime);
  });
}

export function getDisplayedChatMessageSenderLabel(
  message: GoogleChatMessage,
  selectedChatSpace: GoogleChatSpace | null
) {
  if (message.isSelf || message.senderLabel !== "Teammate") {
    return message.senderLabel;
  }

  if (selectedChatSpace?.spaceType !== "DIRECT_MESSAGE") {
    return message.senderLabel;
  }

  const spaceLabel = selectedChatSpace.displayName.trim();

  if (!spaceLabel || spaceLabel.toLowerCase() === "direct message") {
    return message.senderLabel;
  }

  return spaceLabel;
}

export function getChatSpaceTypeLabel(spaceType: GoogleChatSpace["spaceType"]) {
  switch (spaceType) {
    case "DIRECT_MESSAGE":
      return "Direct message";
    case "GROUP_CHAT":
      return "Group chat";
    default:
      return "Space";
  }
}

export function formatChatActivityTime(value: string | null) {
  if (!value) {
    return "No activity";
  }

  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return new Intl.DateTimeFormat("en-US", sameDay ? { hour: "numeric", minute: "2-digit" } : {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatChatMessageTime(value: string | null) {
  if (!value) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function isSameDay(value: string | null, date: Date) {
  if (!value) {
    return false;
  }

  const eventDate = parseEventDate(value);

  return (
    eventDate.getFullYear() === date.getFullYear() &&
    eventDate.getMonth() === date.getMonth() &&
    eventDate.getDate() === date.getDate()
  );
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDayHeading(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatHour(hour: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric"
  }).format(new Date(2026, 0, 1, hour));
}

export function formatEventTimeRange(event: CalendarEvent) {
  if (event.isAllDay) {
    return "All day";
  }

  if (!event.start) {
    return "No time";
  }

  const start = new Date(event.start);

  if (!event.end) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(start);
  }

  const end = new Date(event.end);

  return `${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(start)} - ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(end)}`;
}

export function formatEventDateLabel(event: CalendarEvent) {
  if (!event.start) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(parseEventDate(event.start));
}

export function getTaskDueDateFromCalendarEvent(event: CalendarEvent) {
  if (event.isAllDay) {
    if (event.end) {
      return getInclusiveAllDayDate(event.end);
    }

    if (event.start) {
      return extractDateOnly(event.start);
    }

    return null;
  }

  if (event.end) {
    return extractDateOnly(event.end);
  }

  if (event.start) {
    return extractDateOnly(event.start);
  }

  return null;
}

export function extractDateOnly(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return formatDateInputValue(new Date(value));
}

export function getInclusiveAllDayDate(value: string) {
  const date = parseEventDate(value);
  date.setDate(date.getDate() - 1);
  return formatDateInputValue(date);
}

export function getNormalizedTaskStatus(
  status: TaskStatus,
  plannedDate: string | null | undefined,
  dueDate: string | null | undefined,
  todayKey: string
) {
  if (status === "inbox" || status === "waiting" || status === "done") {
    return status;
  }

  if ((plannedDate === todayKey || dueDate === todayKey) && status === "backlog") {
    return "today";
  }

  return status;
}

export function getNormalizedTaskPatch(task: Task, patch: Partial<TaskDraft>, todayKey: string) {
  const nextStatus = getNormalizedTaskStatus(
    patch.status ?? task.status,
    patch.planned_date === undefined ? task.planned_date : patch.planned_date,
    patch.due_date === undefined ? task.due_date : patch.due_date,
    todayKey
  );

  return {
    ...patch,
    area_id: patch.area_id === undefined ? task.area_id ?? null : patch.area_id,
    follow_up_date:
      nextStatus === "waiting"
        ? patch.follow_up_date === undefined
          ? task.follow_up_date ?? null
          : patch.follow_up_date
        : null,
    status: nextStatus
  };
}

export function getTaskLifecyclePatch(task: Task, patch: Partial<Task>) {
  if (patch.status === undefined) {
    return patch;
  }

  const nextStatus = patch.status ?? task.status;

  if (nextStatus === "done") {
    return {
      ...patch,
      completion_kind: (patch.completion_kind as TaskCompletionKind | undefined) ?? "completed",
      completed_at: task.status === "done" ? task.completed_at ?? new Date().toISOString() : new Date().toISOString()
    };
  }

  return {
    ...patch,
    completion_kind: nextStatus === task.status ? task.completion_kind ?? null : null,
    completed_at: nextStatus === task.status ? task.completed_at ?? null : null
  };
}

export function shouldAutoMoveTaskToToday(task: Task, todayKey: string) {
  return task.status === "backlog" && (task.planned_date === todayKey || task.due_date === todayKey);
}

export function isArchivedTask(task: Task, now: Date) {
  if (task.status !== "done") {
    return false;
  }

  const completedAt = getTaskCompletedAt(task);

  if (!completedAt) {
    return false;
  }

  return now.getTime() - completedAt.getTime() > DONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function getTaskCompletedAt(task: Task) {
  const value = task.completed_at ?? task.updated_at ?? task.created_at ?? null;
  return value ? new Date(value) : null;
}

export function formatRelativeArchiveDate(value: string | null) {
  if (!value) {
    return "an unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function toViewTransitionToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function getTaskSortTimestamp(task: Task) {
  const value = task.updated_at ?? task.created_at ?? null;
  return value ? new Date(value).getTime() : 0;
}

export function getTaskAttentionDate(task: Task) {
  if (task.status === "waiting") {
    return task.follow_up_date ?? null;
  }

  return task.planned_date ?? task.due_date ?? null;
}

export function getTaskDistanceFromToday(task: Task, todayKey: string) {
  const attentionDate = getTaskAttentionDate(task);

  if (!attentionDate) {
    return Number.POSITIVE_INFINITY;
  }

  const dueTime = parseEventDate(attentionDate).getTime();
  const todayTime = parseEventDate(todayKey).getTime();
  return Math.abs(dueTime - todayTime);
}

export function getDaysSinceTimestamp(value: string | null | undefined, now: Date) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const date = new Date(value);
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

export function getTaskAgeInDays(task: Task, now: Date) {
  return getDaysSinceTimestamp(task.updated_at ?? task.created_at ?? null, now);
}

export function isDateWithinDays(value: string, todayKey: string, days: number) {
  const delta = parseEventDate(value).getTime() - parseEventDate(todayKey).getTime();
  return delta >= 0 && delta <= days * 24 * 60 * 60 * 1000;
}

export function formatTaskAttentionLabel(task: Task) {
  if (task.status === "inbox") {
    return "Needs triage";
  }

  if (task.status === "waiting" && task.follow_up_date) {
    return `Follow up ${formatDate(task.follow_up_date)}`;
  }

  if (task.planned_date && task.due_date && task.planned_date !== task.due_date) {
    return `Planned ${formatDate(task.planned_date)} / Due ${formatDate(task.due_date)}`;
  }

  if (task.planned_date) {
    return `Planned ${formatDate(task.planned_date)}`;
  }

  if (task.due_date) {
    return `Due ${formatDate(task.due_date)}`;
  }

  return "No date yet";
}

export function getPreparedTaskValues(taskDraft: TaskDraft, todayKey: string) {
  const nextStatus = getNormalizedTaskStatus(
    taskDraft.status,
    taskDraft.planned_date,
    taskDraft.due_date,
    todayKey
  );

  return {
    title: taskDraft.title.trim(),
    description: taskDraft.description?.trim() || null,
    domain: taskDraft.domain,
    status: nextStatus,
    priority: taskDraft.priority,
    planned_date: taskDraft.planned_date ?? null,
    due_date: taskDraft.due_date ?? null,
    follow_up_date: nextStatus === "waiting" ? taskDraft.follow_up_date ?? null : null,
    area_id: taskDraft.area_id ?? null,
    completion_kind: null,
    completed_at: null
  };
}

export function getDueOffsetDays(plannedDate: string | null | undefined, dueDate: string | null | undefined) {
  if (!plannedDate || !dueDate) {
    return 0;
  }

  const planned = parseEventDate(plannedDate).getTime();
  const due = parseEventDate(dueDate).getTime();

  return Math.max(0, Math.round((due - planned) / (24 * 60 * 60 * 1000)));
}

export function advanceRecurringDate(baseDate: string, unit: RecurrenceUnit, count: number) {
  const next = parseEventDate(baseDate);

  if (unit === "day") {
    next.setDate(next.getDate() + count);
  } else if (unit === "week") {
    next.setDate(next.getDate() + count * 7);
  } else {
    next.setMonth(next.getMonth() + count);
  }

  return formatDateInputValue(next);
}

export function buildNextRecurringTask(task: Task, template: RecurringTaskTemplate): Task {
  const sourceDate = task.planned_date ?? task.due_date ?? template.anchor_date;
  const nextPlannedDate = advanceRecurringDate(
    sourceDate,
    template.interval_unit,
    template.interval_count
  );
  const nextDueDate = addDays(parseEventDate(nextPlannedDate), template.due_offset_days);

  return {
    id: crypto.randomUUID(),
    user_id: task.user_id,
    title: template.title,
    description: template.description,
    domain: template.domain,
    status: "backlog",
    priority: template.priority,
    planned_date: nextPlannedDate,
    due_date: formatDateInputValue(nextDueDate),
    follow_up_date: null,
    area_id: template.area_id,
    recurring_template_id: template.id,
    completion_kind: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export function formatRecurrenceSummary(template: RecurringTaskTemplate | null) {
  if (!template) {
    return "a custom rhythm";
  }

  const countLabel = template.interval_count === 1 ? "1" : `${template.interval_count}`;
  const unitLabel =
    template.interval_unit === "day"
      ? template.interval_count === 1
        ? "day"
        : "days"
      : template.interval_unit === "week"
        ? template.interval_count === 1
          ? "week"
          : "weeks"
        : template.interval_count === 1
          ? "month"
          : "months";

  return `${countLabel} ${unitLabel}`;
}

export function getStarterAreas(): Area[] {
  return STARTER_AREAS.map((name, index) => ({
    id: `starter-area-${index}`,
    name,
    position: index,
    archived: false
  }));
}

export function parseEventDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

export function getTimedEventRangeInMinutes(event: CalendarEvent) {
  const startDate = event.start ? new Date(event.start) : null;
  const endDate = event.end ? new Date(event.end) : null;
  const startMinutes = startDate ? startDate.getHours() * 60 + startDate.getMinutes() : 0;
  const rawEndMinutes = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : startMinutes + 60;

  return {
    startMinutes,
    endMinutes: Math.max(rawEndMinutes, startMinutes + MIN_TIMED_EVENT_DURATION_MINUTES)
  };
}

export function getTimelineEventLayouts(
  events: CalendarEvent[],
  startHour: number,
  endHour: number
): TimelineEventLayout[] {
  const timelineStartMinutes = startHour * 60;
  const timelineEndMinutes = endHour * 60;

  const normalized = events
    .map((event) => {
      const range = getTimedEventRangeInMinutes(event);
      const clippedStart = clamp(range.startMinutes, timelineStartMinutes, timelineEndMinutes);
      const clippedEnd = clamp(range.endMinutes, timelineStartMinutes, timelineEndMinutes);

      return {
        event,
        startMinutes: clippedStart,
        endMinutes: Math.max(clippedEnd, clippedStart + MIN_TIMED_EVENT_DURATION_MINUTES)
      };
    })
    .filter((event) => event.startMinutes < timelineEndMinutes && event.endMinutes > timelineStartMinutes)
    .sort((left, right) => {
      if (left.startMinutes !== right.startMinutes) {
        return left.startMinutes - right.startMinutes;
      }

      return left.endMinutes - right.endMinutes;
    });

  const groups: typeof normalized[] = [];
  let currentGroup: typeof normalized = [];
  let currentGroupEnd = -1;

  normalized.forEach((event) => {
    if (!currentGroup.length || event.startMinutes < currentGroupEnd) {
      currentGroup.push(event);
      currentGroupEnd = Math.max(currentGroupEnd, event.endMinutes);
      return;
    }

    groups.push(currentGroup);
    currentGroup = [event];
    currentGroupEnd = event.endMinutes;
  });

  if (currentGroup.length) {
    groups.push(currentGroup);
  }

  const totalTimelineMinutes = timelineEndMinutes - timelineStartMinutes;

  return groups.flatMap((group) => {
    const lanes: number[] = [];
    const assignments = group.map((event) => {
      let column = lanes.findIndex((laneEndMinutes) => laneEndMinutes <= event.startMinutes);

      if (column === -1) {
        lanes.push(event.endMinutes);
        column = lanes.length - 1;
      } else {
        lanes[column] = event.endMinutes;
      }

      return {
        ...event,
        column
      };
    });

    const totalColumns = lanes.length;

    return assignments.map(({ event, startMinutes, endMinutes, column }) => ({
      event,
      topPercent: ((startMinutes - timelineStartMinutes) / totalTimelineMinutes) * 100,
      heightPercent: ((endMinutes - startMinutes) / totalTimelineMinutes) * 100,
      column,
      totalColumns
    }));
  });
}

export function getTimelineEventStyle(
  topPercent: number,
  heightPercent: number,
  column: number,
  totalColumns: number
) {
  const horizontalGapRem = 0.4;

  return {
    top: `calc(${topPercent}% + 0.15rem)`,
    height: `max(calc(${heightPercent}% - 0.3rem), 2.75rem)`,
    left: `calc(${(column / totalColumns) * 100}% + ${horizontalGapRem / 2}rem)`,
    width: `calc(${100 / totalColumns}% - ${horizontalGapRem}rem)`
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatNow(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(now);
}
