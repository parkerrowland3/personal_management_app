"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type { Session } from "@supabase/supabase-js";

import { sampleTasks } from "@/lib/sample-data";
import {
  DOMAIN_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type CalendarEvent,
  type CalendarFeed,
  type Domain,
  type GoogleCalendarStatus,
  type Task,
  type TaskDraft,
  type TaskPriority,
  type TaskStatus
} from "@/lib/types";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const EMPTY_TASK: TaskDraft = {
  title: "",
  description: "",
  domain: "personal",
  status: "today",
  priority: "medium",
  due_date: null
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
  backlog: "Backlog",
  today: "Today",
  in_progress: "In Progress",
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

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return STATUS_OPTIONS.indexOf(left.status) - STATUS_OPTIONS.indexOf(right.status);
    }

    if (left.domain !== right.domain) {
      return DOMAIN_OPTIONS.indexOf(left.domain) - DOMAIN_OPTIONS.indexOf(right.domain);
    }

    if (left.due_date && right.due_date) {
      return left.due_date.localeCompare(right.due_date);
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

export function TaskShell() {
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>(sampleTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(sampleTasks[0]?.id ?? null);
  const [selectedFeed, setSelectedFeed] = useState<CalendarFeed | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEventOverlayOpen, setIsEventOverlayOpen] = useState(false);
  const [isFeedOverlayOpen, setIsFeedOverlayOpen] = useState(false);
  const [isFeedDetailOverlayOpen, setIsFeedDetailOverlayOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK);
  const [eventDraft, setEventDraft] = useState(EMPTY_EVENT_DRAFT);
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<Domain | "all">("all");
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedDomain, setFeedDomain] = useState<Domain>("personal");
  const [feedEditName, setFeedEditName] = useState("");
  const [feedEditUrl, setFeedEditUrl] = useState("");
  const [feedEditDomain, setFeedEditDomain] = useState<Domain>("personal");
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured());
  const [isSaving, setIsSaving] = useState(false);
  const [isCalendarBusy, setIsCalendarBusy] = useState(false);
  const [isFeedBusy, setIsFeedBusy] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus>({
    configured: false,
    connected: false,
    googleEmail: null,
    calendarId: null,
    defaultDomain: null
  });
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarFeeds, setCalendarFeeds] = useState<CalendarFeed[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(
    isSupabaseConfigured()
      ? null
      : "Demo mode is active. Add your Supabase URL and anon key to connect live data."
  );

  const deferredSearch = useDeferredValue(search);
  const supabase = getSupabaseBrowserClient();

  const anyOverlayOpen =
    isDetailOpen || isEventOverlayOpen || isFeedOverlayOpen || isFeedDetailOverlayOpen;

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
      return;
    }

    const payload = (await response.json()) as { events: CalendarEvent[] };
    setCalendarEvents(payload.events);
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
    const connected = params.get("calendar");
    const error = params.get("calendar_error");

    if (!connected && !error) {
      return;
    }

    if (connected === "connected") {
      setNotice("Google Calendar connected.");
      void loadCalendarStatus();
      void loadCalendarEvents();
    }

    if (error) {
      setNotice(`Google Calendar error: ${error}`);
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("calendar");
    nextUrl.searchParams.delete("calendar_error");
    window.history.replaceState({}, "", nextUrl.toString());
  }, [loadCalendarEvents, loadCalendarStatus]);

  useEffect(() => {
    if (!anyOverlayOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDetailOpen(false);
        setIsEventOverlayOpen(false);
        setIsFeedOverlayOpen(false);
        setIsFeedDetailOverlayOpen(false);
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
      }

      setIsLoading(false);
    }

    bootstrap();

    const authSubscription = client.auth.onAuthStateChange((_event, nextSession) => {
      startTransition(() => {
        setSession(nextSession);
      });

      if (nextSession?.user.id) {
        void loadTasks(nextSession.user.id);
        void loadCalendarStatus();
        void loadCalendarEvents();
        void loadCalendarFeeds();
      } else {
        setTasks(sampleTasks);
        setSelectedTaskId(sampleTasks[0]?.id ?? null);
        setSelectedFeed(null);
        setIsDetailOpen(false);
        setIsEventOverlayOpen(false);
        setIsFeedOverlayOpen(false);
        setIsFeedDetailOverlayOpen(false);
        setCalendarStatus({
          configured: false,
          connected: false,
          googleEmail: null,
          calendarId: null,
          defaultDomain: null
        });
        setCalendarEvents([]);
        setCalendarFeeds([]);
        setNotice("Signed out. Demo mode data is shown until you sign in again.");
      }
    });

    return () => {
      isMounted = false;
      authSubscription.data.subscription.unsubscribe();
    };
  }, [loadCalendarEvents, loadCalendarFeeds, loadCalendarStatus, loadTasks, supabase]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  const visibleTasks = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesDomain = activeDomain === "all" || task.domain === activeDomain;
      const matchesSearch =
        !normalized ||
        task.title.toLowerCase().includes(normalized) ||
        task.description?.toLowerCase().includes(normalized);

      return matchesDomain && matchesSearch;
    });
  }, [activeDomain, deferredSearch, tasks]);

  const groupedTasks = useMemo(() => {
    return STATUS_OPTIONS.map((status) => ({
      status,
      tasks: visibleTasks.filter((task) => task.status === status)
    }));
  }, [visibleTasks]);

  const domainCounts = useMemo(() => {
    return DOMAIN_OPTIONS.map((domain) => ({
      domain,
      count: tasks.filter((task) => task.domain === domain).length
    }));
  }, [tasks]);

  const visibleCalendarEvents = useMemo(() => {
    return calendarEvents.filter(
      (event) => activeDomain === "all" || event.domain === activeDomain
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

  const todayAllDayEvents = useMemo(
    () => todayEvents.filter((event) => event.isAllDay),
    [todayEvents]
  );

  const todayTimedEvents = useMemo(
    () => todayEvents.filter((event) => !event.isAllDay && event.start),
    [todayEvents]
  );

  const timelineHours = useMemo(() => {
    if (!todayTimedEvents.length) {
      return Array.from({ length: 14 }, (_, index) => index + 7);
    }

    const hours = todayTimedEvents.map((event) => new Date(event.start!).getHours());
    const first = Math.max(0, Math.min(...hours, 7));
    const last = Math.min(23, Math.max(...hours, 20));

    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }, [todayTimedEvents]);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice("Supabase is not configured yet.");
      return;
    }

    setIsSaving(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? window.location.origin : undefined
      }
    });

    setNotice(
      error ? error.message : `Magic link sent to ${email}. Open the email and come back here.`
    );
    setIsSaving(false);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim()) {
      setNotice("Task title is required.");
      return;
    }

    if (!supabase || !session?.user.id) {
      const nextTask: Task = {
        ...draft,
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        description: draft.description?.trim() || null
      };
      const nextTasks = sortTasks([nextTask, ...tasks]);
      setTasks(nextTasks);
      setSelectedTaskId(nextTask.id);
      setIsDetailOpen(true);
      setDraft(EMPTY_TASK);
      setNotice("Task added in demo mode.");
      return;
    }

    setIsSaving(true);

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...draft,
        user_id: session.user.id,
        title: draft.title.trim(),
        description: draft.description?.trim() || null
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
    setIsDetailOpen(true);
    setDraft(EMPTY_TASK);
    setNotice("Task created.");
    setIsSaving(false);
  }

  async function updateSelectedTask(patch: Partial<TaskDraft>) {
    if (!selectedTask) {
      return;
    }

    const optimisticTask: Task = {
      ...selectedTask,
      ...patch
    };

    setTasks((current) =>
      sortTasks(current.map((task) => (task.id === selectedTask.id ? optimisticTask : task)))
    );

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      setNotice("Updated locally in demo mode.");
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        ...patch,
        description: patch.description?.trim() || null
      })
      .eq("id", selectedTask.id);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    setNotice("Task updated.");
  }

  async function deleteSelectedTask() {
    if (!selectedTask) {
      return;
    }

    const fallbackId = tasks.find((task) => task.id !== selectedTask.id)?.id ?? null;
    setTasks((current) => current.filter((task) => task.id !== selectedTask.id));
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

  return (
    <main className="shell" data-space={activeDomain}>
      <aside className="sidebar">
        <div className="sidebar__top">
          <p className="eyebrow">Personal OS</p>
          <h1>Focus Desk</h1>
          <p className="sidebar__copy">
            A dashboard for personal life, work, and school.
          </p>
        </div>

        <section className="panel">
          <div className="panel__header">
            <h2>Spaces</h2>
          </div>
          <button
            className={`filter-chip ${activeDomain === "all" ? "filter-chip--active" : ""}`}
            onClick={() => setActiveDomain("all")}
            type="button"
          >
            All tasks
            <span>{tasks.length}</span>
          </button>
          {domainCounts.map(({ domain, count }) => (
            <button
              className={`filter-chip ${activeDomain === domain ? "filter-chip--active" : ""}`}
              key={domain}
              onClick={() => setActiveDomain(domain)}
              type="button"
            >
              {domainLabels[domain]}
              <span>{count}</span>
            </button>
          ))}
        </section>

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
              <form className="auth-form" onSubmit={sendMagicLink}>
                <label>
                  Email
                  <input
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                  />
                </label>
                <button className="primary-button" disabled={isSaving || !email} type="submit">
                  {isSaving ? "Sending..." : "Send magic link"}
                </button>
              </form>
            )
          ) : (
            <p className="muted">
              Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to go live.
            </p>
          )}
        </section>

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
                  onChange={(event) =>
                    void updateGoogleDefaultDomain(event.target.value as Domain)
                  }
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
      </aside>

      <section className="workspace">
        <header className="workspace__header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2>Daily command center</h2>
          </div>

          <div className="workspace__actions">
            <input
              className="search-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks"
              value={search}
            />
          </div>
        </header>

        {notice ? <div className="notice">{notice}</div> : null}

        <section className="composer panel">
          <div className="panel__header">
            <h2>Quick capture</h2>
          </div>
          <form className="composer__form" onSubmit={createTask}>
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
              rows={3}
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
                  {STATUS_OPTIONS.map((status) => (
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
            </div>
            <button className="primary-button" disabled={isSaving || isLoading} type="submit">
              {isSaving ? "Saving..." : "Add task"}
            </button>
          </form>
        </section>

        <section className="board">
          {groupedTasks.map(({ status, tasks: statusTasks }) => (
            <article className="board-column panel" key={status}>
              <div className="panel__header">
                <h2>{statusLabels[status]}</h2>
                <span className="count-pill">{statusTasks.length}</span>
              </div>
              <div className="task-list">
                {statusTasks.map((task) => (
                  <button
                    className={`task-card ${selectedTaskId === task.id ? "task-card--selected" : ""}`}
                    key={task.id}
                    onClick={() => {
                      setSelectedTaskId(task.id);
                      setIsDetailOpen(true);
                    }}
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
                    {task.description ? <p>{task.description}</p> : null}
                    <div className="task-card__footer">
                      <span>{statusLabels[task.status]}</span>
                      <span>{task.due_date ? formatDate(task.due_date) : "No deadline"}</span>
                    </div>
                  </button>
                ))}
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

          <div className="calendar-grid">
            <section className="calendar-card">
              <div className="calendar-card__header">
                <div>
                  <p className="eyebrow">Today</p>
                  <h3>{formatDayHeading(new Date())}</h3>
                </div>
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
                <div className="today-view">
                  {todayAllDayEvents.length ? (
                    <div className="all-day-strip">
                      <span className="all-day-strip__label">All day</span>
                      <div className="all-day-strip__items">
                        {todayAllDayEvents.map((event) => (
                          <article className="calendar-pill" key={event.id}>
                            <span>{event.summary}</span>
                            <small>{event.sourceName ?? event.source}</small>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="timeline">
                    {timelineHours.map((hour) => {
                      const eventsForHour = todayTimedEvents.filter(
                        (event) => new Date(event.start!).getHours() === hour
                      );

                      return (
                        <div className="timeline-row" key={hour}>
                          {isCurrentHour(hour, now) ? (
                            <div
                              className="timeline-now-line"
                              style={{
                                top: `${(now.getMinutes() / 60) * 100}%`
                              }}
                            >
                              <span className="timeline-now-line__label">{formatNow(now)}</span>
                              <span className="timeline-now-line__rule" />
                            </div>
                          ) : null}
                          <div className="timeline-row__hour">{formatHour(hour)}</div>
                          <div className="timeline-row__events">
                            {eventsForHour.length ? (
                              eventsForHour.map((event) => (
                                <article className="timeline-event" key={event.id}>
                                  <div className="timeline-event__header">
                                    <h4>{event.summary}</h4>
                                    <span>{formatEventTimeRange(event)}</span>
                                  </div>
                                  <p>{event.sourceName ?? event.source}</p>
                                </article>
                              ))
                            ) : (
                              <div className="timeline-row__empty" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="calendar-card">
              <div className="calendar-card__header">
                <div>
                  <p className="eyebrow">Next 5 Days</p>
                  <h3>Upcoming</h3>
                </div>
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
                            <article className="future-event" key={event.id}>
                              <div>
                                <strong>{event.summary}</strong>
                                <p>{formatEventTimeRange(event)}</p>
                              </div>
                              <small>{event.sourceName ?? event.source}</small>
                            </article>
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
          </div>
        </section>
      </section>

      {isDetailOpen ? (
        <Overlay onClose={() => setIsDetailOpen(false)} title="Task detail">
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
                  {STATUS_OPTIONS.map((status) => (
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
                Due date
                <input
                  onChange={(event) =>
                    void updateSelectedTask({ due_date: event.target.value || null })
                  }
                  type="date"
                  value={selectedTask.due_date ?? ""}
                />
              </label>
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
  title
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="detail-overlay" onClick={onClose} role="presentation">
      <aside
        aria-label={title}
        className="detail-modal panel"
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

function parseEventDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

function isCurrentHour(hour: number, now: Date) {
  return hour === now.getHours();
}

function formatNow(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(now);
}
