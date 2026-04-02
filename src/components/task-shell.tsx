"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type FormEvent,
  type ReactNode
} from "react";
import type { Session } from "@supabase/supabase-js";
import { flushSync } from "react-dom";

import { sampleTasks } from "@/lib/sample-data";
import {
  RECURRENCE_UNITS,
  DOMAIN_OPTIONS,
  PRIORITY_OPTIONS,
  REVIEW_TYPES,
  STATUS_OPTIONS,
  type Area,
  type Bookmark,
  type CalendarEvent,
  type CalendarFeed,
  type Domain,
  type GoogleCalendarStatus,
  type GoogleChatAliasTargetType,
  type GoogleChatMessage,
  type GoogleChatSpace,
  type GoogleChatStatus,
  type RecurrenceUnit,
  type RecurringTaskTemplate,
  type ReviewSession,
  type Task,
  type TaskChecklistItem,
  type TaskCompletionKind,
  type TaskDraft,
  type TaskPriority,
  type TaskStatus
} from "@/lib/types";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const EMPTY_TASK: TaskDraft = {
  title: "",
  description: "",
  domain: "personal",
  status: "backlog",
  priority: "medium",
  due_date: null,
  planned_date: null,
  follow_up_date: null,
  area_id: null
};

const EMPTY_EVENT_DRAFT = {
  title: "",
  description: "",
  date: new Date().toISOString().slice(0, 10),
  allDay: false,
  startTime: "09:00",
  endTime: "10:00",
  domain: "personal" as Domain
};

const statusLabels: Record<TaskStatus, string> = {
  inbox: "Inbox",
  backlog: "Backlog",
  today: "Today",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done"
};

const domainLabels: Record<Domain, string> = {
  personal: "Personal",
  work: "Work",
  school: "School"
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High"
};

const DEFAULT_TIMELINE_START_HOUR = 7;
const DEFAULT_TIMELINE_END_HOUR = 21;
const MIN_TIMED_EVENT_DURATION_MINUTES = 30;
const DONE_RETENTION_DAYS = 5;
const INBOX_STALE_DAYS = 1;
const REVIEW_STALE_DAYS = 7;
const UPCOMING_LOOKAHEAD_DAYS = 3;
const STARTER_AREAS = ["Health", "Home", "Money", "Errands", "Relationships"];
const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((status) => status !== "done");

const EMPTY_RECURRENCE_DRAFT = {
  enabled: false,
  intervalUnit: "week" as RecurrenceUnit,
  intervalCount: 1,
  anchorDate: formatDateInputValue(new Date()),
  dueOffsetDays: 0,
  isActive: true
};

type MobileSection = "tasks" | "calendar" | "review" | "more";
type WorkspaceView = "dashboard" | "review";
type ReviewFocus = "daily" | "weekly";

type TimelineEventLayout = {
  event: CalendarEvent;
  topPercent: number;
  heightPercent: number;
  column: number;
  totalColumns: number;
};

type ChatAliasEditorState = {
  targetType: GoogleChatAliasTargetType;
  targetName: string;
  title: string;
  helper: string;
  draftLabel: string;
};

type RecurrenceDraft = typeof EMPTY_RECURRENCE_DRAFT;

const MOBILE_SECTIONS: Array<{ id: MobileSection; label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "review", label: "Review" },
  { id: "more", label: "More" }
];

