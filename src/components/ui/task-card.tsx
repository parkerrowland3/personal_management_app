"use client";

import type { DragEvent } from "react";

import type { Area, RecurringTaskTemplate, Task, TaskStatus, TaskPriority, Domain } from "@/lib/types";
import { formatRecurrenceSummary, formatTaskAttentionLabel, toViewTransitionToken } from "@/lib/task-shell-utils";

type ChecklistCounts = { total: number; completed: number };

type TaskCardProps = {
  task: Task;
  draggable?: boolean;
  toned?: boolean;
  selected: boolean;
  checklistCounts?: ChecklistCounts;
  area?: Area;
  recurringTemplate?: RecurringTaskTemplate;
  statusLabels: Record<TaskStatus, string>;
  domainLabels: Record<Domain, string>;
  priorityLabels: Record<TaskPriority, string>;
  onOpen: (taskId: string) => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>, taskId: string) => void;
  onDragEnd?: () => void;
};

export function TaskCard({
  task,
  draggable,
  toned,
  selected,
  checklistCounts,
  area,
  recurringTemplate,
  statusLabels,
  domainLabels,
  priorityLabels,
  onOpen,
  onDragStart,
  onDragEnd
}: TaskCardProps) {
  const areaName = area?.name ?? null;

  return (
    <button
      className={`task-card ${selected ? "task-card--selected" : ""} ${toned ? `task-card--${task.domain}` : ""}`}
      draggable={draggable}
      onClick={() => onOpen(task.id)}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragStart={draggable && onDragStart ? (event) => onDragStart(event, task.id) : undefined}
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
      {recurringTemplate ? (
        <p className="task-card__support">Repeats every {formatRecurrenceSummary(recurringTemplate)}</p>
      ) : null}
      <div className="task-card__footer">
        <span>{statusLabels[task.status]}</span>
        <span>{formatTaskAttentionLabel(task)}</span>
      </div>
    </button>
  );
}
