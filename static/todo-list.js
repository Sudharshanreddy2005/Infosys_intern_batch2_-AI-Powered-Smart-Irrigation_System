(() => {
  "use strict";

  const api = window.JalSaathiProfile;
  const state = {
    tasks: [],
    activeTab: "today",
    reminderSettings: {
      enabled: false,
      interval_hours: 2,
      custom_interval_hours: null,
      next_reminder_at: null,
    },
    reminderTimer: null,
    recognition: null,
  };

  const getText = (key, fallback) => window.JalSaathiI18n?.t(key) || fallback;

  const showVoiceStatus = (message, type = "") => {
    const node = document.getElementById("voice-status");
    if (!(node instanceof HTMLElement)) return;
    node.textContent = message;
    node.classList.remove("error", "success");
    if (type) node.classList.add(type);
  };

  const parseTaskDate = (value) => {
    const date = value ? new Date(value) : null;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return date;
  };

  const formatDateTime = (value) => {
    const date = parseTaskDate(value);
    if (!date) return "Not scheduled";
    const options = {
      dateStyle: "medium",
      timeStyle: "short",
    };
    if (window.JalSaathiI18n?.formatDate) {
      return window.JalSaathiI18n.formatDate(date, options);
    }
    const dateOptions = window.JalSaathiNumberFormat?.dateOptions(options) ??
      { ...options, numberingSystem: "latn" };
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, dateOptions).format(date);
  };

  const buildReminderMessage = (pendingTasks) => {
    if (!pendingTasks.length) {
      return getText("todo.pendingTaskNone", "All farm activities are complete.");
    }
    const lines = pendingTasks.map((task, index) => `${index + 1}. ${task.title}`);
    return `${getText("todo.pendingTaskSummary", "You have {count} pending farm activities.").replace("{count}", pendingTasks.length)}\n${lines.join("\n")}`;
  };

  const selectedIntervalHours = () => {
    const select = document.getElementById("reminder-interval");
    if (!(select instanceof HTMLSelectElement)) return 2;
    if (select.value === "custom") {
      const customInput = document.getElementById("custom-interval");
      if (customInput instanceof HTMLInputElement) {
        const value = Number(customInput.value);
        return Number.isFinite(value) && value > 0 ? value : 1;
      }
      return 1;
    }
    return Number(select.value) || 2;
  };

  const setReminderToggle = (enabled) => {
    const toggle = document.getElementById("reminder-toggle");
    if (!(toggle instanceof HTMLElement)) return;
    toggle.classList.toggle("is-enabled", Boolean(enabled));
    toggle.setAttribute("aria-pressed", String(Boolean(enabled)));
  };

  const renderReminderPanel = () => {
    const settings = state.reminderSettings || {};
    const intervalSelect = document.getElementById("reminder-interval");
    const customWrap = document.getElementById("custom-interval-wrap");
    const customInput = document.getElementById("custom-interval");
    const nextLabel = document.getElementById("next-reminder-text");

    if (intervalSelect instanceof HTMLSelectElement) {
      if (settings.custom_interval_hours && settings.interval_hours === Number(settings.custom_interval_hours)) {
        intervalSelect.value = "custom";
      } else {
        intervalSelect.value = String(settings.interval_hours || 2);
      }
    }
    if (customWrap instanceof HTMLElement) {
      customWrap.hidden = intervalSelect?.value !== "custom";
    }
    if (customInput instanceof HTMLInputElement) {
      customInput.value = settings.custom_interval_hours ? String(settings.custom_interval_hours) : "3";
    }
    setReminderToggle(Boolean(settings.enabled));
    if (nextLabel instanceof HTMLElement) {
      nextLabel.textContent = settings.next_reminder_at
        ? `${getText("todo.nextReminder", "Next reminder")} ${formatDateTime(settings.next_reminder_at)}`
        : getText("todo.reminderDisabled", "Reminders are disabled.");
    }
  };

  const renderTaskList = () => {
    const tasks = [...state.tasks];
    const list = document.getElementById("task-list");
    if (!(list instanceof HTMLElement)) return;
    const filtered = state.activeTab === "completed"
      ? tasks.filter((task) => Boolean(task.completed_at))
      : state.activeTab === "all"
        ? tasks
        : tasks.filter((task) => !task.completed_at);

    if (!filtered.length) {
      list.innerHTML = `<div class="task-empty">${getText("todo.noTasks", "No tasks yet. Add your next farm activity.")}</div>`;
      return;
    }

    list.innerHTML = filtered.map((task) => {
      const completed = Boolean(task.completed_at);
      const badgeText = completed ? getText("todo.completedBadge", "Completed") : getText("todo.pendingBadge", "Pending");
      const fallbackDate = completed ? "Completed" : "Pending";
      const fieldText = task.field_name ? `${getText("todo.taskFieldLabel", "Field")}: ${task.field_name}` : "";
      return `
        <article class="task-item" data-task-id="${task.id}">
          <input class="task-check" type="checkbox" data-action="toggle" ${completed ? "checked" : ""} aria-label="Mark task as complete" />
          <div class="task-copy">
            <div class="task-title">${task.title}</div>
            <div class="task-meta">
              ${fieldText ? `<span>${fieldText}</span>` : ""}
              <span>${completed ? fallbackDate : fallbackDate}</span>
            </div>
          </div>
          <span class="task-badge">${badgeText}</span>
          <div class="task-action-group">
            <button type="button" class="icon-button" data-action="edit" aria-label="Edit task">✎</button>
            <button type="button" class="icon-button delete" data-action="delete" aria-label="Delete task">🗑</button>
          </div>
        </article>
      `;
    }).join("");
  };

  const loadTasks = async () => {
    try {
      const tasks = await api.apiRequest("/api/todo/tasks");
      state.tasks = Array.isArray(tasks) ? tasks : [];
      renderTaskList();
    } catch (error) {
      console.error("Could not load farm tasks:", error);
      showVoiceStatus(error instanceof Error ? error.message : "Could not load tasks.", "error");
    }
  };

  const loadReminderSettings = async () => {
    try {
      const settings = await api.apiRequest("/api/todo/reminder-settings");
      state.reminderSettings = settings || state.reminderSettings;
      renderReminderPanel();
      scheduleReminder();
    } catch (error) {
      console.error("Could not load reminder settings:", error);
    }
  };

  const saveReminderSettings = async (override = {}) => {
    const settings = {
      enabled: Boolean(override.enabled ?? state.reminderSettings.enabled),
      interval_hours: Number(override.interval_hours ?? state.reminderSettings.interval_hours ?? 2),
      custom_interval_hours: override.custom_interval_hours ?? state.reminderSettings.custom_interval_hours ?? null,
    };

    if (settings.enabled && !("Notification" in window) && !api?.getProfile) {
      showVoiceStatus(getText("todo.backgroundNotice", "Browser notifications work while the app remains open."), "error");
    }

    const nextInterval = settings.interval_hours || 2;
    const payload = {
      enabled: settings.enabled,
      interval_hours: nextInterval,
      custom_interval_hours: settings.custom_interval_hours,
      next_reminder_at: settings.enabled ? new Date(Date.now() + nextInterval * 60 * 60 * 1000).toISOString() : null,
    };

    const saved = await api.apiRequest("/api/todo/reminder-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.reminderSettings = saved || payload;
    renderReminderPanel();
    scheduleReminder();
    return saved;
  };

  const triggerReminderNotification = async () => {
    const pending = await api.apiRequest("/api/todo/pending-tasks");
    const message = buildReminderMessage(Array.isArray(pending) ? pending : []);
    if (!pending || !pending.length) {
      const nextHours = selectedIntervalHours();
      const updated = await saveReminderSettings({ enabled: true, interval_hours: nextHours, custom_interval_hours: nextHours });
      state.reminderSettings = updated || state.reminderSettings;
      scheduleReminder();
      return;
    }

    if ("Notification" in window && Notification.permission === "granted") {
      const key = `jalsaathi-todo-reminder-${new Date().toISOString().slice(0, 15)}`;
      const last = window.localStorage.getItem("jalsaathi.todo.lastReminder");
      if (last !== key) {
        window.localStorage.setItem("jalsaathi.todo.lastReminder", key);
        const notice = new Notification("JalSaathi", {
          body: `${getText("todo.pendingTaskSummary", "You have {count} pending farm activities.").replace("{count}", pending.length)}\n${pending.map((task) => task.title).join("\n")}`,
          tag: "jalsaathi-farm-todo-reminder",
        });
        notice.onclick = () => window.focus();
      }
    }

    const nextHours = selectedIntervalHours();
    const nextReminder = new Date(Date.now() + nextHours * 60 * 60 * 1000).toISOString();
    const updated = await api.apiRequest("/api/todo/reminder-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        interval_hours: nextHours,
        custom_interval_hours: nextHours,
        next_reminder_at: nextReminder,
      }),
    });
    state.reminderSettings = updated || state.reminderSettings;
    renderReminderPanel();
    scheduleReminder();
  };

  const scheduleReminder = () => {
    const settings = state.reminderSettings || {};
    if (state.reminderTimer) {
      clearTimeout(state.reminderTimer);
      state.reminderTimer = null;
    }
    if (!settings.enabled || !settings.next_reminder_at) {
      renderReminderPanel();
      return;
    }

    const nextDate = parseTaskDate(settings.next_reminder_at);
    if (!nextDate) {
      renderReminderPanel();
      return;
    }
    const delay = nextDate.getTime() - Date.now();
    if (delay <= 0) {
      void triggerReminderNotification();
      return;
    }
    state.reminderTimer = window.setTimeout(() => {
      void triggerReminderNotification();
    }, delay);
    renderReminderPanel();
  };

  const handleAddTask = async () => {
    const input = document.getElementById("task-input");
    if (!(input instanceof HTMLInputElement)) return;
    const title = input.value.trim();
    if (!title) {
      showVoiceStatus(getText("todo.noTasks", "No tasks yet. Add your next farm activity."), "error");
      return;
    }

    try {
      const saved = await api.apiRequest("/api/todo/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      input.value = "";
      state.tasks = [...state.tasks, saved];
      renderTaskList();
      showVoiceStatus(getText("todo.voiceCaptured", "Voice task captured. Review and save it."), "success");
    } catch (error) {
      console.error("Could not add task:", error);
      showVoiceStatus(error instanceof Error ? error.message : "Could not add task.", "error");
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await api.apiRequest(`/api/todo/tasks/${taskId}`, { method: "DELETE" });
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      renderTaskList();
    } catch (error) {
      console.error("Could not delete task:", error);
      showVoiceStatus(error instanceof Error ? error.message : "Could not delete task.", "error");
    }
  };

  const handleToggleTask = async (taskId, completed) => {
    try {
      const updated = await api.apiRequest(`/api/todo/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      state.tasks = state.tasks.map((task) => task.id === taskId ? updated : task);
      renderTaskList();
    } catch (error) {
      console.error("Could not toggle task:", error);
      showVoiceStatus(error instanceof Error ? error.message : "Could not update task.", "error");
    }
  };

  const handleEditTask = async (taskId) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextTitle = window.prompt("Edit task", task.title);
    if (nextTitle === null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed) {
      showVoiceStatus("Task title cannot be empty.", "error");
      return;
    }
    try {
      const updated = await api.apiRequest(`/api/todo/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      state.tasks = state.tasks.map((item) => item.id === taskId ? updated : item);
      renderTaskList();
    } catch (error) {
      console.error("Could not edit task:", error);
      showVoiceStatus(error instanceof Error ? error.message : "Could not update task.", "error");
    }
  };

  const initializeSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showVoiceStatus(getText("todo.voiceUnsupported", "Speech recognition is not supported in this browser."), "error");
      return null;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = (() => {
      const language = window.JalSaathiProfile?.getLanguage?.() || "en";
      const mapping = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN", ta: "ta-IN", ml: "ml-IN" };
      return mapping[language] || "en-IN";
    })();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ").trim();
      if (!transcript) return;
      const input = document.getElementById("task-input");
      if (input instanceof HTMLInputElement) {
        input.value = transcript;
      }
      showVoiceStatus(getText("todo.voiceCaptured", "Voice task captured. Review and save it."), "success");
    };
    recognition.onerror = (event) => {
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? getText("todo.voicePermissionDenied", "Microphone permission was denied. You can still type tasks manually.")
        : event.error === "no-speech"
          ? "No speech detected. Please try again."
          : `Voice recognition error: ${event.error}`;
      showVoiceStatus(message, "error");
    };
    return recognition;
  };

  const handleVoiceTask = async () => {
    const recognition = state.recognition || initializeSpeechRecognition();
    state.recognition = recognition;
    if (!recognition) return;
    showVoiceStatus(getText("todo.voiceListening", "Listening for your task…"));
    recognition.start();
  };

  const initializeTabs = () => {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.getAttribute("data-tab") || "today";
        document.querySelectorAll("[data-tab]").forEach((tab) => {
          const isActive = tab === button;
          tab.classList.toggle("is-active", isActive);
          tab.setAttribute("aria-selected", String(isActive));
        });
        renderTaskList();
      });
    });
  };

  const attachEvents = () => {
    document.getElementById("add-task-button")?.addEventListener("click", () => { void handleAddTask(); });
    document.getElementById("task-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleAddTask();
      }
    });
    document.getElementById("voice-button")?.addEventListener("click", () => { void handleVoiceTask(); });
    document.getElementById("reminder-toggle")?.addEventListener("click", async () => {
      const nextEnabled = !state.reminderSettings.enabled;
      if (nextEnabled && "Notification" in window && Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result !== "granted") {
          showVoiceStatus(getText("todo.notificationDenied", "Notification permission was denied. You can still use text tasks and review reminders later."), "warning");
          state.reminderSettings.enabled = false;
          renderReminderPanel();
          return;
        }
      }
      state.reminderSettings.enabled = nextEnabled;
      if (nextEnabled) {
        const hours = selectedIntervalHours();
        state.reminderSettings.interval_hours = hours;
        state.reminderSettings.custom_interval_hours = hours;
        state.reminderSettings.next_reminder_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      } else {
        state.reminderSettings.next_reminder_at = null;
      }
      try {
        const saved = await api.apiRequest("/api/todo/reminder-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: state.reminderSettings.enabled,
            interval_hours: state.reminderSettings.interval_hours || 2,
            custom_interval_hours: state.reminderSettings.custom_interval_hours,
            next_reminder_at: state.reminderSettings.next_reminder_at,
          }),
        });
        state.reminderSettings = saved || state.reminderSettings;
        renderReminderPanel();
        scheduleReminder();
      } catch (error) {
        console.error("Could not save reminder settings:", error);
      }
    });
    document.getElementById("reminder-interval")?.addEventListener("change", async () => {
      const select = document.getElementById("reminder-interval");
      const customWrap = document.getElementById("custom-interval-wrap");
      if (select instanceof HTMLSelectElement && customWrap instanceof HTMLElement) {
        customWrap.hidden = select.value !== "custom";
      }
      if (state.reminderSettings.enabled) {
        const hours = selectedIntervalHours();
        state.reminderSettings.interval_hours = hours;
        state.reminderSettings.custom_interval_hours = hours;
        state.reminderSettings.next_reminder_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        await saveReminderSettings({ enabled: true, interval_hours: hours, custom_interval_hours: hours });
      }
      renderReminderPanel();
    });
    document.getElementById("custom-interval")?.addEventListener("change", async () => {
      if (state.reminderSettings.enabled) {
        const hours = selectedIntervalHours();
        state.reminderSettings.interval_hours = hours;
        state.reminderSettings.custom_interval_hours = hours;
        state.reminderSettings.next_reminder_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        await saveReminderSettings({ enabled: true, interval_hours: hours, custom_interval_hours: hours });
      }
    });
    document.addEventListener("click", async (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("[data-action]");
      if (!(button instanceof HTMLElement)) return;
      const taskId = Number(button.closest("[data-task-id]")?.getAttribute("data-task-id"));
      if (Number.isNaN(taskId)) return;
      const action = button.getAttribute("data-action");
      if (action === "delete") await handleDeleteTask(taskId);
      if (action === "edit") await handleEditTask(taskId);
      if (action === "toggle") {
        const checkbox = button.closest(".task-item")?.querySelector(".task-check");
        if (checkbox instanceof HTMLInputElement) {
          await handleToggleTask(taskId, checkbox.checked);
        }
      }
    });
    document.querySelectorAll("[data-task-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-task-mode]").forEach((item) => item.classList.toggle("is-active", item === button));
        const mode = button.getAttribute("data-task-mode");
        const input = document.getElementById("task-input");
        if (mode === "voice" && input instanceof HTMLInputElement) {
          input.focus();
        }
      });
    });
    document.querySelector(".back-button")?.addEventListener("click", () => window.history.back());
  };

  const initialize = async () => {
    if (!api || !api.apiRequest) {
      console.error("JalSaathi profile store is not available for the daily to-do page.");
      return;
    }
    try {
      await api.refreshProfile();
    } catch (error) {
      console.warn("Could not refresh account profile for the page:", error);
    }
    initializeTabs();
    attachEvents();
    await loadTasks();
    await loadReminderSettings();
    if (window.JalSaathiI18n?.translate) {
      window.JalSaathiI18n.translate(document);
    }
    window.addEventListener("jalsaathi:language-changed", () => {
      window.JalSaathiI18n?.translate(document);
    });
  };

  document.addEventListener("DOMContentLoaded", () => { void initialize(); });
})();