function sortTasks(tasks: Task[], todayKey = formatDateInputValue(new Date())) {
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

function sortCalendarEvents(events: CalendarEvent[]) {
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

function sortAreas(items: Area[]) {
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

export function TaskShell() {
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>(sampleTasks);
  const [areas, setAreas] = useState<Area[]>(getStarterAreas());
  const [checklistItems, setChecklistItems] = useState<TaskChecklistItem[]>([]);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [reviewSessions, setReviewSessions] = useState<ReviewSession[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(sampleTasks[0]?.id ?? null);
  const [selectedFeed, setSelectedFeed] = useState<CalendarFeed | null>(null);
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEvent | null>(null);
  const [isAddTaskOverlayOpen, setIsAddTaskOverlayOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEventOverlayOpen, setIsEventOverlayOpen] = useState(false);
  const [isChatOverlayOpen, setIsChatOverlayOpen] = useState(false);
  const [chatAliasEditor, setChatAliasEditor] = useState<ChatAliasEditorState | null>(null);
  const [isArchiveOverlayOpen, setIsArchiveOverlayOpen] = useState(false);
  const [isFeedOverlayOpen, setIsFeedOverlayOpen] = useState(false);
  const [isFeedDetailOverlayOpen, setIsFeedDetailOverlayOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK);
  const [quickCapture, setQuickCapture] = useState("");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("dashboard");
  const [reviewFocus, setReviewFocus] = useState<ReviewFocus>("daily");
  const [areaDraftName, setAreaDraftName] = useState("");
  const [dailyReviewNote, setDailyReviewNote] = useState("");
  const [weeklyReviewNote, setWeeklyReviewNote] = useState("");
  const [checklistDraftLabel, setChecklistDraftLabel] = useState("");
  const [recurrenceDraft, setRecurrenceDraft] = useState<RecurrenceDraft>(EMPTY_RECURRENCE_DRAFT);
  const [eventDraft, setEventDraft] = useState(EMPTY_EVENT_DRAFT);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [isAwaitingEmailCode, setIsAwaitingEmailCode] = useState(false);
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<Domain | "all">("all");
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedDomain, setFeedDomain] = useState<Domain>("personal");
  const [feedEditName, setFeedEditName] = useState("");
  const [feedEditUrl, setFeedEditUrl] = useState("");
  const [feedEditDomain, setFeedEditDomain] = useState<Domain>("personal");
  const [archivedDomainFilter, setArchivedDomainFilter] = useState<Domain | "all">("all");
  const [webSearch, setWebSearch] = useState("");
  const [webSearchSuggestions, setWebSearchSuggestions] = useState<string[]>([]);
  const [selectedWebSuggestionIndex, setSelectedWebSuggestionIndex] = useState(-1);
  const [isWebSearchFocused, setIsWebSearchFocused] = useState(false);
  const [isWebSearchLoading, setIsWebSearchLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured());
  const [isSaving, setIsSaving] = useState(false);
  const [isTaskConversionBusy, setIsTaskConversionBusy] = useState(false);
  const [isCalendarBusy, setIsCalendarBusy] = useState(false);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const [isChatAliasBusy, setIsChatAliasBusy] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatMessagesLoading, setIsChatMessagesLoading] = useState(false);
  const [isFeedBusy, setIsFeedBusy] = useState(false);
  const [isAreaBusy, setIsAreaBusy] = useState(false);
  const [isChecklistBusy, setIsChecklistBusy] = useState(false);
  const [isRecurringBusy, setIsRecurringBusy] = useState(false);
  const [isReviewSaving, setIsReviewSaving] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus>({
    configured: false,
    connected: false,
    googleEmail: null,
    calendarId: null,
    defaultDomain: null
  });
  const [chatStatus, setChatStatus] = useState<GoogleChatStatus>({
    configured: false,
    connected: false,
    googleEmail: null
  });
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarFeeds, setCalendarFeeds] = useState<CalendarFeed[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isAddBookmarkOverlayOpen, setIsAddBookmarkOverlayOpen] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const [bookmarkUrl, setBookmarkUrl] = useState("");
  const [bookmarkMoreOpen, setBookmarkMoreOpen] = useState(false);
  const [visibleBookmarkCount, setVisibleBookmarkCount] = useState(999);
  const bookmarkBarRef = useRef<HTMLDivElement>(null);
  const bookmarkMoreRef = useRef<HTMLDivElement>(null);
  const bookmarkItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [chatSpaces, setChatSpaces] = useState<GoogleChatSpace[]>([]);
  const [selectedChatSpaceName, setSelectedChatSpaceName] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<GoogleChatMessage[]>([]);
  const [chatComposer, setChatComposer] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("tasks");
  const [mobileTaskStatus, setMobileTaskStatus] = useState<TaskStatus>("today");
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(
    isSupabaseConfigured()
      ? null
      : "Demo mode is active. Add your Supabase URL and anon key to connect live data."
  );
  const [googleAuthExpired, setGoogleAuthExpired] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);

  const deferredSearch = useDeferredValue(search);
  const todayKey = useMemo(() => formatDateInputValue(now), [now]);
  const supabase = getSupabaseBrowserClient();

  const anyOverlayOpen =
    isAddTaskOverlayOpen ||
    isAddBookmarkOverlayOpen ||
    isDetailOpen ||
    isEventOverlayOpen ||
    isChatOverlayOpen ||
    chatAliasEditor !== null ||
    isArchiveOverlayOpen ||
    isFeedOverlayOpen ||
    isFeedDetailOverlayOpen ||
    selectedCalendarEvent !== null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    if (anyOverlayOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    document.body.style.overflow = previousOverflow;

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [anyOverlayOpen]);

  const getAccessToken = useCallback(async () => {
    if (!supabase) {
      return null;
    }

    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [supabase]);

  const loadCalendarStatus = useCallback(async () => {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setCalendarStatus({
        configured: false,
        connected: false,
        googleEmail: null,
        calendarId: null,
        defaultDomain: null
      });
      return;
    }

    const response = await fetch("/api/google-calendar/status", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(payload?.error ?? "Unable to load Google Calendar status.");
      return;
    }

    const payload = (await response.json()) as GoogleCalendarStatus;
    setCalendarStatus(payload);
  }, [getAccessToken]);

  const loadChatStatus = useCallback(async () => {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setChatStatus({
        configured: false,
        connected: false,
        googleEmail: null
      });
      return;
    }

    const response = await fetch("/api/google-chat/status", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(payload?.error ?? "Unable to load Google Chat status.");
      return;
    }

    const payload = (await response.json()) as GoogleChatStatus;
    setChatStatus(payload);
  }, [getAccessToken]);

  const loadCalendarEvents = useCallback(async () => {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setCalendarEvents([]);
      return;
    }

    const response = await fetch("/api/google-calendar/events", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(payload?.error ?? "Unable to load calendar events.");
      setCalendarEvents([]);
      setGoogleAuthExpired(false);
      return;
    }

    const payload = (await response.json()) as { events: CalendarEvent[]; googleAuthExpired?: boolean };
    setCalendarEvents(payload.events);
    setGoogleAuthExpired(payload.googleAuthExpired === true);
  }, [getAccessToken]);

  const loadCalendarFeeds = useCallback(async () => {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setCalendarFeeds([]);
      return;
    }

    const response = await fetch("/api/calendar-feeds", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(payload?.error ?? "Unable to load calendar feeds.");
      return;
    }

    const payload = (await response.json()) as { feeds: CalendarFeed[] };
    setCalendarFeeds(payload.feeds);
  }, [getAccessToken]);

  const loadBookmarks = useCallback(
    async (userId: string) => {
      if (!supabase) {
        try {
          const stored = localStorage.getItem("focus-desk-bookmarks");
          if (stored) setBookmarks(JSON.parse(stored) as Bookmark[]);
        } catch {}
        return;
      }
      const { data } = await supabase
        .from("web_bookmarks")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true });
      if (data) setBookmarks(data as Bookmark[]);
    },
    [supabase]
  );

  const loadAreas = useCallback(
    async (userId: string) => {
      if (!supabase || !userId) {
        setAreas(getStarterAreas());
        return;
      }

      const { data, error } = await supabase
        .from("areas")
        .select("*")
        .eq("user_id", userId)
        .order("position", { ascending: true });

      if (error) {
        setNotice(error.message);
        return;
      }

      setAreas(sortAreas((data as Area[] | null) ?? []));
    },
    [supabase]
  );

  const loadChecklistItems = useCallback(
    async (userId: string) => {
      if (!supabase || !userId) {
        setChecklistItems([]);
        return;
      }

      const { data, error } = await supabase
        .from("task_checklist_items")
        .select("*")
        .eq("user_id", userId)
        .order("task_id", { ascending: true })
        .order("position", { ascending: true });

      if (error) {
        setNotice(error.message);
        return;
      }

      setChecklistItems((data as TaskChecklistItem[] | null) ?? []);
    },
    [supabase]
  );

  const loadRecurringTemplates = useCallback(
    async (userId: string) => {
      if (!supabase || !userId) {
        setRecurringTemplates([]);
        return;
      }

      const { data, error } = await supabase
        .from("recurring_task_templates")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) {
        setNotice(error.message);
        return;
      }

      setRecurringTemplates((data as RecurringTaskTemplate[] | null) ?? []);
    },
    [supabase]
  );

  const loadReviewSessions = useCallback(
    async (userId: string) => {
      if (!supabase || !userId) {
        setReviewSessions([]);
        return;
      }

      const { data, error } = await supabase
        .from("review_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false });

      if (error) {
        setNotice(error.message);
        return;
      }

      setReviewSessions((data as ReviewSession[] | null) ?? []);
    },
    [supabase]
  );

  const loadChatSpaces = useCallback(
    async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setChatSpaces([]);
        setSelectedChatSpaceName(null);
        setIsChatLoading(false);
        return;
      }

      if (showLoading) {
        setIsChatLoading(true);
      }

      const response = await fetch("/api/google-chat/spaces", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice(payload?.error ?? "Unable to load Google Chat spaces.");
        setChatSpaces([]);
        setSelectedChatSpaceName(null);
        setIsChatLoading(false);
        return;
      }

      const payload = (await response.json()) as { spaces: GoogleChatSpace[] };
      setChatSpaces(payload.spaces);
      setSelectedChatSpaceName((current) => {
        if (current && payload.spaces.some((space) => space.name === current)) {
          return current;
        }

        return payload.spaces.find((space) => space.unread)?.name ?? payload.spaces[0]?.name ?? null;
      });
      setIsChatLoading(false);
    },
    [getAccessToken]
  );

  const loadChatMessages = useCallback(
    async (spaceName: string, { showLoading = true }: { showLoading?: boolean } = {}) => {
      const accessToken = await getAccessToken();

      if (!accessToken || !spaceName) {
        setChatMessages([]);
        setIsChatMessagesLoading(false);
        return;
      }

      if (showLoading) {
        setIsChatMessagesLoading(true);
      }

      const response = await fetch(`/api/google-chat/messages?space=${encodeURIComponent(spaceName)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice(payload?.error ?? "Unable to load Google Chat messages.");
        setChatMessages([]);
        setIsChatMessagesLoading(false);
        return;
      }

      const payload = (await response.json()) as { messages: GoogleChatMessage[] };
      setChatMessages(payload.messages);
      setIsChatMessagesLoading(false);
    },
    [getAccessToken]
  );

  const loadTasks = useCallback(
    async (userId: string) => {
      if (!supabase) {
        return;
      }

      setIsLoading(true);

      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false });

      if (error) {
        setNotice(error.message);
        setIsLoading(false);
        return;
      }

      const nextTasks = sortTasks((data ?? []) as Task[]);
      setTasks(nextTasks);
      setSelectedTaskId(nextTasks[0]?.id ?? null);
      setNotice(null);
      setIsLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarConnected = params.get("calendar");
    const calendarError = params.get("calendar_error");
    const chatConnected = params.get("chat");
    const chatError = params.get("chat_error");

    if (!calendarConnected && !calendarError && !chatConnected && !chatError) {
      return;
    }

    if (calendarConnected === "connected") {
      setNotice("Google Calendar connected.");
      setGoogleAuthExpired(false);
      void loadCalendarStatus();
      void loadCalendarEvents();
    }

    if (calendarError) {
      setNotice(`Google Calendar error: ${calendarError}`);
    }

    if (chatConnected === "connected") {
      setNotice("Google Chat connected.");
      void loadChatStatus();
      void loadChatSpaces();
    }

    if (chatError) {
      setNotice(`Google Chat error: ${chatError}`);
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("calendar");
    nextUrl.searchParams.delete("calendar_error");
    nextUrl.searchParams.delete("chat");
    nextUrl.searchParams.delete("chat_error");
    window.history.replaceState({}, "", nextUrl.toString());
  }, [loadCalendarEvents, loadCalendarStatus, loadChatSpaces, loadChatStatus]);

  useEffect(() => {
    if (!anyOverlayOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAddTaskOverlayOpen(false);
        setIsDetailOpen(false);
        setIsEventOverlayOpen(false);
        setIsChatOverlayOpen(false);
        setChatAliasEditor(null);
        setIsArchiveOverlayOpen(false);
        setIsFeedOverlayOpen(false);
        setIsFeedDetailOverlayOpen(false);
        setSelectedCalendarEvent(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [anyOverlayOpen]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const query = webSearch.trim();

    if (query.length < 1) {
      setWebSearchSuggestions([]);
      setSelectedWebSuggestionIndex(-1);
      setIsWebSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setIsWebSearchLoading(true);
        const response = await fetch(
          `/api/web-search/suggestions?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          setWebSearchSuggestions([]);
          setSelectedWebSuggestionIndex(-1);
          setIsWebSearchLoading(false);
          return;
        }

        const payload = (await response.json()) as { suggestions?: string[] };
        setWebSearchSuggestions(payload.suggestions ?? []);
        setSelectedWebSuggestionIndex(-1);
        setIsWebSearchLoading(false);
      } catch {
        setWebSearchSuggestions([]);
        setSelectedWebSuggestionIndex(-1);
        setIsWebSearchLoading(false);
      }
    }, 140);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      setIsWebSearchLoading(false);
    };
  }, [webSearch]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const client = supabase;
    let isMounted = true;

    async function bootstrap() {
      const { data: sessionData } = await client.auth.getSession();

      let tasksResult:
        | { data: Task[]; error: null }
        | {
            data: Task[] | null;
            error: { message: string } | null;
          } = { data: [], error: null };

      if (sessionData.session?.user.id) {
        const result = await client
          .from("tasks")
          .select("*")
          .eq("user_id", sessionData.session.user.id)
          .order("status", { ascending: true })
          .order("updated_at", { ascending: false });

        tasksResult = {
          data: (result.data as Task[] | null) ?? [],
          error: result.error ? { message: result.error.message } : null
        };
      }

      if (!isMounted) {
        return;
      }

      setSession(sessionData.session);

      if (tasksResult.error) {
        setNotice(tasksResult.error.message);
      } else if (tasksResult.data && tasksResult.data.length > 0) {
        const nextTasks = sortTasks(tasksResult.data as Task[]);
        setTasks(nextTasks);
        setSelectedTaskId((current) => current ?? nextTasks[0]?.id ?? null);
      } else if (sessionData.session) {
        setTasks([]);
        setSelectedTaskId(null);
      }

      if (sessionData.session?.user.id) {
        void loadCalendarStatus();
        void loadCalendarEvents();
        void loadCalendarFeeds();
        void loadChatStatus();
        void loadBookmarks(sessionData.session.user.id);
        void loadAreas(sessionData.session.user.id);
        void loadChecklistItems(sessionData.session.user.id);
        void loadRecurringTemplates(sessionData.session.user.id);
        void loadReviewSessions(sessionData.session.user.id);
      } else {
        void loadBookmarks("");
        void loadAreas("");
        void loadChecklistItems("");
        void loadRecurringTemplates("");
        void loadReviewSessions("");
      }

      setIsLoading(false);
    }

    bootstrap();

    const authSubscription = client.auth.onAuthStateChange((_event, nextSession) => {
      startTransition(() => {
        setSession(nextSession);
      });

      if (nextSession?.user.id) {
        setEmailCode("");
        setIsAwaitingEmailCode(false);
        void loadTasks(nextSession.user.id);
        void loadCalendarStatus();
        void loadCalendarEvents();
        void loadCalendarFeeds();
        void loadChatStatus();
        void loadBookmarks(nextSession.user.id);
        void loadAreas(nextSession.user.id);
        void loadChecklistItems(nextSession.user.id);
        void loadRecurringTemplates(nextSession.user.id);
        void loadReviewSessions(nextSession.user.id);
      } else {
        setTasks(sampleTasks);
        setAreas(getStarterAreas());
        setChecklistItems([]);
        setRecurringTemplates([]);
        setReviewSessions([]);
        setSelectedTaskId(sampleTasks[0]?.id ?? null);
        setSelectedFeed(null);
        setIsAddTaskOverlayOpen(false);
        setIsDetailOpen(false);
        setIsEventOverlayOpen(false);
        setIsChatOverlayOpen(false);
        setChatAliasEditor(null);
        setIsArchiveOverlayOpen(false);
        setIsFeedOverlayOpen(false);
        setIsFeedDetailOverlayOpen(false);
        setSelectedCalendarEvent(null);
        setCalendarStatus({
          configured: false,
          connected: false,
          googleEmail: null,
          calendarId: null,
          defaultDomain: null
        });
        setChatStatus({
          configured: false,
          connected: false,
          googleEmail: null
        });
        setCalendarEvents([]);
        setCalendarFeeds([]);
        setBookmarks([]);
        setChatSpaces([]);
        setSelectedChatSpaceName(null);
        setChatMessages([]);
        setChatComposer("");
        setQuickCapture("");
        setAreaDraftName("");
        setDailyReviewNote("");
        setWeeklyReviewNote("");
        setChecklistDraftLabel("");
        setWorkspaceView("dashboard");
        setReviewFocus("daily");
        setDraft(EMPTY_TASK);
        setRecurrenceDraft(EMPTY_RECURRENCE_DRAFT);
        setEmailCode("");
        setIsAwaitingEmailCode(false);
        setNotice("Signed out. Demo mode data is shown until you sign in again.");
      }
    });

    return () => {
      isMounted = false;
      authSubscription.data.subscription.unsubscribe();
    };
  }, [
    loadBookmarks,
    loadAreas,
    loadCalendarEvents,
    loadCalendarFeeds,
    loadCalendarStatus,
    loadChecklistItems,
    loadChatStatus,
    loadRecurringTemplates,
    loadReviewSessions,
    loadTasks,
    supabase
  ]);

  useEffect(() => {
    if (!session?.user.id || !chatStatus.connected || activeDomain !== "work") {
      return;
    }

    void loadChatSpaces({ showLoading: chatSpaces.length === 0 });

    const interval = window.setInterval(() => {
      void loadChatSpaces({ showLoading: false });
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [activeDomain, chatSpaces.length, chatStatus.connected, loadChatSpaces, session?.user.id]);

  useEffect(() => {
    if (!isChatOverlayOpen || !chatStatus.connected || !selectedChatSpaceName) {
      return;
    }

    void loadChatMessages(selectedChatSpaceName, { showLoading: chatMessages.length === 0 });

    const interval = window.setInterval(() => {
      void loadChatMessages(selectedChatSpaceName, { showLoading: false });
    }, 25_000);

    return () => window.clearInterval(interval);
  }, [
    chatMessages.length,
    chatStatus.connected,
    isChatOverlayOpen,
    loadChatMessages,
    selectedChatSpaceName
  ]);

  useEffect(() => {
    const bar = bookmarkBarRef.current;
    if (!bar) return;

    function computeVisibleCount() {
      if (!bar) return;
      const ADD_BUTTON_WIDTH = 40;
      const MORE_BUTTON_WIDTH = 82;
      const GAP = 6;
      const refs = bookmarkItemRefs.current.filter(Boolean) as HTMLButtonElement[];

      // Try fitting all chips without a More button
      const availableAll = bar.offsetWidth - ADD_BUTTON_WIDTH - GAP;
      let sum = 0;
      let allFit = true;
      for (const el of refs) {
        sum += el.offsetWidth + GAP;
        if (sum > availableAll) {
          allFit = false;
          break;
        }
      }

      if (allFit) {
        setVisibleBookmarkCount(refs.length);
        return;
      }

      // Need More button — recalculate how many fit with it reserved
      const availableWithMore = bar.offsetWidth - ADD_BUTTON_WIDTH - MORE_BUTTON_WIDTH - GAP * 2;
      sum = 0;
      let count = 0;
      for (const el of refs) {
        const w = el.offsetWidth + GAP;
        if (sum + w > availableWithMore) break;
        sum += w;
        count++;
      }
      setVisibleBookmarkCount(count);
    }

    computeVisibleCount();
    const obs = new ResizeObserver(computeVisibleCount);
    obs.observe(bar);
    return () => obs.disconnect();
  }, [bookmarks]);

  useEffect(() => {
    if (!bookmarkMoreOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (bookmarkMoreRef.current && !bookmarkMoreRef.current.contains(e.target as Node)) {
        setBookmarkMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [bookmarkMoreOpen]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  const selectedRecurringTemplate = useMemo(
    () =>
      selectedTask?.recurring_template_id
        ? recurringTemplates.find((template) => template.id === selectedTask.recurring_template_id) ?? null
        : null,
    [recurringTemplates, selectedTask]
  );

  const selectedTaskChecklist = useMemo(
    () =>
      selectedTask
        ? checklistItems.filter((item) => item.task_id === selectedTask.id).sort((left, right) => left.position - right.position)
        : [],
    [checklistItems, selectedTask]
  );

  const checklistCountsByTask = useMemo(() => {
    const counts = new Map<string, { completed: number; total: number }>();

    checklistItems.forEach((item) => {
      const existing = counts.get(item.task_id) ?? { completed: 0, total: 0 };
      existing.total += 1;
      if (item.completed_at) {
        existing.completed += 1;
      }
      counts.set(item.task_id, existing);
    });

    return counts;
  }, [checklistItems]);

  const archivedTasks = useMemo(
    () => tasks.filter((task) => isArchivedTask(task, now)),
    [now, tasks]
  );

  const activeTasks = useMemo(
    () => tasks.filter((task) => !isArchivedTask(task, now)),
    [now, tasks]
  );

  const activeAreas = useMemo(
    () => areas.filter((area) => !area.archived),
    [areas]
  );

  const areaLookup = useMemo(
    () => new Map(areas.map((area) => [area.id, area])),
    [areas]
  );

  const selectedChatSpace = useMemo(
    () => chatSpaces.find((space) => space.name === selectedChatSpaceName) ?? null,
    [chatSpaces, selectedChatSpaceName]
  );

  const unreadChatCount = useMemo(
    () => chatSpaces.filter((space) => space.unread).length,
    [chatSpaces]
  );

  const hasUnreadChatSpaces = unreadChatCount > 0;

  const reviewScopedTasks = useMemo(
    () => activeTasks.filter((task) => activeDomain === "all" || task.domain === activeDomain),
    [activeDomain, activeTasks]
  );

  const forgottenInboxTasks = useMemo(
    () =>
      reviewScopedTasks.filter(
        (task) => task.status === "inbox" && getTaskAgeInDays(task, now) > INBOX_STALE_DAYS
      ),
    [now, reviewScopedTasks]
  );

  const overdueTasks = useMemo(
    () =>
      reviewScopedTasks.filter(
        (task) => task.status !== "done" && Boolean(task.due_date) && task.due_date! < todayKey
      ),
    [reviewScopedTasks, todayKey]
  );

  const dueFollowUpTasks = useMemo(
    () =>
      reviewScopedTasks.filter((task) => {
        if (task.status !== "waiting") {
          return false;
        }

        if (task.follow_up_date) {
          return task.follow_up_date <= todayKey;
        }

        return getTaskAgeInDays(task, now) >= REVIEW_STALE_DAYS;
      }),
    [now, reviewScopedTasks, todayKey]
  );

  const staleOpenTasks = useMemo(
    () =>
      reviewScopedTasks.filter(
        (task) =>
          ["backlog", "in_progress"].includes(task.status) &&
          !task.planned_date &&
          !task.due_date &&
          getTaskAgeInDays(task, now) >= REVIEW_STALE_DAYS
      ),
    [now, reviewScopedTasks]
  );

  const upcomingSoonTasks = useMemo(
    () =>
      reviewScopedTasks.filter((task) => {
        const attentionDate = getTaskAttentionDate(task);

        return Boolean(attentionDate) && isDateWithinDays(attentionDate!, todayKey, UPCOMING_LOOKAHEAD_DAYS);
      }),
    [reviewScopedTasks, todayKey]
  );

  const recentWins = useMemo(
    () =>
      tasks.filter((task) => {
        if (task.status !== "done") {
          return false;
        }

        if (activeDomain !== "all" && task.domain !== activeDomain) {
          return false;
        }

        const completedAt = getTaskCompletedAt(task);
        return Boolean(completedAt) && now.getTime() - completedAt!.getTime() <= 7 * 24 * 60 * 60 * 1000;
      }),
    [activeDomain, now, tasks]
  );

  const areaReviewBuckets = useMemo(() => {
    return activeAreas.map((area) => ({
      area,
      tasks: reviewScopedTasks.filter((task) => task.area_id === area.id && task.status !== "done")
    }));
  }, [activeAreas, reviewScopedTasks]);

  const tasksWithoutArea = useMemo(
    () => reviewScopedTasks.filter((task) => !task.area_id && task.status !== "done"),
    [reviewScopedTasks]
  );

  const lastDailyReview = useMemo(
    () =>
      reviewSessions.find((session) => session.review_type === "daily" && session.completed_at) ?? null,
    [reviewSessions]
  );

  const lastWeeklyReview = useMemo(
    () =>
      reviewSessions.find((session) => session.review_type === "weekly" && session.completed_at) ?? null,
    [reviewSessions]
  );

  useEffect(() => {
    if (!isChatOverlayOpen || !selectedChatSpaceName || !chatMessages.length) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = chatMessagesRef.current;

      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages.length, isChatOverlayOpen, selectedChatSpaceName]);

  useEffect(() => {
    if (!selectedRecurringTemplate) {
      setRecurrenceDraft(EMPTY_RECURRENCE_DRAFT);
      return;
    }

    setRecurrenceDraft({
      enabled: true,
      intervalUnit: selectedRecurringTemplate.interval_unit,
      intervalCount: selectedRecurringTemplate.interval_count,
      anchorDate: selectedRecurringTemplate.anchor_date,
      dueOffsetDays: selectedRecurringTemplate.due_offset_days,
      isActive: selectedRecurringTemplate.is_active
    });
  }, [selectedRecurringTemplate]);

  useEffect(() => {
    const tasksToPromote = tasks.filter((task) => shouldAutoMoveTaskToToday(task, todayKey));

    if (!tasksToPromote.length) {
      return;
    }

    setTasks((current) =>
      sortTasks(
        current.map((task) =>
          shouldAutoMoveTaskToToday(task, todayKey) ? { ...task, status: "today" } : task
        )
      )
    );

    if (!supabase || !session?.user.id) {
      return;
    }

    const persistedTasks = tasksToPromote.filter((task) => !task.id.startsWith("sample-"));

    if (!persistedTasks.length) {
      return;
    }

    void Promise.all(
      persistedTasks.map((task) =>
        supabase.from("tasks").update({ status: "today" }).eq("id", task.id)
      )
    );
  }, [session?.user.id, supabase, tasks, todayKey]);

  const visibleTasks = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return activeTasks.filter((task) => {
      const matchesDomain = activeDomain === "all" || task.domain === activeDomain;
      const areaName = task.area_id ? areaLookup.get(task.area_id)?.name.toLowerCase() ?? "" : "";
      const matchesSearch =
        !normalized ||
        task.title.toLowerCase().includes(normalized) ||
        task.description?.toLowerCase().includes(normalized) ||
        areaName.includes(normalized);

      return matchesDomain && matchesSearch;
    });
  }, [activeDomain, activeTasks, areaLookup, deferredSearch]);

  const groupedTasks = useMemo(() => {
    return STATUS_OPTIONS.map((status) => ({
      status,
      tasks: visibleTasks.filter((task) => task.status === status)
    }));
  }, [visibleTasks]);

  const domainCounts = useMemo(() => {
    return DOMAIN_OPTIONS.map((domain) => ({
      domain,
      count: activeTasks.filter((task) => task.domain === domain).length
    }));
  }, [activeTasks]);

  const filteredArchivedTasks = useMemo(() => {
    return archivedTasks.filter(
      (task) => archivedDomainFilter === "all" || task.domain === archivedDomainFilter
    );
  }, [archivedDomainFilter, archivedTasks]);

  const visibleCalendarEvents = useMemo(() => {
    return sortCalendarEvents(
      calendarEvents.filter((event) => activeDomain === "all" || event.domain === activeDomain)
    );
  }, [activeDomain, calendarEvents]);

  const todayEvents = useMemo(
    () => visibleCalendarEvents.filter((event) => isSameDay(event.start, new Date())),
    [visibleCalendarEvents]
  );

  const nextFiveDayBuckets = useMemo(() => {
    return Array.from({ length: 5 }, (_, index) => {
      const date = addDays(startOfDay(new Date()), index + 1);

      return {
        date,
        events: visibleCalendarEvents.filter((event) => isSameDay(event.start, date))
      };
    });
  }, [visibleCalendarEvents]);

  const upcomingCalendarEvents = useMemo(
    () =>
      visibleCalendarEvents.filter(
        (event) => Boolean(event.start) && isDateWithinDays(extractDateOnly(event.start!), todayKey, UPCOMING_LOOKAHEAD_DAYS)
      ),
    [todayKey, visibleCalendarEvents]
  );

  const forgottenThingsCount =
    forgottenInboxTasks.length + overdueTasks.length + dueFollowUpTasks.length + staleOpenTasks.length;

  const dailyReviewIsFresh = useMemo(
    () =>
      Boolean(lastDailyReview?.completed_at) &&
      getDaysSinceTimestamp(lastDailyReview?.completed_at ?? null, now) < 1,
    [lastDailyReview?.completed_at, now]
  );

  const weeklyReviewIsFresh = useMemo(
    () =>
      Boolean(lastWeeklyReview?.completed_at) &&
      getDaysSinceTimestamp(lastWeeklyReview?.completed_at ?? null, now) < 7,
    [lastWeeklyReview?.completed_at, now]
  );

  const todayAllDayEvents = useMemo(
    () => todayEvents.filter((event) => event.isAllDay),
    [todayEvents]
  );

  const todayTimedEvents = useMemo(
    () => todayEvents.filter((event) => !event.isAllDay && event.start),
    [todayEvents]
  );

  const mobileTaskGroup = useMemo(
    () => groupedTasks.find((group) => group.status === mobileTaskStatus) ?? groupedTasks[0],
    [groupedTasks, mobileTaskStatus]
  );

  const timelineBounds = useMemo(() => {
    if (!todayTimedEvents.length) {
      return {
        startHour: DEFAULT_TIMELINE_START_HOUR,
        endHour: DEFAULT_TIMELINE_END_HOUR
      };
    }

    const eventRanges = todayTimedEvents.map((event) => getTimedEventRangeInMinutes(event));
    const earliestStart = Math.min(...eventRanges.map((range) => range.startMinutes));
    const latestEnd = Math.max(...eventRanges.map((range) => range.endMinutes));

    const startHour = Math.max(0, Math.min(Math.floor(earliestStart / 60), DEFAULT_TIMELINE_START_HOUR));
    const endHour = Math.min(24, Math.max(Math.ceil(latestEnd / 60), DEFAULT_TIMELINE_END_HOUR));

    return {
      startHour,
      endHour: endHour > startHour ? endHour : startHour + 1
    };
  }, [todayTimedEvents]);

  const timelineHours = useMemo(() => {
    return Array.from(
      { length: timelineBounds.endHour - timelineBounds.startHour },
      (_, index) => timelineBounds.startHour + index
    );
  }, [timelineBounds.endHour, timelineBounds.startHour]);

  const timelineEventLayouts = useMemo(() => {
    return getTimelineEventLayouts(
      todayTimedEvents,
      timelineBounds.startHour,
      timelineBounds.endHour
    );
  }, [timelineBounds.endHour, timelineBounds.startHour, todayTimedEvents]);

  const nowLineOffset = useMemo(() => {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const timelineStartMinutes = timelineBounds.startHour * 60;
    const timelineEndMinutes = timelineBounds.endHour * 60;

    if (currentMinutes < timelineStartMinutes || currentMinutes > timelineEndMinutes) {
      return null;
    }

    return ((currentMinutes - timelineStartMinutes) / (timelineEndMinutes - timelineStartMinutes)) * 100;
  }, [now, timelineBounds.endHour, timelineBounds.startHour]);

  async function sendEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice("Supabase is not configured yet.");
      return;
    }

    setIsSaving(true);

    const { error } = await supabase.auth.signInWithOtp({
      email
    });

    setNotice(
      error ? error.message : `A sign-in code was sent to ${email}. Enter it below to continue.`
    );
    if (!error) {
      setIsAwaitingEmailCode(true);
      setEmailCode("");
    }
    setIsSaving(false);
  }

  async function verifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice("Supabase is not configured yet.");
      return;
    }

    setIsSaving(true);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: emailCode,
      type: "email"
    });

    setNotice(error ? error.message : "Signed in.");
    if (!error) {
      setEmailCode("");
      setIsAwaitingEmailCode(false);
    }
    setIsSaving(false);
  }

  async function createRecurringTemplateForTask(
    userId: string | null,
    values: ReturnType<typeof getPreparedTaskValues>
  ) {
    if (!recurrenceDraft.enabled) {
      return null;
    }

    const dueOffsetDays =
      recurrenceDraft.dueOffsetDays || getDueOffsetDays(values.planned_date, values.due_date);
    const payload = {
      title: values.title,
      description: values.description,
      domain: values.domain,
      priority: values.priority,
      area_id: values.area_id,
      anchor_date: recurrenceDraft.anchorDate || values.planned_date || values.due_date || todayKey,
      interval_unit: recurrenceDraft.intervalUnit,
      interval_count: recurrenceDraft.intervalCount,
      due_offset_days: dueOffsetDays,
      is_active: recurrenceDraft.isActive
    };

    if (!supabase || !userId) {
      const nextTemplate: RecurringTaskTemplate = {
        id: crypto.randomUUID(),
        user_id: userId ?? undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...payload
      };
      setRecurringTemplates((current) => [...current, nextTemplate]);
      return nextTemplate;
    }

    const { data, error } = await supabase
      .from("recurring_task_templates")
      .insert({
        ...payload,
        user_id: userId
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const nextTemplate = data as RecurringTaskTemplate;
    setRecurringTemplates((current) => [...current, nextTemplate]);
    return nextTemplate;
  }

  async function syncRecurringTemplateDefaults(task: Task, patch: Partial<TaskDraft>) {
    if (!task.recurring_template_id) {
      return;
    }

    const templatePatch: Partial<RecurringTaskTemplate> = {};

    if (patch.title !== undefined) {
      templatePatch.title = (patch.title || task.title).trim();
    }

    if (patch.description !== undefined) {
      templatePatch.description = patch.description?.trim() || null;
    }

    if (patch.domain !== undefined) {
      templatePatch.domain = patch.domain;
    }

    if (patch.priority !== undefined) {
      templatePatch.priority = patch.priority;
    }

    if (patch.area_id !== undefined) {
      templatePatch.area_id = patch.area_id || null;
    }

    if (!Object.keys(templatePatch).length) {
      return;
    }

    if (!supabase || !session?.user.id || task.id.startsWith("sample-")) {
      setRecurringTemplates((current) =>
        current.map((template) =>
          template.id === task.recurring_template_id ? { ...template, ...templatePatch } : template
        )
      );
      return;
    }

    const { data, error } = await supabase
      .from("recurring_task_templates")
      .update(templatePatch)
      .eq("id", task.recurring_template_id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    setRecurringTemplates((current) =>
      current.map((template) =>
        template.id === task.recurring_template_id ? (data as RecurringTaskTemplate) : template
      )
    );
  }

  async function completeTaskById(taskId: string, action: "complete" | "skip" = "complete") {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    if (!supabase || !session?.user.id || task.id.startsWith("sample-")) {
      const updatedTask: Task = {
        ...task,
        status: "done",
        completed_at: new Date().toISOString(),
        completion_kind: action === "skip" ? "skipped" : "completed"
      };

      const template = task.recurring_template_id
        ? recurringTemplates.find((item) => item.id === task.recurring_template_id) ?? null
        : null;
      const hasOpenSibling = task.recurring_template_id
        ? tasks.some(
            (item) =>
              item.id !== task.id &&
              item.recurring_template_id === task.recurring_template_id &&
              item.status !== "done"
          )
        : false;
      const nextTask =
        template && template.is_active && !hasOpenSibling
          ? buildNextRecurringTask(task, template)
          : null;

      setTasks((current) =>
        sortTasks(
          current
            .map((item) => (item.id === task.id ? updatedTask : item))
            .concat(nextTask ? [nextTask] : [])
        )
      );
      setNotice(action === "skip" ? "Task skipped." : "Task completed.");
      return;
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before completing tasks.");
      return;
    }

    const response = await fetch(`/api/tasks/${taskId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action })
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; task?: Task | null; nextTask?: Task | null }
      | null;

    if (!response.ok || !payload?.task) {
      setNotice(payload?.error ?? "Unable to complete the task.");
      return;
    }

    setTasks((current) => {
      const withoutCurrent = current.filter((item) => item.id !== payload.task!.id);
      const withoutNext = payload.nextTask
        ? withoutCurrent.filter((item) => item.id !== payload.nextTask!.id)
        : withoutCurrent;

      return sortTasks([payload.task!, ...(payload.nextTask ? [payload.nextTask] : []), ...withoutNext]);
    });

    if (payload.nextTask) {
      setSelectedTaskId(payload.nextTask.id);
    }

    setNotice(action === "skip" ? "Task skipped and rolled forward." : "Task completed.");
  }

  async function reopenTask(taskId: string, status: TaskStatus = "backlog") {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    const nextStatus = getNormalizedTaskStatus(status, task.planned_date, task.due_date, todayKey);
    const patch = {
      status: nextStatus,
      completed_at: null,
      completion_kind: null
    };

    setTasks((current) =>
      sortTasks(current.map((item) => (item.id === taskId ? { ...item, ...patch } : item)))
    );

    if (!supabase || !session?.user.id || task.id.startsWith("sample-")) {
      setNotice("Task reopened in demo mode.");
      return;
    }

    const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    setNotice("Task reopened.");
  }

  async function createInboxTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = quickCapture.trim();

    if (!title) {
      return;
    }

    const nextDraft: TaskDraft = {
      ...EMPTY_TASK,
      title,
      domain: activeDomain === "all" ? "personal" : activeDomain,
      status: "inbox"
    };

    const nextTask = getPreparedTaskValues(nextDraft, todayKey);

    if (!supabase || !session?.user.id) {
      const localTask: Task = {
        id: crypto.randomUUID(),
        ...nextTask,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      setTasks((current) => sortTasks([localTask, ...current]));
      setSelectedTaskId(localTask.id);
      setQuickCapture("");
      setNotice("Added to Inbox.");
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...nextTask,
        user_id: session.user.id
      })
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      return;
    }

    setTasks((current) => sortTasks([data as Task, ...current]));
    setSelectedTaskId(data.id);
    setQuickCapture("");
    setNotice("Added to Inbox.");
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim()) {
      setNotice("Task title is required.");
      return;
    }

    const preparedTask = getPreparedTaskValues(draft, todayKey);

    try {
      const recurringTemplate = await createRecurringTemplateForTask(session?.user.id ?? null, preparedTask);

      if (!supabase || !session?.user.id) {
        const nextStatus = preparedTask.status;
        const nextTask: Task = {
          ...preparedTask,
          id: crypto.randomUUID(),
          recurring_template_id: recurringTemplate?.id ?? null,
          status: nextStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
          completion_kind: null
        };
        const nextTasks = sortTasks([nextTask, ...tasks]);
        setTasks(nextTasks);
        setSelectedTaskId(nextTask.id);
        setIsAddTaskOverlayOpen(false);
        setIsDetailOpen(false);
        setDraft(EMPTY_TASK);
        setRecurrenceDraft(EMPTY_RECURRENCE_DRAFT);
        setNotice("Task added in demo mode.");
        return;
      }

      setIsSaving(true);

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          ...preparedTask,
          recurring_template_id: recurringTemplate?.id ?? null,
          user_id: session.user.id
        })
        .select()
        .single();

      if (error) {
        setNotice(error.message);
        setIsSaving(false);
        return;
      }

      const nextTasks = sortTasks([data as Task, ...tasks]);
      setTasks(nextTasks);
      setSelectedTaskId(data.id);
      setIsAddTaskOverlayOpen(false);
      setIsDetailOpen(false);
      setDraft(EMPTY_TASK);
      setRecurrenceDraft(EMPTY_RECURRENCE_DRAFT);
      setNotice("Task created.");
      setIsSaving(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create the task.");
      setIsSaving(false);
    }
  }

  async function updateSelectedTask(patch: Partial<TaskDraft>) {
    if (!selectedTask) {
      return;
    }

    if (patch.status === "done") {
      await completeTaskById(selectedTask.id, "complete");
      return;
    }

    if (selectedTask.status === "done" && patch.status) {
      await reopenTask(selectedTask.id, patch.status);
      return;
    }

    const normalizedPatch = getTaskLifecyclePatch(
      selectedTask,
      getNormalizedTaskPatch(selectedTask, patch, todayKey)
    );

    const optimisticTask: Task = {
      ...selectedTask,
      ...normalizedPatch
    };

    setTasks((current) =>
      sortTasks(current.map((task) => (task.id === selectedTask.id ? optimisticTask : task)))
    );

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      setNotice("Updated locally in demo mode.");
      await syncRecurringTemplateDefaults(selectedTask, patch);
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        ...normalizedPatch,
        description: normalizedPatch.description?.trim() || null
      })
      .eq("id", selectedTask.id);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    try {
      await syncRecurringTemplateDefaults(selectedTask, patch);
    } catch (caughtError) {
      setNotice(caughtError instanceof Error ? caughtError.message : "Task updated, but recurrence settings could not be synced.");
      return;
    }

    setNotice("Task updated.");
  }

  async function moveTaskToStatus(taskId: string, status: TaskStatus) {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    if (status === "done") {
      await completeTaskById(taskId, "complete");
      return;
    }

    if (task.status === "done") {
      await reopenTask(taskId, status);
      return;
    }

    const nextStatus = getNormalizedTaskStatus(status, task.planned_date, task.due_date, todayKey);

    if (task.status === nextStatus) {
      return;
    }

    const lifecyclePatch = getTaskLifecyclePatch(task, { status: nextStatus });
    const optimisticTask = {
      ...task,
      ...lifecyclePatch
    };

    setTasks((current) =>
      sortTasks(current.map((item) => (item.id === taskId ? optimisticTask : item)))
    );

    if (selectedTaskId === taskId) {
      setSelectedTaskId(taskId);
    }

    if (!supabase || !session?.user.id || task.id.startsWith("sample-")) {
      setNotice("Task moved locally in demo mode.");
      return;
    }

    const { error } = await supabase.from("tasks").update(lifecyclePatch).eq("id", taskId);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    setNotice(`Task moved to ${statusLabels[nextStatus]}.`);
  }

  async function addArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = areaDraftName.trim();

    if (!name) {
      return;
    }

    const position = areas.length;

    if (!supabase || !session?.user.id) {
      const nextArea: Area = {
        id: crypto.randomUUID(),
        name,
        position,
        archived: false
      };
      setAreas((current) => sortAreas([...current, nextArea]));
      setAreaDraftName("");
      setNotice("Area added in demo mode.");
      return;
    }

    setIsAreaBusy(true);

    const { data, error } = await supabase
      .from("areas")
      .insert({
        user_id: session.user.id,
        name,
        position
      })
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      setIsAreaBusy(false);
      return;
    }

    setAreas((current) => sortAreas([...current, data as Area]));
    setAreaDraftName("");
    setNotice("Area added.");
    setIsAreaBusy(false);
  }

  async function addStarterAreas() {
    const missingAreas = STARTER_AREAS.filter(
      (label) => !areas.some((area) => area.name.toLowerCase() === label.toLowerCase())
    );

    if (!missingAreas.length) {
      setNotice("Starter areas are already in place.");
      return;
    }

    if (!supabase || !session?.user.id) {
      const nextAreas = missingAreas.map((name, index) => ({
        id: crypto.randomUUID(),
        name,
        archived: false,
        position: areas.length + index
      })) as Area[];
      setAreas((current) => sortAreas([...current, ...nextAreas]));
      setNotice("Starter areas added in demo mode.");
      return;
    }

    setIsAreaBusy(true);

    const { data, error } = await supabase
      .from("areas")
      .insert(
        missingAreas.map((name, index) => ({
          user_id: session.user.id,
          name,
          position: areas.length + index
        }))
      )
      .select("*");

    if (error) {
      setNotice(error.message);
      setIsAreaBusy(false);
      return;
    }

    setAreas((current) => sortAreas([...current, ...((data as Area[] | null) ?? [])]));
    setNotice("Starter areas added.");
    setIsAreaBusy(false);
  }

  async function toggleAreaArchived(area: Area) {
    const patch = { archived: !area.archived };

    setAreas((current) =>
      sortAreas(current.map((item) => (item.id === area.id ? { ...item, ...patch } : item)))
    );

    if (!supabase || !session?.user.id) {
      setNotice(area.archived ? "Area restored in demo mode." : "Area archived in demo mode.");
      return;
    }

    const { error } = await supabase.from("areas").update(patch).eq("id", area.id);

    if (error) {
      setNotice(error.message);
      await loadAreas(session.user.id);
      return;
    }

    setNotice(area.archived ? "Area restored." : "Area archived.");
  }

  async function addChecklistItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTask) {
      return;
    }

    const label = checklistDraftLabel.trim();

    if (!label) {
      return;
    }

    const position = selectedTaskChecklist.length;

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      const nextItem: TaskChecklistItem = {
        id: crypto.randomUUID(),
        task_id: selectedTask.id,
        user_id: session?.user.id,
        label,
        position,
        completed_at: null
      };
      setChecklistItems((current) => [...current, nextItem]);
      setChecklistDraftLabel("");
      setNotice("Checklist item added in demo mode.");
      return;
    }

    setIsChecklistBusy(true);

    const { data, error } = await supabase
      .from("task_checklist_items")
      .insert({
        user_id: session.user.id,
        task_id: selectedTask.id,
        label,
        position
      })
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      setIsChecklistBusy(false);
      return;
    }

    setChecklistItems((current) => [...current, data as TaskChecklistItem]);
    setChecklistDraftLabel("");
    setNotice("Checklist item added.");
    setIsChecklistBusy(false);
  }

  async function toggleChecklistItem(item: TaskChecklistItem) {
    const patch = {
      completed_at: item.completed_at ? null : new Date().toISOString()
    };

    setChecklistItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, ...patch } : entry))
    );

    if (!supabase || !session?.user.id || item.task_id.startsWith("sample-")) {
      setNotice("Checklist updated in demo mode.");
      return;
    }

    const { error } = await supabase.from("task_checklist_items").update(patch).eq("id", item.id);

    if (error) {
      setNotice(error.message);
      await loadChecklistItems(session.user.id);
      return;
    }

    setNotice("Checklist updated.");
  }

  async function removeChecklistItem(itemId: string) {
    setChecklistItems((current) => current.filter((item) => item.id !== itemId));

    if (!supabase || !session?.user.id) {
      setNotice("Checklist item removed in demo mode.");
      return;
    }

    const { error } = await supabase.from("task_checklist_items").delete().eq("id", itemId);

    if (error) {
      setNotice(error.message);
      await loadChecklistItems(session.user.id);
      return;
    }

    setNotice("Checklist item removed.");
  }

  async function saveRecurringSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTask) {
      return;
    }

    if (!recurrenceDraft.enabled) {
      if (!selectedRecurringTemplate) {
        setNotice("Recurrence is already off.");
        return;
      }

      setIsRecurringBusy(true);

      if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
        setRecurringTemplates((current) =>
          current.map((template) =>
            template.id === selectedRecurringTemplate.id ? { ...template, is_active: false } : template
          )
        );
        setNotice("Recurrence paused in demo mode.");
        setIsRecurringBusy(false);
        return;
      }

      const { data, error } = await supabase
        .from("recurring_task_templates")
        .update({ is_active: false })
        .eq("id", selectedRecurringTemplate.id)
        .select("*")
        .single();

      if (error) {
        setNotice(error.message);
        setIsRecurringBusy(false);
        return;
      }

      setRecurringTemplates((current) =>
        current.map((template) =>
          template.id === selectedRecurringTemplate.id ? (data as RecurringTaskTemplate) : template
        )
      );
      setNotice("Recurrence paused.");
      setIsRecurringBusy(false);
      return;
    }

    const payload = {
      title: selectedTask.title,
      description: selectedTask.description ?? null,
      domain: selectedTask.domain,
      priority: selectedTask.priority,
      area_id: selectedTask.area_id ?? null,
      anchor_date: recurrenceDraft.anchorDate || selectedTask.planned_date || selectedTask.due_date || todayKey,
      interval_unit: recurrenceDraft.intervalUnit,
      interval_count: recurrenceDraft.intervalCount,
      due_offset_days:
        recurrenceDraft.dueOffsetDays || getDueOffsetDays(selectedTask.planned_date, selectedTask.due_date),
      is_active: recurrenceDraft.isActive
    };

    setIsRecurringBusy(true);

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      if (selectedRecurringTemplate) {
        setRecurringTemplates((current) =>
          current.map((template) =>
            template.id === selectedRecurringTemplate.id ? { ...template, ...payload } : template
          )
        );
      } else {
        const nextTemplate: RecurringTaskTemplate = {
          id: crypto.randomUUID(),
          user_id: session?.user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...payload
        };
        setRecurringTemplates((current) => [...current, nextTemplate]);
        setTasks((current) =>
          current.map((task) =>
            task.id === selectedTask.id ? { ...task, recurring_template_id: nextTemplate.id } : task
          )
        );
      }
      setNotice("Recurrence saved in demo mode.");
      setIsRecurringBusy(false);
      return;
    }

    if (selectedRecurringTemplate) {
      const { data, error } = await supabase
        .from("recurring_task_templates")
        .update(payload)
        .eq("id", selectedRecurringTemplate.id)
        .select("*")
        .single();

      if (error) {
        setNotice(error.message);
        setIsRecurringBusy(false);
        return;
      }

      setRecurringTemplates((current) =>
        current.map((template) =>
          template.id === selectedRecurringTemplate.id ? (data as RecurringTaskTemplate) : template
        )
      );
      setNotice("Recurrence updated.");
      setIsRecurringBusy(false);
      return;
    }

    const { data: templateData, error: templateError } = await supabase
      .from("recurring_task_templates")
      .insert({
        user_id: session.user.id,
        ...payload
      })
      .select("*")
      .single();

    if (templateError) {
      setNotice(templateError.message);
      setIsRecurringBusy(false);
      return;
    }

    const nextTemplate = templateData as RecurringTaskTemplate;
    const { data: taskData, error: taskError } = await supabase
      .from("tasks")
      .update({ recurring_template_id: nextTemplate.id })
      .eq("id", selectedTask.id)
      .select("*")
      .single();

    if (taskError) {
      setNotice(taskError.message);
      setIsRecurringBusy(false);
      return;
    }

    setRecurringTemplates((current) => [...current, nextTemplate]);
    setTasks((current) =>
      sortTasks(current.map((task) => (task.id === selectedTask.id ? (taskData as Task) : task)))
    );
    setSelectedTaskId(selectedTask.id);
    setNotice("Recurrence enabled.");
    setIsRecurringBusy(false);
  }

  async function completeReview(reviewType: typeof REVIEW_TYPES[number]) {
    const note = (reviewType === "daily" ? dailyReviewNote : weeklyReviewNote).trim() || null;
    const payload = {
      review_type: reviewType,
      review_date: todayKey,
      note,
      completed_at: new Date().toISOString()
    };

    if (!supabase || !session?.user.id) {
      const nextSession: ReviewSession = {
        id: crypto.randomUUID(),
        user_id: session?.user.id,
        ...payload
      };
      setReviewSessions((current) => [nextSession, ...current]);
      setNotice(reviewType === "daily" ? "Daily briefing saved in demo mode." : "Weekly review saved in demo mode.");
      return;
    }

    setIsReviewSaving(true);

    const { data, error } = await supabase
      .from("review_sessions")
      .upsert(
        {
          user_id: session.user.id,
          ...payload
        },
        {
          onConflict: "user_id,review_type,review_date"
        }
      )
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      setIsReviewSaving(false);
      return;
    }

    setReviewSessions((current) => {
      const next = current.filter(
        (sessionEntry) =>
          !(
            sessionEntry.review_type === reviewType &&
            sessionEntry.review_date === todayKey
          )
      );

      return [data as ReviewSession, ...next];
    });
    setNotice(reviewType === "daily" ? "Daily briefing saved." : "Weekly review saved.");
    setIsReviewSaving(false);
  }

  function handleTaskDragStart(event: DragEvent<HTMLButtonElement>, taskId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDraggedTaskId(taskId);
  }

  function handleTaskDragEnd() {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  }

  function handleColumnDragOver(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }

  function handleColumnDragLeave(status: TaskStatus) {
    if (dragOverStatus === status) {
      setDragOverStatus(null);
    }
  }

  async function handleColumnDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    const taskId = draggedTaskId ?? event.dataTransfer.getData("text/plain");
    setDragOverStatus(null);
    setDraggedTaskId(null);

    if (!taskId) {
      return;
    }

    await moveTaskToStatus(taskId, status);
  }

  async function deleteSelectedTask() {
    if (!selectedTask) {
      return;
    }

    const fallbackId = tasks.find((task) => task.id !== selectedTask.id)?.id ?? null;
    setTasks((current) => current.filter((task) => task.id !== selectedTask.id));
    setChecklistItems((current) => current.filter((item) => item.task_id !== selectedTask.id));
    setSelectedTaskId(fallbackId);
    setIsDetailOpen(false);

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      setNotice("Removed locally in demo mode.");
      return;
    }

    const { error } = await supabase.from("tasks").delete().eq("id", selectedTask.id);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    setNotice("Task deleted.");
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
  }

  async function connectGoogleCalendar() {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before connecting Google Calendar.");
      return;
    }

    setIsCalendarBusy(true);

    const response = await fetch("/api/google-calendar/connect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; url?: string }
      | null;

    if (!response.ok || !payload?.url) {
      setNotice(payload?.error ?? "Unable to start Google Calendar connection.");
      setIsCalendarBusy(false);
      return;
    }

    window.location.href = payload.url;
  }

  async function disconnectGoogleCalendar() {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before disconnecting Google Calendar.");
      return;
    }

    setIsCalendarBusy(true);

    const response = await fetch("/api/google-calendar/disconnect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Unable to disconnect Google Calendar.");
      setIsCalendarBusy(false);
      return;
    }

    setTasks((current) =>
      current.map((task) => ({
        ...task,
        google_calendar_event_id: null,
        google_calendar_event_url: null,
        google_calendar_last_synced_at: null
      }))
    );
    setCalendarStatus({
      configured: true,
      connected: false,
      googleEmail: null,
      calendarId: null,
      defaultDomain: null
    });
    await loadCalendarEvents();
    setNotice("Google Calendar disconnected.");
    setIsCalendarBusy(false);
  }

  async function connectGoogleChat() {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before connecting Google Chat.");
      return;
    }

    setIsChatBusy(true);

    const response = await fetch("/api/google-chat/connect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; url?: string }
      | null;

    if (!response.ok || !payload?.url) {
      setNotice(payload?.error ?? "Unable to start Google Chat connection.");
      setIsChatBusy(false);
      return;
    }

    window.location.href = payload.url;
  }

  async function disconnectGoogleChat() {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before disconnecting Google Chat.");
      return;
    }

    setIsChatBusy(true);

    const response = await fetch("/api/google-chat/disconnect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Unable to disconnect Google Chat.");
      setIsChatBusy(false);
      return;
    }

    setChatStatus({
      configured: true,
      connected: false,
      googleEmail: null
    });
    setChatSpaces([]);
    setSelectedChatSpaceName(null);
    setChatMessages([]);
    setChatComposer("");
    setIsChatOverlayOpen(false);
    setChatAliasEditor(null);
    setNotice("Google Chat disconnected.");
    setIsChatBusy(false);
  }

  const markChatSpaceAsRead = useCallback(
    async (space: GoogleChatSpace) => {
      if (!space.unread || !space.lastActiveTime) {
        return;
      }

      const accessToken = await getAccessToken();

      if (!accessToken) {
        return;
      }

      const response = await fetch("/api/google-chat/read-state", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          spaceName: space.name,
          lastReadTime: space.lastActiveTime
        })
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { lastReadTime?: string }
        | null;

      setChatSpaces((current) =>
        sortChatSpaces(
          current.map((item) =>
            item.name === space.name
              ? {
                  ...item,
                  unread: false,
                  lastReadTime: payload?.lastReadTime ?? space.lastActiveTime
                }
              : item
          )
        )
      );
    },
    [getAccessToken]
  );

  async function openChatOverlay() {
    setIsChatOverlayOpen(true);

    if (!chatStatus.connected) {
      return;
    }

    await loadChatSpaces({ showLoading: chatSpaces.length === 0 });
  }

  async function selectChatSpace(space: GoogleChatSpace) {
    setSelectedChatSpaceName(space.name);
    await loadChatMessages(space.name);
    void markChatSpaceAsRead(space);
  }

  function openChatSpaceAliasEditor(space: GoogleChatSpace) {
    setChatAliasEditor({
      targetType: "space",
      targetName: space.name,
      title: "Label chat",
      helper: "Save a custom label for this conversation when Google can't provide a useful name.",
      draftLabel: space.displayName
    });
  }

  function openChatSenderAliasEditor(message: GoogleChatMessage) {
    if (!message.senderName || message.isSelf) {
      return;
    }

    setChatAliasEditor({
      targetType: "sender",
      targetName: message.senderName,
      title: "Label participant",
      helper: "Save a custom name for this sender so future messages are easier to scan.",
      draftLabel: getDisplayedChatMessageSenderLabel(message, selectedChatSpace)
    });
  }

  async function saveChatAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!chatAliasEditor) {
      return;
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before editing chat labels.");
      return;
    }

    setIsChatAliasBusy(true);

    const response = await fetch("/api/google-chat/aliases", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        targetType: chatAliasEditor.targetType,
        targetName: chatAliasEditor.targetName,
        label: chatAliasEditor.draftLabel
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; label?: string | null }
      | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Unable to save the chat label.");
      setIsChatAliasBusy(false);
      return;
    }

    await loadChatSpaces({ showLoading: false });

    if (selectedChatSpaceName) {
      await loadChatMessages(selectedChatSpaceName, { showLoading: false });
    }

    setChatAliasEditor(null);
    setNotice(
      chatAliasEditor.targetType === "space" ? "Chat label saved." : "Participant label saved."
    );
    setIsChatAliasBusy(false);
  }

  async function clearChatAlias() {
    if (!chatAliasEditor) {
      return;
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before editing chat labels.");
      return;
    }

    setIsChatAliasBusy(true);

    const response = await fetch("/api/google-chat/aliases", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        targetType: chatAliasEditor.targetType,
        targetName: chatAliasEditor.targetName,
        label: ""
      })
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Unable to reset the chat label.");
      setIsChatAliasBusy(false);
      return;
    }

    await loadChatSpaces({ showLoading: false });

    if (selectedChatSpaceName) {
      await loadChatMessages(selectedChatSpaceName, { showLoading: false });
    }

    setChatAliasEditor(null);
    setNotice("Custom chat label cleared.");
    setIsChatAliasBusy(false);
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChatSpace) {
      setNotice("Select a Google Chat space first.");
      return;
    }

    const text = chatComposer.trim();

    if (!text) {
      return;
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before sending a Google Chat message.");
      return;
    }

    setIsChatBusy(true);

    const response = await fetch("/api/google-chat/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        spaceName: selectedChatSpace.name,
        text
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          message?: GoogleChatMessage;
        }
      | null;

    if (!response.ok || !payload?.message) {
      setNotice(payload?.error ?? "Unable to send the Google Chat message.");
      setIsChatBusy(false);
      return;
    }

    setChatMessages((current) => [...current, payload.message!]);
    setChatComposer("");
    setChatSpaces((current) =>
      sortChatSpaces(
        current.map((space) =>
          space.name === selectedChatSpace.name
            ? {
                ...space,
                unread: false,
                lastReadTime: payload.message?.createTime ?? space.lastReadTime,
                lastActiveTime: payload.message?.createTime ?? space.lastActiveTime,
                previewText: payload.message?.text ?? space.previewText
              }
            : space
        )
      )
    );
    setNotice("Google Chat message sent.");
    setIsChatBusy(false);
  }

  useEffect(() => {
    if (!isChatOverlayOpen || !selectedChatSpace?.unread) {
      return;
    }

    void markChatSpaceAsRead(selectedChatSpace);
  }, [isChatOverlayOpen, markChatSpaceAsRead, selectedChatSpace]);

  async function syncSelectedTaskToCalendar() {
    if (!selectedTask) {
      setNotice("Select a task to sync.");
      return;
    }

    if (!selectedTask.due_date) {
      setNotice("Add a due date before syncing a task to Google Calendar.");
      return;
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before syncing tasks to Google Calendar.");
      return;
    }

    setIsCalendarBusy(true);

    const response = await fetch("/api/google-calendar/sync-task", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        taskId: selectedTask.id
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          task?: Task;
        }
      | null;

    if (!response.ok || !payload?.task) {
      setNotice(payload?.error ?? "Unable to sync the selected task to Google Calendar.");
      setIsCalendarBusy(false);
      return;
    }

    setTasks((current) =>
      sortTasks(current.map((task) => (task.id === payload.task!.id ? payload.task! : task)))
    );
    setSelectedTaskId(payload.task.id);
    await loadCalendarEvents();
    setNotice("Task synced to Google Calendar.");
    setIsCalendarBusy(false);
  }

  async function updateGoogleDefaultDomain(domain: Domain) {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before updating the Google Calendar default space.");
      return;
    }

    setIsCalendarBusy(true);

    const response = await fetch("/api/google-calendar/status", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        defaultDomain: domain
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | GoogleCalendarStatus
      | null;

    if (!response.ok || !payload) {
      setNotice(
        (payload as { error?: string } | null)?.error ??
          "Unable to update the Google Calendar default space."
      );
      setIsCalendarBusy(false);
      return;
    }

    setCalendarStatus(payload as GoogleCalendarStatus);
    await loadCalendarEvents();
    setNotice("Google Calendar default space updated.");
    setIsCalendarBusy(false);
  }

  async function createCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before creating calendar events.");
      return;
    }

    setIsCalendarBusy(true);

    const response = await fetch("/api/google-calendar/create-event", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...eventDraft,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Unable to create the Google Calendar event.");
      setIsCalendarBusy(false);
      return;
    }

    await loadCalendarEvents();
    setEventDraft(EMPTY_EVENT_DRAFT);
    setIsEventOverlayOpen(false);
    setNotice("Google Calendar event created.");
    setIsCalendarBusy(false);
  }

  function openCalendarEventDetail(event: CalendarEvent) {
    setSelectedCalendarEvent(event);
  }

  async function convertCalendarEventToTask() {
    if (!selectedCalendarEvent) {
      return;
    }

    const dueDate = getTaskDueDateFromCalendarEvent(selectedCalendarEvent);

    if (!dueDate) {
      setNotice("This event does not have an end date that can be converted into a task due date.");
      return;
    }

    const nextDomain = selectedCalendarEvent.domain ?? "personal";
    const nextStatus: TaskStatus = dueDate === todayKey ? "today" : "backlog";
    const taskPayload = {
      title: selectedCalendarEvent.summary.trim() || "Untitled event task",
      description: selectedCalendarEvent.description?.trim() || null,
      domain: nextDomain,
      status: nextStatus,
      priority: "medium" as const,
      planned_date: dueDate,
      follow_up_date: null,
      area_id: null,
      due_date: dueDate
    };

    setIsTaskConversionBusy(true);

    if (!supabase || !session?.user.id) {
      const nextTask: Task = {
        id: crypto.randomUUID(),
        ...taskPayload
      };
      const nextTasks = sortTasks([nextTask, ...tasks]);
      setTasks(nextTasks);
      setSelectedTaskId(nextTask.id);
      setSelectedCalendarEvent(null);
      setNotice("Event converted to a task in demo mode.");
      setIsTaskConversionBusy(false);
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...taskPayload,
        user_id: session.user.id
      })
      .select()
      .single();

    if (error) {
      setNotice(error.message);
      setIsTaskConversionBusy(false);
      return;
    }

    setTasks((current) => sortTasks([data as Task, ...current]));
    setSelectedTaskId(data.id);
    setSelectedCalendarEvent(null);
    setNotice("Event converted to a task.");
    setIsTaskConversionBusy(false);
  }

  async function addCalendarFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before adding a calendar feed.");
      return;
    }

    setIsFeedBusy(true);

    const response = await fetch("/api/calendar-feeds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: feedName,
        url: feedUrl,
        domain: feedDomain
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; feed?: CalendarFeed }
      | null;

    if (!response.ok || !payload?.feed) {
      setNotice(payload?.error ?? "Unable to add the calendar feed.");
      setIsFeedBusy(false);
      return;
    }

    setCalendarFeeds((current) => [...current, payload.feed!]);
    setFeedName("");
    setFeedUrl("");
    setFeedDomain(activeDomain === "all" ? "personal" : activeDomain);
    await loadCalendarEvents();
    setNotice("Calendar feed added.");
    setIsFeedBusy(false);
  }

  async function updateSelectedFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFeed) {
      return;
    }

    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before updating a calendar feed.");
      return;
    }

    setIsFeedBusy(true);

    const response = await fetch(`/api/calendar-feeds/${selectedFeed.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: feedEditName,
        url: feedEditUrl,
        domain: feedEditDomain
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; feed?: CalendarFeed }
      | null;

    if (!response.ok || !payload?.feed) {
      setNotice(payload?.error ?? "Unable to update the calendar feed.");
      setIsFeedBusy(false);
      return;
    }

    setCalendarFeeds((current) =>
      current.map((feed) => (feed.id === payload.feed!.id ? payload.feed! : feed))
    );
    setSelectedFeed(payload.feed);
    await loadCalendarEvents();
    setNotice("Calendar feed updated.");
    setIsFeedBusy(false);
  }

  async function removeCalendarFeed(feedId: string) {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      setNotice("Sign in before removing a calendar feed.");
      return;
    }

    setIsFeedBusy(true);

    const response = await fetch(`/api/calendar-feeds/${feedId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Unable to remove the calendar feed.");
      setIsFeedBusy(false);
      return;
    }

    setCalendarFeeds((current) => current.filter((feed) => feed.id !== feedId));
    setSelectedFeed(null);
    setIsFeedDetailOverlayOpen(false);
    await loadCalendarEvents();
    setNotice("Calendar feed removed.");
    setIsFeedBusy(false);
  }

  function openFeedDetail(feed: CalendarFeed) {
    setSelectedFeed(feed);
    setFeedEditName(feed.name ?? "");
    setFeedEditUrl(feed.url);
    setFeedEditDomain(feed.domain);
    setIsFeedDetailOverlayOpen(true);
  }

  const canSyncSelectedTask =
    Boolean(session?.user.id) &&
    calendarStatus.connected &&
    Boolean(selectedTask?.due_date) &&
    !selectedTask?.id.startsWith("sample-");

  const hasCalendarSources = calendarStatus.connected || calendarFeeds.length > 0;

  function openArchiveOverlay() {
    setArchivedDomainFilter(activeDomain === "all" ? "all" : activeDomain);
    setIsArchiveOverlayOpen(true);
  }

  function openAddTaskOverlay() {
    setDraft({
      ...EMPTY_TASK,
      domain: activeDomain === "all" ? "personal" : activeDomain,
      status: "backlog"
    });
    setRecurrenceDraft({
      ...EMPTY_RECURRENCE_DRAFT,
      anchorDate: todayKey
    });
    setIsAddTaskOverlayOpen(true);
  }

  function changeActiveDomain(domain: Domain | "all") {
    if (domain === activeDomain) {
      return;
    }

    const documentWithTransition = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };

    if (documentWithTransition.startViewTransition) {
      documentWithTransition.startViewTransition(() => {
        flushSync(() => {
          setActiveDomain(domain);
        });
      });
      return;
    }

    setActiveDomain(domain);
  }

  function openArchivedTask(taskId: string) {
    setSelectedTaskId(taskId);
    setIsArchiveOverlayOpen(false);
    setIsDetailOpen(true);
  }

  function submitWebSearch(query: string) {
    const trimmed = query.trim();

    if (!trimmed) {
      return;
    }

    const url = `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setWebSearch("");
    setWebSearchSuggestions([]);
    setSelectedWebSuggestionIndex(-1);
    setIsWebSearchFocused(false);
    setIsWebSearchLoading(false);
  }

  function handleWebSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedSuggestion =
      selectedWebSuggestionIndex >= 0
        ? webSearchSuggestions[selectedWebSuggestionIndex]
        : null;

    submitWebSearch(selectedSuggestion ?? webSearch);
  }

  function handleWebSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!webSearchSuggestions.length) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitWebSearch(webSearch);
      }

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedWebSuggestionIndex((current) =>
        current >= webSearchSuggestions.length - 1 ? 0 : current + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedWebSuggestionIndex((current) =>
        current <= 0 ? webSearchSuggestions.length - 1 : current - 1
      );
      return;
    }

    if (event.key === "Escape") {
      setWebSearchSuggestions([]);
      setSelectedWebSuggestionIndex(-1);
      setIsWebSearchFocused(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedSuggestion =
        selectedWebSuggestionIndex >= 0
          ? webSearchSuggestions[selectedWebSuggestionIndex]
          : webSearch;
      submitWebSearch(selectedSuggestion);
    }
  }

  async function handleAddBookmark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = bookmarkLabel.trim();
    const rawUrl = bookmarkUrl.trim();
    if (!label || !rawUrl) return;

    const normalizedUrl =
      rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`;
    const position = bookmarks.length;

    if (!supabase || !session) {
      const newBookmark: Bookmark = {
        id: crypto.randomUUID(),
        label,
        url: normalizedUrl,
        position
      };
      const next = [...bookmarks, newBookmark];
      setBookmarks(next);
      try {
        localStorage.setItem("focus-desk-bookmarks", JSON.stringify(next));
      } catch {}
    } else {
      const { data } = await supabase
        .from("web_bookmarks")
        .insert({ user_id: session.user.id, label, url: normalizedUrl, position })
        .select()
        .single();
      if (data) setBookmarks((current) => [...current, data as Bookmark]);
    }

    setBookmarkLabel("");
    setBookmarkUrl("");
    setIsAddBookmarkOverlayOpen(false);
  }

  async function deleteBookmark(id: string) {
    setBookmarks((current) => {
      const next = current.filter((b) => b.id !== id);
      if (!supabase) {
        try {
          localStorage.setItem("focus-desk-bookmarks", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
    if (supabase) {
      await supabase.from("web_bookmarks").delete().eq("id", id);
    }
  }

  function renderSpaceFilters() {
    return (
      <>
        <button
          aria-pressed={activeDomain === "all"}
          className={`filter-chip ${activeDomain === "all" ? "filter-chip--active" : ""}`}
          onClick={() => changeActiveDomain("all")}
          type="button"
        >
          All tasks
          <span>{activeTasks.length}</span>
        </button>
        {domainCounts.map(({ domain, count }) => (
          <button
            aria-pressed={activeDomain === domain}
            className={`filter-chip ${activeDomain === domain ? "filter-chip--active" : ""}`}
            key={domain}
            onClick={() => changeActiveDomain(domain)}
            type="button"
          >
            {domainLabels[domain]}
            <span>{count}</span>
          </button>
        ))}
      </>
    );
  }

  function renderBookmarkBar() {
    const visibleCount = Math.min(visibleBookmarkCount, bookmarks.length);
    const overflowBookmarks = bookmarks.slice(visibleCount);
    const hasOverflow = overflowBookmarks.length > 0;

    // Keep refs array in sync with bookmark count
    bookmarkItemRefs.current = bookmarkItemRefs.current.slice(0, bookmarks.length);

    return (
      <div className="bookmark-bar" ref={bookmarkBarRef}>
        {/* Hidden measurement row — used by ResizeObserver to compute chip widths */}
        <div aria-hidden="true" className="bookmark-bar__measure">
          {bookmarks.map((bookmark, index) => (
            <button
              className="bookmark-chip"
              key={`measure-${bookmark.id}`}
              ref={(el) => {
                bookmarkItemRefs.current[index] = el;
              }}
              tabIndex={-1}
              type="button"
            >
              {bookmark.label}
              <span className="bookmark-chip__delete">×</span>
            </button>
          ))}
        </div>

        {/* Visible bookmark chips */}
        {bookmarks.slice(0, visibleCount).map((bookmark) => (
          <button
            className="bookmark-chip"
            key={bookmark.id}
            onClick={() => window.open(bookmark.url, "_blank", "noopener,noreferrer")}
            type="button"
          >
            {bookmark.label}
            <span
              className="bookmark-chip__delete"
              onMouseDown={(e) => {
                e.stopPropagation();
                void deleteBookmark(bookmark.id);
              }}
              role="button"
              tabIndex={-1}
            >
              ×
            </span>
          </button>
        ))}

        {/* More dropdown for overflow bookmarks */}
        {hasOverflow && (
          <div className="bookmark-bar__more-wrapper" ref={bookmarkMoreRef}>
            <button
              className="bookmark-bar__more"
              onClick={() => setBookmarkMoreOpen((v) => !v)}
              type="button"
            >
              More ▾
            </button>
            {bookmarkMoreOpen && (
              <div className="bookmark-bar__more-menu">
                {overflowBookmarks.map((bookmark) => (
                  <button
                    className="bookmark-bar__more-item"
                    key={bookmark.id}
                    onClick={() => {
                      window.open(bookmark.url, "_blank", "noopener,noreferrer");
                      setBookmarkMoreOpen(false);
                    }}
                    type="button"
                  >
                    <span>{bookmark.label}</span>
                    <span
                      className="bookmark-bar__more-item-delete"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        void deleteBookmark(bookmark.id);
                      }}
                      role="button"
                      tabIndex={-1}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add bookmark button */}
        <button
          className="bookmark-bar__add"
          onClick={() => setIsAddBookmarkOverlayOpen(true)}
          title="Add bookmark"
          type="button"
        >
          +
        </button>
      </div>
    );
  }

  function renderWebSearchForm(className?: string) {
    return (
      <div className={`web-search-container ${className ?? ""}`.trim()}>
        <form className="web-search" onSubmit={handleWebSearchSubmit}>
          <div className="web-search__field">
            <input
              className="web-search__input"
              aria-autocomplete="list"
              aria-label="Search the web"
              autoComplete="off"
              onChange={(event) => setWebSearch(event.target.value)}
              onBlur={() => {
                window.setTimeout(() => {
                  setIsWebSearchFocused(false);
                }, 120);
              }}
              onFocus={() => setIsWebSearchFocused(true)}
              onKeyDown={handleWebSearchKeyDown}
              placeholder="Search the web with DuckDuckGo"
              spellCheck={false}
              type="text"
              value={webSearch}
            />
            {isWebSearchFocused && (isWebSearchLoading || webSearchSuggestions.length) ? (
              <div className="web-search__suggestions" role="listbox">
                {isWebSearchLoading ? (
                  <div className="web-search__suggestion web-search__suggestion--status">
                    Loading suggestions...
                  </div>
                ) : (
                  webSearchSuggestions.map((suggestion, index) => (
                    <button
                      className={`web-search__suggestion ${selectedWebSuggestionIndex === index ? "web-search__suggestion--active" : ""}`}
                      key={suggestion}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        submitWebSearch(suggestion);
                      }}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button className="primary-button" disabled={!webSearch.trim()} type="submit">
            Search
          </button>
        </form>
        {renderBookmarkBar()}
      </div>
    );
  }

  function openTaskDetail(taskId: string) {
    setSelectedTaskId(taskId);
    setIsDetailOpen(true);
  }

  function renderWorkspaceModeSwitch() {
    return (
      <div className="workspace-mode-toggle" role="group" aria-label="Workspace mode">
        <button
          aria-pressed={workspaceView === "dashboard"}
          className={`filter-chip ${workspaceView === "dashboard" ? "filter-chip--active" : ""}`}
          onClick={() => setWorkspaceView("dashboard")}
          type="button"
        >
          Dashboard
          <span>{activeTasks.length}</span>
        </button>
        <button
          aria-pressed={workspaceView === "review"}
          className={`filter-chip ${workspaceView === "review" ? "filter-chip--active" : ""}`}
          onClick={() => setWorkspaceView("review")}
          type="button"
        >
          Review
          <span>{forgottenThingsCount}</span>
        </button>
      </div>
    );
  }

  function renderQuickCapture(className?: string) {
    return (
      <form className={`quick-capture ${className ?? ""}`.trim()} onSubmit={createInboxTask}>
        <input
          onChange={(event) => setQuickCapture(event.target.value)}
          placeholder="Capture something before you forget it"
          value={quickCapture}
        />
        <button className="primary-button" disabled={!quickCapture.trim()} type="submit">
          Add to Inbox
        </button>
      </form>
    );
  }

  function renderTaskCard(task: Task, options?: { draggable?: boolean; toned?: boolean }) {
    const checklistCounts = checklistCountsByTask.get(task.id);
    const areaName = task.area_id ? areaLookup.get(task.area_id)?.name : null;

    return (
      <button
        className={`task-card ${selectedTaskId === task.id ? "task-card--selected" : ""} ${options?.toned ? `task-card--${task.domain}` : ""}`}
        draggable={options?.draggable}
        key={task.id}
        onClick={() => openTaskDetail(task.id)}
        onDragEnd={options?.draggable ? handleTaskDragEnd : undefined}
        onDragStart={options?.draggable ? (event) => handleTaskDragStart(event, task.id) : undefined}
        style={{ viewTransitionName: `task-${toViewTransitionToken(task.id)}` }}
        type="button"
      >
        <div className="task-card__meta task-card__meta--wrap">
          <div className="task-card__meta-group">
            <span className={`domain-pill domain-pill--${task.domain}`}>{domainLabels[task.domain]}</span>
            {areaName ? <span className="area-pill">{areaName}</span> : null}
          </div>
          <span className={`priority-pill priority-pill--${task.priority}`}>{priorityLabels[task.priority]}</span>
        </div>
        <h3>{task.title}</h3>
        {task.description ? <p className="task-card__description">{task.description}</p> : null}
        {checklistCounts?.total ? (
          <p className="task-card__support">
            {checklistCounts.completed}/{checklistCounts.total} checklist item
            {checklistCounts.total === 1 ? "" : "s"}
          </p>
        ) : null}
        {task.recurring_template_id ? (
          <p className="task-card__support">
            Repeats every {formatRecurrenceSummary(recurringTemplates.find((template) => template.id === task.recurring_template_id) ?? null)}
          </p>
        ) : null}
        <div className="task-card__footer">
          <span>{statusLabels[task.status]}</span>
          <span>{formatTaskAttentionLabel(task)}</span>
        </div>
      </button>
    );
  }

  function renderReviewTaskList(tasksToRender: Task[], emptyCopy: string) {
    if (!tasksToRender.length) {
      return (
        <div className="empty-state empty-state--compact">
          <p>{emptyCopy}</p>
        </div>
      );
    }

    return (
      <div className="review-task-list">
        {tasksToRender.map((task) => {
          const areaName = task.area_id ? areaLookup.get(task.area_id)?.name : null;

          return (
            <div className="review-task-row" key={task.id}>
              <button className="review-task-row__main" onClick={() => openTaskDetail(task.id)} type="button">
                <strong>{task.title}</strong>
                <p>
                  {statusLabels[task.status]}
                  {areaName ? ` / ${areaName}` : ""}
                  {formatTaskAttentionLabel(task) !== "No date yet"
                    ? ` / ${formatTaskAttentionLabel(task)}`
                    : ""}
                </p>
              </button>
              <div className="review-task-row__actions">
                {task.status === "done" ? (
                  <button
                    className="secondary-button"
                    onClick={() => void reopenTask(task.id, "backlog")}
                    type="button"
                  >
                    Reopen
                  </button>
                ) : (
                  <>
                    {task.recurring_template_id ? (
                      <button
                        className="secondary-button"
                        onClick={() => void completeTaskById(task.id, "skip")}
                        type="button"
                      >
                        Skip
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      onClick={() => void completeTaskById(task.id, "complete")}
                      type="button"
                    >
                      Complete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderForgottenThingsPanel() {
    return (
      <section className="panel panel--soft forgotten-panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Forgotten things</p>
            <h2>What needs attention again?</h2>
          </div>
          <span className="count-pill">{forgottenThingsCount}</span>
        </div>
        <div className="memory-grid">
          <article className="memory-card">
            <strong>Inbox aging</strong>
            <span>{forgottenInboxTasks.length}</span>
            <p>Quick captures that still need triage.</p>
          </article>
          <article className="memory-card">
            <strong>Overdue</strong>
            <span>{overdueTasks.length}</span>
            <p>Tasks whose deadline has already passed.</p>
          </article>
          <article className="memory-card">
            <strong>Follow up</strong>
            <span>{dueFollowUpTasks.length}</span>
            <p>Waiting items ready to resurface.</p>
          </article>
          <article className="memory-card">
            <strong>Stale open loops</strong>
            <span>{staleOpenTasks.length}</span>
            <p>Open work with no date and no recent touch.</p>
          </article>
        </div>
      </section>
    );
  }

  function renderReviewMode() {
    const todayCommitments = reviewScopedTasks.filter((task) =>
      ["today", "in_progress"].includes(task.status)
    );
    const recurringTasks = recurringTemplates.filter((template) => template.is_active);

    return (
      <section className="review-mode">
        <section className="panel panel--soft review-hero">
          <div className="review-hero__top">
            <div>
              <p className="eyebrow">Review mode</p>
              <h2>{reviewFocus === "daily" ? "Daily briefing" : "Weekly review"}</h2>
            </div>
            <div className="review-hero__meta">
              <span className={`count-pill ${dailyReviewIsFresh ? "count-pill--fresh" : ""}`}>
                Daily {dailyReviewIsFresh ? "fresh" : "due"}
              </span>
              <span className={`count-pill ${weeklyReviewIsFresh ? "count-pill--fresh" : ""}`}>
                Weekly {weeklyReviewIsFresh ? "fresh" : "due"}
              </span>
            </div>
          </div>
          <div className="review-focus-strip" role="group" aria-label="Review focus">
            <button
              aria-pressed={reviewFocus === "daily"}
              className={`filter-chip ${reviewFocus === "daily" ? "filter-chip--active" : ""}`}
              onClick={() => setReviewFocus("daily")}
              type="button"
            >
              Daily
              <span>{todayCommitments.length}</span>
            </button>
            <button
              aria-pressed={reviewFocus === "weekly"}
              className={`filter-chip ${reviewFocus === "weekly" ? "filter-chip--active" : ""}`}
              onClick={() => setReviewFocus("weekly")}
              type="button"
            >
              Weekly
              <span>{forgottenThingsCount}</span>
            </button>
          </div>
        </section>

        {reviewFocus === "daily" ? (
          <div className="review-grid">
            <section className="panel">
              <div className="panel__header">
                <h2>Inbox to triage</h2>
                <span className="count-pill">{reviewScopedTasks.filter((task) => task.status === "inbox").length}</span>
              </div>
              {renderReviewTaskList(
                reviewScopedTasks.filter((task) => task.status === "inbox"),
                "Inbox is clear."
              )}
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Today commitments</h2>
                <span className="count-pill">{todayCommitments.length}</span>
              </div>
              {renderReviewTaskList(todayCommitments, "No tasks committed for today yet.")}
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Needs attention</h2>
                <span className="count-pill">
                  {overdueTasks.length + dueFollowUpTasks.length + staleOpenTasks.length}
                </span>
              </div>
              {renderReviewTaskList(
                [...overdueTasks, ...dueFollowUpTasks, ...staleOpenTasks].slice(0, 8),
                "Nothing urgent is slipping."
              )}
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Upcoming soon</h2>
                <span className="count-pill">{upcomingSoonTasks.length + upcomingCalendarEvents.length}</span>
              </div>
              {renderReviewTaskList(upcomingSoonTasks, "No nearby task deadlines.")}
              <div className="review-events">
                {upcomingCalendarEvents.slice(0, 5).map((event) => (
                  <button
                    className="future-event"
                    key={event.id}
                    onClick={() => openCalendarEventDetail(event)}
                    type="button"
                  >
                    <div>
                      <strong>{event.summary}</strong>
                      <p>{formatEventTimeRange(event)}</p>
                    </div>
                    <small>{event.sourceName ?? event.source}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel review-note-panel">
              <div className="panel__header">
                <h2>Close the loop</h2>
              </div>
              <label>
                Note
                <textarea
                  onChange={(event) => setDailyReviewNote(event.target.value)}
                  placeholder="What matters most today?"
                  rows={4}
                  value={dailyReviewNote}
                />
              </label>
              <button
                className="primary-button"
                disabled={isReviewSaving}
                onClick={() => void completeReview("daily")}
                type="button"
              >
                {isReviewSaving ? "Saving..." : "Mark daily briefing complete"}
              </button>
            </section>
          </div>
        ) : (
          <div className="review-grid">
            <section className="panel">
              <div className="panel__header">
                <h2>Forgotten things</h2>
                <span className="count-pill">{forgottenThingsCount}</span>
              </div>
              <div className="memory-grid memory-grid--dense">
                <article className="memory-card">
                  <strong>Inbox aging</strong>
                  <span>{forgottenInboxTasks.length}</span>
                  <p>Quick captures older than a day.</p>
                </article>
                <article className="memory-card">
                  <strong>Overdue</strong>
                  <span>{overdueTasks.length}</span>
                  <p>Deadlines that have already passed.</p>
                </article>
                <article className="memory-card">
                  <strong>Waiting</strong>
                  <span>{dueFollowUpTasks.length}</span>
                  <p>Follow-ups due today or stale.</p>
                </article>
                <article className="memory-card">
                  <strong>Stale open</strong>
                  <span>{staleOpenTasks.length}</span>
                  <p>Open work with no date and no recent touch.</p>
                </article>
              </div>
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Area sweep</h2>
                <span className="count-pill">{activeAreas.length}</span>
              </div>
              <form className="inline-form" onSubmit={addArea}>
                <input
                  onChange={(event) => setAreaDraftName(event.target.value)}
                  placeholder="Add an area like Health or Home"
                  value={areaDraftName}
                />
                <button className="secondary-button" disabled={isAreaBusy || !areaDraftName.trim()} type="submit">
                  Add area
                </button>
              </form>
              <button className="secondary-button" disabled={isAreaBusy} onClick={() => void addStarterAreas()} type="button">
                Add starter pack
              </button>
              <div className="area-stack">
                {areaReviewBuckets.map(({ area, tasks: areaTasks }) => (
                  <div className="area-row" key={area.id}>
                    <div>
                      <strong>{area.name}</strong>
                      <p>{areaTasks.length} open task{areaTasks.length === 1 ? "" : "s"}</p>
                    </div>
                    <button className="secondary-button" onClick={() => void toggleAreaArchived(area)} type="button">
                      {area.archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                ))}
                {!areaReviewBuckets.length ? (
                  <div className="empty-state empty-state--compact">
                    <p>Add areas to review responsibilities across spaces.</p>
                  </div>
                ) : null}
                {tasksWithoutArea.length ? (
                  <div className="area-row area-row--warning">
                    <div>
                      <strong>Unassigned tasks</strong>
                      <p>{tasksWithoutArea.length} task{tasksWithoutArea.length === 1 ? "" : "s"} still need an area.</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Loose ends</h2>
                <span className="count-pill">{dueFollowUpTasks.length + staleOpenTasks.length}</span>
              </div>
              {renderReviewTaskList([...dueFollowUpTasks, ...staleOpenTasks], "No loose ends are lingering.")}
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Recurring routines</h2>
                <span className="count-pill">{recurringTasks.length}</span>
              </div>
              <div className="routine-list">
                {recurringTasks.map((template) => (
                  <div className="routine-row" key={template.id}>
                    <div>
                      <strong>{template.title}</strong>
                      <p>{formatRecurrenceSummary(template)}</p>
                    </div>
                    <span className={`domain-pill domain-pill--${template.domain}`}>{domainLabels[template.domain]}</span>
                  </div>
                ))}
                {!recurringTasks.length ? (
                  <div className="empty-state empty-state--compact">
                    <p>No recurring routines yet.</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Wins from the last 7 days</h2>
                <span className="count-pill">{recentWins.length}</span>
              </div>
              {renderReviewTaskList(recentWins.slice(0, 8), "No completed wins logged yet.")}
            </section>

            <section className="panel review-note-panel">
              <div className="panel__header">
                <h2>Wrap the week</h2>
              </div>
              <label>
                Note
                <textarea
                  onChange={(event) => setWeeklyReviewNote(event.target.value)}
                  placeholder="What did you notice this week?"
                  rows={4}
                  value={weeklyReviewNote}
                />
              </label>
              <button
                className="primary-button"
                disabled={isReviewSaving}
                onClick={() => void completeReview("weekly")}
                type="button"
              >
                {isReviewSaving ? "Saving..." : "Mark weekly review complete"}
              </button>
            </section>
          </div>
        )}
      </section>
    );
  }

  function renderAccountPanel() {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>{supabase ? "Account" : "Demo mode"}</h2>
        </div>
        {supabase ? (
          session ? (
            <div className="auth-state">
              <p>{session.user.email}</p>
              <button className="secondary-button" onClick={signOut} type="button">
                Sign out
              </button>
            </div>
          ) : (
            <div className="auth-form">
              <form className="auth-form" onSubmit={sendEmailCode}>
                <label>
                  Email
                  <input
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setIsAwaitingEmailCode(false);
                      setEmailCode("");
                    }}
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                  />
                </label>
                <button className="primary-button" disabled={isSaving || !email} type="submit">
                  {isSaving && !isAwaitingEmailCode ? "Sending..." : "Send code"}
                </button>
              </form>
              {isAwaitingEmailCode ? (
                <form className="auth-form auth-form--nested" onSubmit={verifyEmailCode}>
                  <label>
                    Email code
                    <input
                      inputMode="numeric"
                      onChange={(event) => setEmailCode(event.target.value)}
                      placeholder="123456"
                      value={emailCode}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={isSaving || !emailCode.trim()}
                    type="submit"
                  >
                    {isSaving ? "Verifying..." : "Verify code"}
                  </button>
                </form>
              ) : null}
            </div>
          )
        ) : (
          <p className="muted">
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to go live.
          </p>
        )}
      </section>
    );
  }

  function renderGoogleCalendarPanel() {
    return (
      <section className="panel panel--soft">
        <div className="panel__header">
          <h2>Google Calendar</h2>
        </div>
        {!session ? (
          <p className="muted">Sign in to connect your Google Calendar.</p>
        ) : !calendarStatus.configured ? (
          <p className="muted">
            Add Google OAuth and server-side Supabase env vars to enable calendar syncing.
          </p>
        ) : calendarStatus.connected ? (
          <div className="stack-actions">
            <p className="muted">
              Connected to {calendarStatus.googleEmail ?? "your Google account"}.
            </p>
            <label>
              Default space
              <select
                disabled={isCalendarBusy}
                onChange={(event) => void updateGoogleDefaultDomain(event.target.value as Domain)}
                value={calendarStatus.defaultDomain ?? "personal"}
              >
                {DOMAIN_OPTIONS.map((domain) => (
                  <option key={domain} value={domain}>
                    {domainLabels[domain]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={isCalendarBusy}
              onClick={() => void disconnectGoogleCalendar()}
              type="button"
            >
              {isCalendarBusy ? "Working..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="stack-actions">
            <p className="muted">Authorize Google Calendar to sync due-dated tasks.</p>
            <button
              className="secondary-button"
              disabled={isCalendarBusy}
              onClick={() => void connectGoogleCalendar()}
              type="button"
            >
              {isCalendarBusy ? "Working..." : "Connect Google Calendar"}
            </button>
          </div>
        )}
      </section>
    );
  }

  function renderGoogleChatPanel() {
    return (
      <section className="panel panel--soft">
        <div className="panel__header">
          <h2>Google Chat</h2>
        </div>
        {!session ? (
          <p className="muted">Sign in to connect Google Chat for the Work space.</p>
        ) : !chatStatus.configured ? (
          <p className="muted">
            Add dedicated Google Chat OAuth env vars to enable the Work chat overlay.
          </p>
        ) : chatStatus.connected ? (
          <div className="stack-actions">
            <p className="muted">
              Connected to {chatStatus.googleEmail ?? "your Workspace account"}.
            </p>
            <p className="muted">
              This account is stored separately from the Google Calendar connection.
            </p>
            <div className="stack-actions stack-actions--inline">
              <button
                className="secondary-button"
                disabled={isChatBusy}
                onClick={() => void openChatOverlay()}
                type="button"
              >
                Open Work chat
              </button>
              <button
                className="secondary-button"
                disabled={isChatBusy}
                onClick={() => void disconnectGoogleChat()}
                type="button"
              >
                {isChatBusy ? "Working..." : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <div className="stack-actions">
            <p className="muted">
              Connect a separate Workspace Google account to read and send messages from the Work space.
            </p>
            <button
              className="secondary-button"
              disabled={isChatBusy}
              onClick={() => void connectGoogleChat()}
              type="button"
            >
              {isChatBusy ? "Working..." : "Connect Google Chat"}
            </button>
          </div>
        )}
      </section>
    );
  }

  function renderWorkChatTrigger(className?: string) {
    if (activeDomain !== "work") {
      return null;
    }

    return (
      <button
        aria-label={
          hasUnreadChatSpaces
            ? `Open Work chat. ${unreadChatCount} conversation${unreadChatCount === 1 ? "" : "s"} unread.`
            : "Open Work chat"
        }
        className={`secondary-button work-chat-trigger ${hasUnreadChatSpaces ? "work-chat-trigger--unread" : ""} ${className ?? ""}`.trim()}
        onClick={() => void openChatOverlay()}
        type="button"
      >
        <span className="work-chat-trigger__icon" aria-hidden="true">
          <span className="work-chat-trigger__glyph" />
          {hasUnreadChatSpaces ? <span className="work-chat-trigger__badge" /> : null}
        </span>
        <span>Work chat</span>
      </button>
    );
  }

  function renderArchivePanel() {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>Archive</h2>
          <span className="count-pill">{archivedTasks.length}</span>
        </div>
        <p className="muted">
          Done tasks older than {DONE_RETENTION_DAYS} days move here automatically.
        </p>
        <button className="secondary-button" onClick={openArchiveOverlay} type="button">
          View archived tasks
        </button>
      </section>
    );
  }

  function renderFeedPanel() {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>ICS Feeds</h2>
          <span className="count-pill">{calendarFeeds.length}</span>
        </div>
        <p className="muted">
          Bring in school, work, or household calendars from public `.ics` feeds.
        </p>
        <button className="secondary-button" onClick={() => setIsFeedOverlayOpen(true)} type="button">
          Manage feeds
        </button>
      </section>
    );
  }

  return (
    <main className="shell" data-space={activeDomain}>
      <section className="mobile-shell">
        <header className="panel panel--soft mobile-hero">
          <div className="mobile-hero__header">
            <div>
              <p className="eyebrow">Personal OS</p>
              <h1>Focus Desk</h1>
            </div>
            <p className="mobile-hero__summary">
              {activeTasks.length} active tasks, {visibleCalendarEvents.length} calendar events
            </p>
          </div>
          <div className="mobile-space-strip" aria-label="Spaces" role="group">
            {renderSpaceFilters()}
          </div>
          {activeDomain === "work" ? (
            <div className="mobile-hero__actions">{renderWorkChatTrigger("work-chat-trigger--mobile")}</div>
          ) : null}
        </header>

        {googleAuthExpired ? (
          <div className="notice">
            Google Calendar needs to be reconnected.{" "}
            <button disabled={isCalendarBusy} onClick={() => void connectGoogleCalendar()} type="button">
              Reconnect
            </button>
          </div>
        ) : null}
        {notice ? <div className="notice">{notice}</div> : null}

        <section className="mobile-pane" hidden={mobileSection !== "tasks"}>
          <div className="mobile-section-header">
            <div>
              <p className="eyebrow">Tasks</p>
              <h2>Capture and plan</h2>
            </div>
            <button className="primary-button" onClick={openAddTaskOverlay} type="button">
              Add task
            </button>
          </div>

          <section className="panel mobile-tools">
            {renderQuickCapture("quick-capture--mobile")}
            <label>
              Filter tasks
              <input
                className="search-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title or notes"
                value={search}
              />
            </label>
          </section>

          <div className="mobile-status-strip" aria-label="Task statuses" role="group">
            {groupedTasks.map(({ status, tasks: statusTasks }) => (
              <button
                aria-pressed={mobileTaskStatus === status}
                className={`filter-chip ${mobileTaskStatus === status ? "filter-chip--active" : ""}`}
                key={status}
                onClick={() => setMobileTaskStatus(status)}
                type="button"
              >
                {statusLabels[status]}
                <span>{statusTasks.length}</span>
              </button>
            ))}
          </div>

          <section className="panel mobile-board-column">
            <div className="panel__header">
              <h2>{mobileTaskGroup?.status ? statusLabels[mobileTaskGroup.status] : "Tasks"}</h2>
              <span className="count-pill">{mobileTaskGroup?.tasks.length ?? 0}</span>
            </div>
            <div className="task-list task-list--mobile">
              {mobileTaskGroup?.tasks.length ? (
                mobileTaskGroup.tasks.map((task) =>
                  renderTaskCard(task, { toned: activeDomain === "all" })
                )
              ) : (
                <div className="empty-state">
                  <p>No tasks in this lane.</p>
                </div>
              )}
            </div>
          </section>
        </section>

        <section className="mobile-pane" hidden={mobileSection !== "calendar"}>
          <div className="mobile-section-header">
            <div>
              <p className="eyebrow">Calendar</p>
              <h2>Today and next</h2>
            </div>
            <button
              className="secondary-button"
              disabled={!calendarStatus.connected}
              onClick={() => setIsEventOverlayOpen(true)}
              type="button"
            >
              New event
            </button>
          </div>

          <section className="panel mobile-calendar-card">
            <div className="panel__header">
              <h2>Today</h2>
              <span className="count-pill">{todayEvents.length}</span>
            </div>

            {!session ? (
              <div className="empty-state">
                <p>Sign in to load your calendar.</p>
              </div>
            ) : !hasCalendarSources ? (
              <div className="empty-state">
                <p>Connect Google Calendar or add an ICS feed to populate this view.</p>
              </div>
            ) : (
              <div className="mobile-agenda">
                {todayAllDayEvents.length ? (
                  <div className="mobile-agenda__block">
                    <p className="eyebrow">All day</p>
                    <div className="mobile-agenda__list">
                      {todayAllDayEvents.map((event) => (
                        <button
                          className={`calendar-pill ${activeDomain === "all" ? `calendar-pill--${event.domain}` : ""}`}
                          key={event.id}
                          onClick={() => openCalendarEventDetail(event)}
                          style={{ viewTransitionName: `event-${toViewTransitionToken(event.id)}` }}
                          type="button"
                        >
                          <span>{event.summary}</span>
                          <small>{event.sourceName ?? event.source}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mobile-agenda__block">
                  <p className="eyebrow">Timed events</p>
                  {todayTimedEvents.length ? (
                    <div className="future-day__events">
                      {todayTimedEvents.map((event) => (
                        <button
                          className={`future-event ${activeDomain === "all" ? `future-event--${event.domain}` : ""}`}
                          key={event.id}
                          onClick={() => openCalendarEventDetail(event)}
                          style={{ viewTransitionName: `event-${toViewTransitionToken(event.id)}` }}
                          type="button"
                        >
                          <div>
                            <strong>{event.summary}</strong>
                            <p>{formatEventTimeRange(event)}</p>
                          </div>
                          <small>{event.sourceName ?? event.source}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No timed events scheduled today.</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="panel mobile-calendar-card">
            <div className="panel__header">
              <h2>Next 5 Days</h2>
              <span className="count-pill">
                {nextFiveDayBuckets.reduce((total, bucket) => total + bucket.events.length, 0)}
              </span>
            </div>

            {!session ? (
              <div className="empty-state">
                <p>Sign in to load your calendar.</p>
              </div>
            ) : !hasCalendarSources ? (
              <div className="empty-state">
                <p>Connect Google Calendar or add an ICS feed to populate this view.</p>
              </div>
            ) : (
              <div className="future-days">
                {nextFiveDayBuckets.map((bucket) => (
                  <section className="future-day" key={bucket.date.toISOString()}>
                    <div className="future-day__header">
                      <h4>{formatDayHeading(bucket.date)}</h4>
                    </div>
                    {bucket.events.length ? (
                      <div className="future-day__events">
                        {bucket.events.map((event) => (
                          <button
                            className={`future-event ${activeDomain === "all" ? `future-event--${event.domain}` : ""}`}
                            key={event.id}
                            onClick={() => openCalendarEventDetail(event)}
                            style={{ viewTransitionName: `event-${toViewTransitionToken(event.id)}` }}
                            type="button"
                          >
                            <div>
                              <strong>{event.summary}</strong>
                              <p>{formatEventTimeRange(event)}</p>
                            </div>
                            <small>{event.sourceName ?? event.source}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">No events scheduled.</p>
                    )}
                  </section>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="mobile-pane" hidden={mobileSection !== "review"}>
          <div className="mobile-section-header">
            <div>
              <p className="eyebrow">Review</p>
              <h2>Remember what slipped</h2>
            </div>
          </div>
          {renderReviewMode()}
        </section>

        <section className="mobile-pane mobile-pane--more" hidden={mobileSection !== "more"}>
          <div className="mobile-section-header">
            <div>
              <p className="eyebrow">More</p>
              <h2>Account and tools</h2>
            </div>
          </div>

          <section className="panel">
            <div className="panel__header">
              <h2>Web search</h2>
            </div>
            {renderWebSearchForm("web-search--mobile")}
          </section>

          {renderAccountPanel()}
          {renderGoogleCalendarPanel()}
          {renderGoogleChatPanel()}
          {renderArchivePanel()}
          {renderFeedPanel()}
        </section>
      </section>

      <nav aria-label="Primary" className="mobile-bottom-nav">
        {MOBILE_SECTIONS.map((section) => (
          <button
            aria-pressed={mobileSection === section.id}
            className={`mobile-bottom-nav__button ${mobileSection === section.id ? "mobile-bottom-nav__button--active" : ""}`}
            key={section.id}
            onClick={() => setMobileSection(section.id)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </nav>

      <aside className="sidebar desktop-shell">
        <div className="sidebar__top">
          <p className="eyebrow">Personal OS</p>
          <h1>Focus Desk</h1>
          <p className="sidebar__copy">
            A dashboard for personal life, work, and school.
          </p>
        </div>

        <div className="scroll-shell">
          <div className="sidebar__scroll scroll-fade">
            <section className="panel">
              <div className="panel__header">
                <h2>Spaces</h2>
              </div>
              {renderSpaceFilters()}
            </section>

            {renderAccountPanel()}
            {renderGoogleCalendarPanel()}
            {renderGoogleChatPanel()}
            {renderArchivePanel()}
            {renderFeedPanel()}
          </div>
        </div>
      </aside>

      <section className="workspace desktop-shell">
        <div className="workspace__top">
          <header className="workspace__header">
            <div>
              <p className="eyebrow">{workspaceView === "dashboard" ? "Dashboard" : "Review"}</p>
              <h2>{workspaceView === "dashboard" ? "Daily command center" : "Memory scaffolding"}</h2>
            </div>
            {renderWorkspaceModeSwitch()}
          </header>

          <div className="workspace__toolbar">
            {renderWebSearchForm()}

            <div className="workspace__actions">
              {renderQuickCapture()}
              <input
                className="search-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter tasks"
                value={search}
              />
              {renderWorkChatTrigger()}
              <button className="primary-button" onClick={openAddTaskOverlay} type="button">
                Add task
              </button>
            </div>
          </div>

          {googleAuthExpired ? (
            <div className="notice">
              Google Calendar needs to be reconnected.{" "}
              <button disabled={isCalendarBusy} onClick={() => void connectGoogleCalendar()} type="button">
                Reconnect
              </button>
            </div>
          ) : null}
          {notice ? <div className="notice">{notice}</div> : null}
        </div>

        <div className="scroll-shell">
          <div className="workspace__content scroll-fade">
            {workspaceView === "dashboard" ? (
              <>
                {renderForgottenThingsPanel()}

                <section className="board">
                  {groupedTasks.map(({ status, tasks: statusTasks }) => (
                    <article
                      className={`board-column panel ${dragOverStatus === status ? "board-column--drag-over" : ""}`}
                      key={status}
                      onDragLeave={() => handleColumnDragLeave(status)}
                      onDragOver={(event) => handleColumnDragOver(event, status)}
                      onDrop={(event) => void handleColumnDrop(event, status)}
                    >
                      <div className="panel__header">
                        <h2>{statusLabels[status]}</h2>
                        <span className="count-pill">{statusTasks.length}</span>
                      </div>
                      <div className="task-list scroll-fade">
                        {statusTasks.map((task) =>
                          renderTaskCard(task, {
                            draggable: task.status !== "done",
                            toned: activeDomain === "all"
                          })
                        )}
                        {!statusTasks.length ? (
                          <div className="empty-state">
                            <p>No tasks here yet.</p>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </section>

                <section className="panel calendar-panel">
                  <div className="calendar-panel__top">
                    <div className="panel__header">
                      <h2>Calendar</h2>
                      <span className="count-pill">{visibleCalendarEvents.length}</span>
                    </div>

                    <div className="calendar-panel__actions">
                      <button
                        className="secondary-button"
                        disabled={!calendarStatus.connected}
                        onClick={() => setIsEventOverlayOpen(true)}
                        type="button"
                      >
                        New calendar event
                      </button>
                    </div>
                  </div>

                  <div className="calendar-panel__body">
                    <div className="calendar-grid">
                      <section className="calendar-card">
                        <div className="calendar-card__header">
                          <div>
                            <p className="eyebrow">Today</p>
                            <h3>{formatDayHeading(new Date())}</h3>
                          </div>
                        </div>

                        <div className="calendar-card__body">
                          {!session ? (
                            <div className="empty-state">
                              <p>Sign in to load your calendar.</p>
                            </div>
                          ) : !hasCalendarSources ? (
                            <div className="empty-state">
                              <p>Connect Google Calendar or add an ICS feed to populate this view.</p>
                            </div>
                          ) : (
                            <div className="today-view">
                              {todayAllDayEvents.length ? (
                                <div className="all-day-strip">
                                  <span className="all-day-strip__label">All day</span>
                                  <div className="all-day-strip__items">
                                    {todayAllDayEvents.map((event) => (
                                      <button
                                        className={`calendar-pill ${activeDomain === "all" ? `calendar-pill--${event.domain}` : ""}`}
                                        key={event.id}
                                        onClick={() => openCalendarEventDetail(event)}
                                        style={{ viewTransitionName: `event-${toViewTransitionToken(event.id)}` }}
                                        type="button"
                                      >
                                        <span>{event.summary}</span>
                                        <small>{event.sourceName ?? event.source}</small>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              <div className="timeline">
                                <div className="timeline__hours">
                                  {timelineHours.map((hour) => (
                                    <div className="timeline-row__hour" key={hour}>
                                      {formatHour(hour)}
                                    </div>
                                  ))}
                                </div>
                                <div className="timeline__body">
                                  {timelineHours.map((hour) => (
                                    <div className="timeline-slot" key={hour}>
                                      <div className="timeline-slot__quarter timeline-slot__quarter--quarter" />
                                      <div className="timeline-slot__quarter timeline-slot__quarter--half" />
                                      <div className="timeline-slot__quarter timeline-slot__quarter--three-quarters" />
                                    </div>
                                  ))}

                                  {nowLineOffset !== null ? (
                                    <div
                                      className="timeline-now-line"
                                      style={{
                                        top: `${nowLineOffset}%`
                                      }}
                                    >
                                      <span className="timeline-now-line__label">{formatNow(now)}</span>
                                      <span className="timeline-now-line__rule" />
                                    </div>
                                  ) : null}

                                  {timelineEventLayouts.length ? (
                                    <div className="timeline__events">
                                      {timelineEventLayouts.map(
                                        ({ event, topPercent, heightPercent, column, totalColumns }) => (
                                          <button
                                            className={`timeline-event ${activeDomain === "all" ? `timeline-event--${event.domain}` : ""}`}
                                            key={event.id}
                                            onClick={() => openCalendarEventDetail(event)}
                                            style={{
                                              ...getTimelineEventStyle(
                                                topPercent,
                                                heightPercent,
                                                column,
                                                totalColumns
                                              ),
                                              viewTransitionName: `event-${toViewTransitionToken(event.id)}`
                                            }}
                                            type="button"
                                          >
                                            <div className="timeline-event__header">
                                              <h4>{event.summary}</h4>
                                              <span>{formatEventTimeRange(event)}</span>
                                            </div>
                                            <p>{event.sourceName ?? event.source}</p>
                                          </button>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <div className="timeline-row__empty timeline-row__empty--full" />
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="calendar-card">
                        <div className="calendar-card__header">
                          <div>
                            <p className="eyebrow">Next 5 Days</p>
                            <h3>Upcoming</h3>
                          </div>
                        </div>

                        <div className="calendar-card__body">
                          {!session ? (
                            <div className="empty-state">
                              <p>Sign in to load your calendar.</p>
                            </div>
                          ) : !hasCalendarSources ? (
                            <div className="empty-state">
                              <p>Connect Google Calendar or add an ICS feed to populate this view.</p>
                            </div>
                          ) : (
                            <div className="future-days">
                              {nextFiveDayBuckets.map((bucket) => (
                                <section className="future-day" key={bucket.date.toISOString()}>
                                  <div className="future-day__header">
                                    <h4>{formatDayHeading(bucket.date)}</h4>
                                  </div>
                                  {bucket.events.length ? (
                                    <div className="future-day__events">
                                      {bucket.events.map((event) => (
                                        <button
                                          className={`future-event ${activeDomain === "all" ? `future-event--${event.domain}` : ""}`}
                                          key={event.id}
                                          onClick={() => openCalendarEventDetail(event)}
                                          style={{ viewTransitionName: `event-${toViewTransitionToken(event.id)}` }}
                                          type="button"
                                        >
                                          <div>
                                            <strong>{event.summary}</strong>
                                            <p>{formatEventTimeRange(event)}</p>
                                          </div>
                                          <small>{event.sourceName ?? event.source}</small>
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="muted">No events scheduled.</p>
                                  )}
                                </section>
                              ))}
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              renderReviewMode()
            )}
          </div>
        </div>
      </section>

      {isAddBookmarkOverlayOpen ? (
        <Overlay
          onClose={() => {
            setIsAddBookmarkOverlayOpen(false);
            setBookmarkLabel("");
            setBookmarkUrl("");
          }}
          title="Add bookmark"
          variant="center"
        >
          <form className="detail__content" onSubmit={(e) => void handleAddBookmark(e)}>
            <input
              autoFocus
              onChange={(e) => setBookmarkLabel(e.target.value)}
              placeholder="Label (e.g. GitHub)"
              value={bookmarkLabel}
            />
            <input
              onChange={(e) => setBookmarkUrl(e.target.value)}
              placeholder="URL (e.g. https://github.com)"
              type="url"
              value={bookmarkUrl}
            />
            <button
              className="primary-button"
              disabled={!bookmarkLabel.trim() || !bookmarkUrl.trim()}
              type="submit"
            >
              Add bookmark
            </button>
          </form>
        </Overlay>
      ) : null}

      {isAddTaskOverlayOpen ? (
        <Overlay onClose={() => setIsAddTaskOverlayOpen(false)} title="Add task" variant="center">
          <form className="detail__content" onSubmit={createTask}>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Write a task title"
              value={draft.title}
            />
            <textarea
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Add context, notes, or next actions"
              rows={5}
              value={draft.description ?? ""}
            />
            <div className="composer__grid">
              <label>
                Space
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      domain: event.target.value as Domain
                    }))
                  }
                  value={draft.domain}
                >
                  {DOMAIN_OPTIONS.map((domain) => (
                    <option key={domain} value={domain}>
                      {domainLabels[domain]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value as TaskStatus
                    }))
                  }
                  value={draft.status}
                >
                  {EDITABLE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      priority: event.target.value as TaskPriority
                    }))
                  }
                  value={draft.priority}
                >
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priorityLabels[priority]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Area
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      area_id: event.target.value || null
                    }))
                  }
                  value={draft.area_id ?? ""}
                >
                  <option value="">No area yet</option>
                  {activeAreas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Planned date
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      planned_date: event.target.value || null
                    }))
                  }
                  type="date"
                  value={draft.planned_date ?? ""}
                />
              </label>
              <label>
                Due date
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      due_date: event.target.value || null
                    }))
                  }
                  type="date"
                  value={draft.due_date ?? ""}
                />
              </label>
              {draft.status === "waiting" ? (
                <label>
                  Follow-up date
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        follow_up_date: event.target.value || null
                      }))
                    }
                    type="date"
                    value={draft.follow_up_date ?? ""}
                  />
                </label>
              ) : null}
            </div>
            <div className="detail-block">
              <label className="checkbox-row">
                <input
                  checked={recurrenceDraft.enabled}
                  onChange={(event) =>
                    setRecurrenceDraft((current) => ({ ...current, enabled: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>Make this recurring</span>
              </label>
              {recurrenceDraft.enabled ? (
                <div className="split-grid">
                  <label>
                    Every
                    <input
                      min={1}
                      onChange={(event) =>
                        setRecurrenceDraft((current) => ({
                          ...current,
                          intervalCount: Number(event.target.value) || 1
                        }))
                      }
                      type="number"
                      value={recurrenceDraft.intervalCount}
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      onChange={(event) =>
                        setRecurrenceDraft((current) => ({
                          ...current,
                          intervalUnit: event.target.value as RecurrenceUnit
                        }))
                      }
                      value={recurrenceDraft.intervalUnit}
                    >
                      {RECURRENCE_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit === "day" ? "Days" : unit === "week" ? "Weeks" : "Months"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Anchor date
                    <input
                      onChange={(event) =>
                        setRecurrenceDraft((current) => ({
                          ...current,
                          anchorDate: event.target.value
                        }))
                      }
                      type="date"
                      value={recurrenceDraft.anchorDate}
                    />
                  </label>
                  <label>
                    Due offset (days)
                    <input
                      onChange={(event) =>
                        setRecurrenceDraft((current) => ({
                          ...current,
                          dueOffsetDays: Number(event.target.value) || 0
                        }))
                      }
                      type="number"
                      value={recurrenceDraft.dueOffsetDays}
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <button className="primary-button" disabled={isSaving || isLoading} type="submit">
              {isSaving ? "Saving..." : "Add task"}
            </button>
          </form>
        </Overlay>
      ) : null}

      {isDetailOpen ? (
        <Overlay onClose={() => setIsDetailOpen(false)} title="Task detail" variant="wide">
          {selectedTask ? (
            <div className="detail__content">
              <label>
                Title
                <input
                  onChange={(event) => void updateSelectedTask({ title: event.target.value })}
                  value={selectedTask.title}
                />
              </label>
              <label>
                Notes
                <textarea
                  onChange={(event) => void updateSelectedTask({ description: event.target.value })}
                  rows={8}
                  value={selectedTask.description ?? ""}
                />
              </label>
              <label>
                Space
                <select
                  onChange={(event) => void updateSelectedTask({ domain: event.target.value as Domain })}
                  value={selectedTask.domain}
                >
                  {DOMAIN_OPTIONS.map((domain) => (
                    <option key={domain} value={domain}>
                      {domainLabels[domain]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  onChange={(event) =>
                    void updateSelectedTask({ status: event.target.value as TaskStatus })
                  }
                  value={selectedTask.status}
                >
                  {(selectedTask.status === "done" ? STATUS_OPTIONS : EDITABLE_STATUS_OPTIONS).map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  onChange={(event) =>
                    void updateSelectedTask({ priority: event.target.value as TaskPriority })
                  }
                  value={selectedTask.priority}
                >
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priorityLabels[priority]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Area
                <select
                  onChange={(event) => void updateSelectedTask({ area_id: event.target.value || null })}
                  value={selectedTask.area_id ?? ""}
                >
                  <option value="">No area yet</option>
                  {activeAreas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Planned date
                <input
                  onChange={(event) =>
                    void updateSelectedTask({ planned_date: event.target.value || null })
                  }
                  type="date"
                  value={selectedTask.planned_date ?? ""}
                />
              </label>
              <label>
                Due date
                <input
                  onChange={(event) =>
                    void updateSelectedTask({ due_date: event.target.value || null })
                  }
                  type="date"
                  value={selectedTask.due_date ?? ""}
                />
              </label>
              {selectedTask.status === "waiting" ? (
                <label>
                  Follow-up date
                  <input
                    onChange={(event) =>
                      void updateSelectedTask({ follow_up_date: event.target.value || null })
                    }
                    type="date"
                    value={selectedTask.follow_up_date ?? ""}
                  />
                </label>
              ) : null}
              <div className="detail-actions">
                {selectedTask.status === "done" ? (
                  <button
                    className="secondary-button"
                    onClick={() => void reopenTask(selectedTask.id, "backlog")}
                    type="button"
                  >
                    Reopen task
                  </button>
                ) : (
                  <>
                    {selectedTask.recurring_template_id ? (
                      <button
                        className="secondary-button"
                        onClick={() => void completeTaskById(selectedTask.id, "skip")}
                        type="button"
                      >
                        Skip and roll forward
                      </button>
                    ) : null}
                    <button
                      className="primary-button"
                      onClick={() => void completeTaskById(selectedTask.id, "complete")}
                      type="button"
                    >
                      Complete task
                    </button>
                  </>
                )}
              </div>
              <button
                className="secondary-button"
                disabled={!canSyncSelectedTask || isCalendarBusy}
                onClick={() => void syncSelectedTaskToCalendar()}
                type="button"
              >
                {isCalendarBusy
                  ? "Syncing..."
                  : selectedTask.google_calendar_event_id
                    ? "Update Google Calendar event"
                    : "Sync to Google Calendar"}
              </button>
              {selectedTask.google_calendar_event_url ? (
                <a
                  className="text-link"
                  href={selectedTask.google_calendar_event_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open in Google Calendar
                </a>
              ) : null}
              {!selectedTask.due_date ? (
                <p className="muted">Add a due date to sync this task as an all-day event.</p>
              ) : null}
              <form className="detail-block" onSubmit={saveRecurringSettings}>
                <div className="panel__header">
                  <h2>Recurrence</h2>
                  {selectedRecurringTemplate ? (
                    <span className="count-pill">{selectedRecurringTemplate.is_active ? "On" : "Paused"}</span>
                  ) : null}
                </div>
                <label className="checkbox-row">
                  <input
                    checked={recurrenceDraft.enabled}
                    onChange={(event) =>
                      setRecurrenceDraft((current) => ({ ...current, enabled: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>Repeat this task</span>
                </label>
                {recurrenceDraft.enabled ? (
                  <div className="split-grid">
                    <label>
                      Every
                      <input
                        min={1}
                        onChange={(event) =>
                          setRecurrenceDraft((current) => ({
                            ...current,
                            intervalCount: Number(event.target.value) || 1
                          }))
                        }
                        type="number"
                        value={recurrenceDraft.intervalCount}
                      />
                    </label>
                    <label>
                      Unit
                      <select
                        onChange={(event) =>
                          setRecurrenceDraft((current) => ({
                            ...current,
                            intervalUnit: event.target.value as RecurrenceUnit
                          }))
                        }
                        value={recurrenceDraft.intervalUnit}
                      >
                        {RECURRENCE_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit === "day" ? "Days" : unit === "week" ? "Weeks" : "Months"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Anchor date
                      <input
                        onChange={(event) =>
                          setRecurrenceDraft((current) => ({
                            ...current,
                            anchorDate: event.target.value
                          }))
                        }
                        type="date"
                        value={recurrenceDraft.anchorDate}
                      />
                    </label>
                    <label>
                      Due offset (days)
                      <input
                        onChange={(event) =>
                          setRecurrenceDraft((current) => ({
                            ...current,
                            dueOffsetDays: Number(event.target.value) || 0
                          }))
                        }
                        type="number"
                        value={recurrenceDraft.dueOffsetDays}
                      />
                    </label>
                  </div>
                ) : null}
                <button className="secondary-button" disabled={isRecurringBusy} type="submit">
                  {isRecurringBusy ? "Saving..." : "Save recurrence"}
                </button>
              </form>
              <div className="detail-block">
                <div className="panel__header">
                  <h2>Checklist</h2>
                  <span className="count-pill">{selectedTaskChecklist.length}</span>
                </div>
                <form className="inline-form" onSubmit={addChecklistItem}>
                  <input
                    onChange={(event) => setChecklistDraftLabel(event.target.value)}
                    placeholder="Add a hidden step"
                    value={checklistDraftLabel}
                  />
                  <button className="secondary-button" disabled={isChecklistBusy || !checklistDraftLabel.trim()} type="submit">
                    Add
                  </button>
                </form>
                <div className="checklist">
                  {selectedTaskChecklist.map((item) => (
                    <div className="checklist__item" key={item.id}>
                      <button className="checklist__toggle" onClick={() => void toggleChecklistItem(item)} type="button">
                        {item.completed_at ? "Done" : "Open"}
                      </button>
                      <span className={item.completed_at ? "checklist__label checklist__label--done" : "checklist__label"}>
                        {item.label}
                      </span>
                      <button className="icon-button" onClick={() => void removeChecklistItem(item.id)} type="button">
                        Remove
                      </button>
                    </div>
                  ))}
                  {!selectedTaskChecklist.length ? (
                    <div className="empty-state empty-state--compact">
                      <p>No checklist items yet.</p>
                    </div>
                  ) : null}
                </div>
              </div>
              <button className="danger-button" onClick={() => void deleteSelectedTask()} type="button">
                Delete task
              </button>
            </div>
          ) : (
            <div className="empty-state empty-state--detail">
              <p>Select a task to edit it.</p>
            </div>
          )}
        </Overlay>
      ) : null}

      {isEventOverlayOpen ? (
        <Overlay onClose={() => setIsEventOverlayOpen(false)} title="New calendar event">
          {!calendarStatus.connected ? (
            <div className="empty-state empty-state--detail">
              <p>Connect Google Calendar before creating events.</p>
            </div>
          ) : (
            <form className="detail__content" onSubmit={createCalendarEvent}>
              <label>
                Title
                <input
                  onChange={(event) =>
                    setEventDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Project review"
                  value={eventDraft.title}
                />
              </label>
              <label>
                Description
                <textarea
                  onChange={(event) =>
                    setEventDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={5}
                  value={eventDraft.description}
                />
              </label>
              <label>
                Date
                <input
                  onChange={(event) =>
                    setEventDraft((current) => ({ ...current, date: event.target.value }))
                  }
                  type="date"
                  value={eventDraft.date}
                />
              </label>
              <label>
                Space
                <select
                  onChange={(event) =>
                    setEventDraft((current) => ({
                      ...current,
                      domain: event.target.value as Domain
                    }))
                  }
                  value={eventDraft.domain}
                >
                  {DOMAIN_OPTIONS.map((domain) => (
                    <option key={domain} value={domain}>
                      {domainLabels[domain]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  checked={eventDraft.allDay}
                  onChange={(event) =>
                    setEventDraft((current) => ({ ...current, allDay: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>All day event</span>
              </label>
              {!eventDraft.allDay ? (
                <div className="split-grid">
                  <label>
                    Start time
                    <input
                      onChange={(event) =>
                        setEventDraft((current) => ({ ...current, startTime: event.target.value }))
                      }
                      type="time"
                      value={eventDraft.startTime}
                    />
                  </label>
                  <label>
                    End time
                    <input
                      onChange={(event) =>
                        setEventDraft((current) => ({ ...current, endTime: event.target.value }))
                      }
                      type="time"
                      value={eventDraft.endTime}
                    />
                  </label>
                </div>
              ) : null}
              <button className="primary-button" disabled={isCalendarBusy || !eventDraft.title} type="submit">
                {isCalendarBusy ? "Creating..." : "Create event"}
              </button>
            </form>
          )}
        </Overlay>
      ) : null}

      {isChatOverlayOpen ? (
        <Overlay onClose={() => setIsChatOverlayOpen(false)} title="Work chat" variant="wide">
          {!session ? (
            <div className="empty-state empty-state--detail">
              <p>Sign in to open the Work chat overlay.</p>
            </div>
          ) : !chatStatus.configured ? (
            <div className="empty-state empty-state--detail">
              <p>Add the dedicated Google Chat OAuth env vars to enable this workspace.</p>
            </div>
          ) : !chatStatus.connected ? (
            <div className="empty-state empty-state--detail">
              <div className="chat-overlay__empty">
                <p>Connect a separate Workspace Google account to use Work chat.</p>
                <button
                  className="primary-button"
                  disabled={isChatBusy}
                  onClick={() => void connectGoogleChat()}
                  type="button"
                >
                  {isChatBusy ? "Connecting..." : "Connect Google Chat"}
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-overlay">
              <aside className="chat-space-panel">
                <div className="chat-space-panel__header">
                  <div>
                    <p className="eyebrow">Workspace account</p>
                    <h3>{chatStatus.googleEmail ?? "Google Chat"}</h3>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={isChatLoading || isChatBusy}
                    onClick={() => void loadChatSpaces()}
                    type="button"
                  >
                    {isChatLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                <div className="chat-space-list">
                  {chatSpaces.length ? (
                    chatSpaces.map((space) => (
                      <button
                        className={`chat-space-item ${selectedChatSpaceName === space.name ? "chat-space-item--active" : ""}`}
                        key={space.name}
                        onClick={() => void selectChatSpace(space)}
                        type="button"
                      >
                        <div className="chat-space-item__top">
                          <strong>{space.displayName}</strong>
                          <span>{formatChatActivityTime(space.lastActiveTime)}</span>
                        </div>
                        <p>{space.previewText ?? getChatSpaceTypeLabel(space.spaceType)}</p>
                        {space.unread ? (
                          <span className="chat-space-item__badge">Unread</span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      <p>{isChatLoading ? "Loading spaces..." : "No Chat spaces found yet."}</p>
                    </div>
                  )}
                </div>
              </aside>

              <section className="chat-thread">
                {selectedChatSpace ? (
                  <>
                    <div className="chat-thread__header">
                      <div>
                        <p className="eyebrow">{getChatSpaceTypeLabel(selectedChatSpace.spaceType)}</p>
                        <h3>{selectedChatSpace.displayName}</h3>
                      </div>
                      <div className="chat-thread__header-actions">
                        <span className="chat-thread__meta">
                          {formatChatActivityTime(selectedChatSpace.lastActiveTime)}
                        </span>
                        <button
                          className="secondary-button chat-thread__label-button"
                          onClick={() => openChatSpaceAliasEditor(selectedChatSpace)}
                          title="Assign a custom label to this conversation"
                          type="button"
                        >
                          Label chat
                        </button>
                      </div>
                    </div>

                    <div className="chat-thread__messages" ref={chatMessagesRef}>
                      {chatMessages.length ? (
                        chatMessages.map((message) => {
                          const displaySenderLabel = getDisplayedChatMessageSenderLabel(
                            message,
                            selectedChatSpace
                          );

                          return (
                            <article
                              className={`chat-message ${message.isSelf ? "chat-message--self" : ""}`}
                              key={message.name}
                            >
                              <div className="chat-message__meta">
                                {message.senderName && !message.isSelf ? (
                                  <button
                                    className="chat-message__author-button"
                                    onClick={() => openChatSenderAliasEditor(message)}
                                    title="Assign a custom label to this sender"
                                    type="button"
                                  >
                                    {displaySenderLabel}
                                  </button>
                                ) : (
                                  <strong>{displaySenderLabel}</strong>
                                )}
                                <span>{formatChatMessageTime(message.createTime)}</span>
                              </div>
                              <div className="chat-message__bubble">
                                <p>{message.text}</p>
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <div className="empty-state chat-thread__empty">
                          <p>
                            {isChatMessagesLoading
                              ? "Loading conversation..."
                              : "No recent messages in this space."}
                          </p>
                        </div>
                      )}
                    </div>

                    <form className="chat-composer" onSubmit={sendChatMessage}>
                      <label className="chat-composer__field">
                        <span>Message</span>
                        <textarea
                          onChange={(event) => setChatComposer(event.target.value)}
                          placeholder={`Message ${selectedChatSpace.displayName}`}
                          rows={3}
                          value={chatComposer}
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={isChatBusy || !chatComposer.trim()}
                        type="submit"
                      >
                        {isChatBusy ? "Sending..." : "Send"}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="empty-state empty-state--detail">
                    <p>Select a conversation to view messages.</p>
                  </div>
                )}
              </section>
            </div>
          )}
        </Overlay>
      ) : null}

      {chatAliasEditor ? (
        <Overlay onClose={() => setChatAliasEditor(null)} title={chatAliasEditor.title} variant="center">
          <form className="detail__content" onSubmit={saveChatAlias}>
            <p className="muted">{chatAliasEditor.helper}</p>
            <label>
              Custom label
              <input
                onChange={(event) =>
                  setChatAliasEditor((current) =>
                    current ? { ...current, draftLabel: event.target.value } : current
                  )
                }
                placeholder="Enter a name you recognize"
                value={chatAliasEditor.draftLabel}
              />
            </label>
            <button
              className="primary-button"
              disabled={isChatAliasBusy || !chatAliasEditor.draftLabel.trim()}
              type="submit"
            >
              {isChatAliasBusy ? "Saving..." : "Save label"}
            </button>
            <button
              className="secondary-button"
              disabled={isChatAliasBusy}
              onClick={() => void clearChatAlias()}
              type="button"
            >
              {isChatAliasBusy ? "Working..." : "Reset to automatic"}
            </button>
          </form>
        </Overlay>
      ) : null}

      {selectedCalendarEvent ? (
        <Overlay
          onClose={() => setSelectedCalendarEvent(null)}
          title="Event details"
          variant="center"
        >
          <div className="event-detail">
            <div className="event-detail__header">
              <h3>{selectedCalendarEvent.summary}</h3>
              {selectedCalendarEvent.domain ? (
                <span className={`domain-pill domain-pill--${selectedCalendarEvent.domain}`}>
                  {domainLabels[selectedCalendarEvent.domain]}
                </span>
              ) : null}
            </div>
            <div className="event-detail__meta">
              <strong>Date</strong>
              <span>{formatEventDateLabel(selectedCalendarEvent)}</span>
            </div>
            <div className="event-detail__meta">
              <strong>Time</strong>
              <span>{formatEventTimeRange(selectedCalendarEvent)}</span>
            </div>
            <div className="event-detail__meta">
              <strong>Source</strong>
              <span>{selectedCalendarEvent.sourceName ?? selectedCalendarEvent.source}</span>
            </div>
            <button
              className="primary-button"
              disabled={isTaskConversionBusy}
              onClick={() => void convertCalendarEventToTask()}
              type="button"
            >
              {isTaskConversionBusy ? "Converting..." : "Convert to task"}
            </button>
            {selectedCalendarEvent.description ? (
              <div className="event-detail__section">
                <strong>Description</strong>
                <p>{selectedCalendarEvent.description}</p>
              </div>
            ) : null}
            {selectedCalendarEvent.htmlLink ? (
              <a
                className="text-link"
                href={selectedCalendarEvent.htmlLink}
                rel="noreferrer"
                target="_blank"
              >
                Open in calendar
              </a>
            ) : null}
          </div>
        </Overlay>
      ) : null}

      {isArchiveOverlayOpen ? (
        <Overlay onClose={() => setIsArchiveOverlayOpen(false)} title="Archived tasks" variant="center">
          <div className="detail__content">
            <div className="overlay-filter-row">
              <button
                className={`filter-chip ${archivedDomainFilter === "all" ? "filter-chip--active" : ""}`}
                onClick={() => setArchivedDomainFilter("all")}
                type="button"
              >
                All archived
                <span>{archivedTasks.length}</span>
              </button>
              {DOMAIN_OPTIONS.map((domain) => (
                <button
                  className={`filter-chip ${archivedDomainFilter === domain ? "filter-chip--active" : ""}`}
                  key={domain}
                  onClick={() => setArchivedDomainFilter(domain)}
                  type="button"
                >
                  {domainLabels[domain]}
                  <span>{archivedTasks.filter((task) => task.domain === domain).length}</span>
                </button>
              ))}
            </div>

            <div className="overlay-task-list">
              {filteredArchivedTasks.map((task) => (
                <button
                  className={`task-card ${archivedDomainFilter === "all" ? `task-card--${task.domain}` : ""}`}
                  key={task.id}
                  onClick={() => openArchivedTask(task.id)}
                  type="button"
                >
                  <div className="task-card__meta">
                    <span className={`domain-pill domain-pill--${task.domain}`}>
                      {domainLabels[task.domain]}
                    </span>
                    <span className={`priority-pill priority-pill--${task.priority}`}>
                      {priorityLabels[task.priority]}
                    </span>
                  </div>
                  <h3>{task.title}</h3>
                  {task.description ? <p className="task-card__description">{task.description}</p> : null}
                  <div className="task-card__footer">
                    <span>Archived after {formatRelativeArchiveDate(task.completed_at ?? task.updated_at ?? task.created_at ?? null)}</span>
                    <span>{task.due_date ? formatDate(task.due_date) : "No deadline"}</span>
                  </div>
                </button>
              ))}
              {!filteredArchivedTasks.length ? (
                <div className="empty-state">
                  <p>No archived tasks for this space.</p>
                </div>
              ) : null}
            </div>
          </div>
        </Overlay>
      ) : null}

      {isFeedOverlayOpen ? (
        <Overlay onClose={() => setIsFeedOverlayOpen(false)} title="ICS feeds">
          {!session ? (
            <div className="empty-state empty-state--detail">
              <p>Sign in to manage calendar feeds.</p>
            </div>
          ) : (
            <div className="detail__content">
              <form className="overlay-feed-form" onSubmit={addCalendarFeed}>
                <label>
                  Feed name
                  <input
                    onChange={(event) => setFeedName(event.target.value)}
                    placeholder="School schedule"
                    value={feedName}
                  />
                </label>
                <label>
                  ICS URL
                  <input
                    onChange={(event) => setFeedUrl(event.target.value)}
                    placeholder="https://example.com/calendar.ics"
                    type="url"
                    value={feedUrl}
                  />
                </label>
                <label>
                  Space
                  <select
                    onChange={(event) => setFeedDomain(event.target.value as Domain)}
                    value={feedDomain}
                  >
                    {DOMAIN_OPTIONS.map((domain) => (
                      <option key={domain} value={domain}>
                        {domainLabels[domain]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" disabled={isFeedBusy || !feedUrl} type="submit">
                  {isFeedBusy ? "Saving..." : "Add feed"}
                </button>
              </form>

              <div className="overlay-feed-list">
                {calendarFeeds.map((feed) => (
                  <button
                    className="feed-item feed-item--button"
                    key={feed.id}
                    onClick={() => openFeedDetail(feed)}
                    type="button"
                  >
                    <div>
                      <strong>{feed.name || "Untitled feed"}</strong>
                      <p>Click to view or edit this feed.</p>
                    </div>
                    <span className={`domain-pill domain-pill--${feed.domain}`}>
                      {domainLabels[feed.domain]}
                    </span>
                  </button>
                ))}
                {!calendarFeeds.length ? <p className="muted">No ICS feeds connected yet.</p> : null}
              </div>
            </div>
          )}
        </Overlay>
      ) : null}

      {isFeedDetailOverlayOpen ? (
        <Overlay onClose={() => setIsFeedDetailOverlayOpen(false)} title="Feed details">
          {selectedFeed ? (
            <form className="detail__content" onSubmit={updateSelectedFeed}>
              <label>
                Feed name
                <input
                  onChange={(event) => setFeedEditName(event.target.value)}
                  value={feedEditName}
                />
              </label>
              <label>
                ICS URL
                <input
                  onChange={(event) => setFeedEditUrl(event.target.value)}
                  type="url"
                  value={feedEditUrl}
                />
              </label>
              <label>
                Space
                <select
                  onChange={(event) => setFeedEditDomain(event.target.value as Domain)}
                  value={feedEditDomain}
                >
                  {DOMAIN_OPTIONS.map((domain) => (
                    <option key={domain} value={domain}>
                      {domainLabels[domain]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={isFeedBusy || !feedEditUrl} type="submit">
                {isFeedBusy ? "Saving..." : "Save changes"}
              </button>
              <button
                className="danger-button"
                disabled={isFeedBusy}
                onClick={() => void removeCalendarFeed(selectedFeed.id)}
                type="button"
              >
                Remove feed
              </button>
            </form>
          ) : (
            <div className="empty-state empty-state--detail">
              <p>Select a feed to edit it.</p>
            </div>
          )}
        </Overlay>
      ) : null}
    </main>
  );
}

function Overlay({
  children,
  onClose,
  title,
  variant = "side"
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  variant?: "side" | "center" | "wide";
}) {
  return (
    <div className="detail-overlay" onClick={onClose} role="presentation">
      <aside
        aria-label={title}
        className={`detail-modal panel ${variant === "center" ? "detail-modal--center" : ""} ${variant === "wide" ? "detail-modal--wide" : ""}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel__header">
          <h2>{title}</h2>
          <button aria-label={`Close ${title}`} className="icon-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function getChatTimestampValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortChatSpaces(spaces: GoogleChatSpace[]) {
  return [...spaces].sort((left, right) => {
    if (left.unread !== right.unread) {
      return left.unread ? -1 : 1;
    }

    return getChatTimestampValue(right.lastActiveTime) - getChatTimestampValue(left.lastActiveTime);
  });
}

function getDisplayedChatMessageSenderLabel(
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

function getChatSpaceTypeLabel(spaceType: GoogleChatSpace["spaceType"]) {
  switch (spaceType) {
    case "DIRECT_MESSAGE":
      return "Direct message";
    case "GROUP_CHAT":
      return "Group chat";
    default:
      return "Space";
  }
}

function formatChatActivityTime(value: string | null) {
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

function formatChatMessageTime(value: string | null) {
  if (!value) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(value: string | null, date: Date) {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayHeading(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatHour(hour: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric"
  }).format(new Date(2026, 0, 1, hour));
}

function formatEventTimeRange(event: CalendarEvent) {
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

function formatEventDateLabel(event: CalendarEvent) {
  if (!event.start) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(parseEventDate(event.start));
}

function getTaskDueDateFromCalendarEvent(event: CalendarEvent) {
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

function extractDateOnly(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return formatDateInputValue(new Date(value));
}

function getInclusiveAllDayDate(value: string) {
  const date = parseEventDate(value);
  date.setDate(date.getDate() - 1);
  return formatDateInputValue(date);
}

function getNormalizedTaskStatus(
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

function getNormalizedTaskPatch(task: Task, patch: Partial<TaskDraft>, todayKey: string) {
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

function getTaskLifecyclePatch(task: Task, patch: Partial<Task>) {
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

function shouldAutoMoveTaskToToday(task: Task, todayKey: string) {
  return task.status === "backlog" && (task.planned_date === todayKey || task.due_date === todayKey);
}

function isArchivedTask(task: Task, now: Date) {
  if (task.status !== "done") {
    return false;
  }

  const completedAt = getTaskCompletedAt(task);

  if (!completedAt) {
    return false;
  }

  return now.getTime() - completedAt.getTime() > DONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

function getTaskCompletedAt(task: Task) {
  const value = task.completed_at ?? task.updated_at ?? task.created_at ?? null;
  return value ? new Date(value) : null;
}

function formatRelativeArchiveDate(value: string | null) {
  if (!value) {
    return "an unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function toViewTransitionToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getTaskSortTimestamp(task: Task) {
  const value = task.updated_at ?? task.created_at ?? null;
  return value ? new Date(value).getTime() : 0;
}

function getTaskAttentionDate(task: Task) {
  if (task.status === "waiting") {
    return task.follow_up_date ?? null;
  }

  return task.planned_date ?? task.due_date ?? null;
}

function getTaskDistanceFromToday(task: Task, todayKey: string) {
  const attentionDate = getTaskAttentionDate(task);

  if (!attentionDate) {
    return Number.POSITIVE_INFINITY;
  }

  const dueTime = parseEventDate(attentionDate).getTime();
  const todayTime = parseEventDate(todayKey).getTime();
  return Math.abs(dueTime - todayTime);
}

function getDaysSinceTimestamp(value: string | null | undefined, now: Date) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const date = new Date(value);
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function getTaskAgeInDays(task: Task, now: Date) {
  return getDaysSinceTimestamp(task.updated_at ?? task.created_at ?? null, now);
}

function isDateWithinDays(value: string, todayKey: string, days: number) {
  const delta = parseEventDate(value).getTime() - parseEventDate(todayKey).getTime();
  return delta >= 0 && delta <= days * 24 * 60 * 60 * 1000;
}

function formatTaskAttentionLabel(task: Task) {
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

function getPreparedTaskValues(taskDraft: TaskDraft, todayKey: string) {
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

function getDueOffsetDays(plannedDate: string | null | undefined, dueDate: string | null | undefined) {
  if (!plannedDate || !dueDate) {
    return 0;
  }

  const planned = parseEventDate(plannedDate).getTime();
  const due = parseEventDate(dueDate).getTime();

  return Math.max(0, Math.round((due - planned) / (24 * 60 * 60 * 1000)));
}

function advanceRecurringDate(baseDate: string, unit: RecurrenceUnit, count: number) {
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

function buildNextRecurringTask(task: Task, template: RecurringTaskTemplate): Task {
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

function formatRecurrenceSummary(template: RecurringTaskTemplate | null) {
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

function getStarterAreas(): Area[] {
  return STARTER_AREAS.map((name, index) => ({
    id: `starter-area-${index}`,
    name,
    position: index,
    archived: false
  }));
}

function parseEventDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

function getTimedEventRangeInMinutes(event: CalendarEvent) {
  const startDate = event.start ? new Date(event.start) : null;
  const endDate = event.end ? new Date(event.end) : null;
  const startMinutes = startDate ? startDate.getHours() * 60 + startDate.getMinutes() : 0;
  const rawEndMinutes = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : startMinutes + 60;

  return {
    startMinutes,
    endMinutes: Math.max(rawEndMinutes, startMinutes + MIN_TIMED_EVENT_DURATION_MINUTES)
  };
}

function getTimelineEventLayouts(
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

function getTimelineEventStyle(
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNow(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(now);
}
