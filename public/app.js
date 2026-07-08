const state = {
  user: null,
  events: [],
  selectedDate: new Date().toISOString().slice(0, 10),
  authMode: "login"
};

const el = {
  authView: document.querySelector("#authView"),
  mainView: document.querySelector("#mainView"),
  authForm: document.querySelector("#authForm"),
  authSubmit: document.querySelector("#authSubmit"),
  authMessage: document.querySelector("#authMessage"),
  displayNameWrap: document.querySelector("#displayNameWrap"),
  displayName: document.querySelector("#displayName"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  tabs: document.querySelectorAll(".tab"),
  todayLabel: document.querySelector("#todayLabel"),
  datePicker: document.querySelector("#datePicker"),
  logoutButton: document.querySelector("#logoutButton"),
  userPill: document.querySelector("#userPill"),
  eventForm: document.querySelector("#eventForm"),
  eventId: document.querySelector("#eventId"),
  title: document.querySelector("#title"),
  start: document.querySelector("#start"),
  end: document.querySelector("#end"),
  category: document.querySelector("#category"),
  priority: document.querySelector("#priority"),
  notes: document.querySelector("#notes"),
  formTitle: document.querySelector("#formTitle"),
  cancelEdit: document.querySelector("#cancelEdit"),
  totalCount: document.querySelector("#totalCount"),
  doneCount: document.querySelector("#doneCount"),
  focusCount: document.querySelector("#focusCount"),
  refreshButton: document.querySelector("#refreshButton"),
  search: document.querySelector("#search"),
  statusFilter: document.querySelector("#statusFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  timeline: document.querySelector("#timeline"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.setTimeout(() => el.toast.classList.remove("show"), 1700);
}

function prettyDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function setAuthMode(mode) {
  state.authMode = mode;
  el.displayNameWrap.hidden = mode !== "register";
  el.authSubmit.textContent = mode === "register" ? "Create account" : "Sign in";
  el.password.autocomplete = mode === "register" ? "new-password" : "current-password";
  el.tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.mode === mode));
  el.authMessage.textContent = "";
}

function showMain(user) {
  state.user = user;
  el.authView.hidden = true;
  el.mainView.hidden = false;
  el.userPill.textContent = user.displayName;
  resetForm();
  loadEvents();
}

function showAuth() {
  state.user = null;
  state.events = [];
  el.authView.hidden = false;
  el.mainView.hidden = true;
}

function filteredEvents() {
  const query = el.search.value.trim().toLowerCase();
  return state.events.filter(event => {
    const matchesStatus =
      el.statusFilter.value === "all" ||
      (el.statusFilter.value === "done" && event.done) ||
      (el.statusFilter.value === "open" && !event.done);
    const matchesCategory =
      el.categoryFilter.value === "all" || event.category === el.categoryFilter.value;
    const haystack = `${event.title} ${event.notes} ${event.category} ${event.createdBy.displayName}`.toLowerCase();
    return matchesStatus && matchesCategory && haystack.includes(query);
  });
}

function render() {
  el.datePicker.value = state.selectedDate;
  el.todayLabel.textContent = prettyDate(state.selectedDate);

  const visible = filteredEvents();
  el.totalCount.textContent = state.events.length;
  el.doneCount.textContent = state.events.filter(event => event.done).length;
  el.focusCount.textContent = state.events.filter(event => event.priority === "High").length;

  el.timeline.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.events.length
      ? "No events match these filters."
      : "No shared events yet. Add the first one for everyone.";
    el.timeline.append(empty);
    return;
  }

  visible.forEach(event => {
    const isOwner = state.user && event.createdBy.id === state.user.id;
    const actions = isOwner
      ? `
        <button class="icon-btn" data-action="toggle" data-id="${event.id}">${event.done ? "Open" : "Done"}</button>
        <button class="icon-btn" data-action="edit" data-id="${event.id}">Edit</button>
        <button class="icon-btn" data-action="delete" data-id="${event.id}">Del</button>
      `
      : '<span class="owner-note">View only</span>';
    const card = document.createElement("article");
    card.className = "event-card";
    card.innerHTML = `
      <div class="event-time">${event.start}<br><span>${event.end}</span></div>
      <div class="event-main">
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(event.notes || "No notes added")}</p>
        <span class="meta">Created by ${escapeHtml(event.createdBy.displayName)}. Last updated by ${escapeHtml(event.updatedBy.displayName)}.</span>
        <div class="badges">
          <span class="badge">${escapeHtml(event.category)}</span>
          <span class="badge ${event.priority === "High" ? "high" : ""}">${escapeHtml(event.priority)}</span>
          ${event.done ? '<span class="badge done">Done</span>' : ""}
        </div>
      </div>
      <div class="event-actions">
        ${actions}
      </div>
    `;
    el.timeline.append(card);
  });
}

async function loadEvents() {
  try {
    const data = await api(`/api/events?date=${encodeURIComponent(state.selectedDate)}`);
    state.events = data.events;
    render();
  } catch (error) {
    showToast(error.message);
    if (error.message.includes("sign in")) showAuth();
  }
}

function resetForm() {
  el.eventForm.reset();
  el.eventId.value = "";
  el.start.value = "09:00";
  el.end.value = "10:00";
  el.formTitle.textContent = "Add event";
  el.cancelEdit.hidden = true;
}

function formPayload() {
  return {
    title: el.title.value.trim(),
    date: state.selectedDate,
    start: el.start.value,
    end: el.end.value,
    category: el.category.value,
    priority: el.priority.value,
    notes: el.notes.value.trim()
  };
}

el.tabs.forEach(tab => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
});

el.authForm.addEventListener("submit", async event => {
  event.preventDefault();
  el.authMessage.textContent = "";
  try {
    const payload = {
      username: el.username.value,
      password: el.password.value,
      displayName: el.displayName.value
    };
    const route = state.authMode === "register" ? "/api/register" : "/api/login";
    const data = await api(route, { method: "POST", body: JSON.stringify(payload) });
    el.authForm.reset();
    showMain(data.user);
  } catch (error) {
    el.authMessage.textContent = error.message;
  }
});

el.logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  showAuth();
});

el.eventForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (el.end.value <= el.start.value) {
    showToast("End time must be after start time.");
    return;
  }
  try {
    const id = el.eventId.value;
    await api(id ? `/api/events/${id}` : "/api/events", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(formPayload())
    });
    resetForm();
    await loadEvents();
    showToast(id ? "Event updated for everyone." : "Event added for everyone.");
  } catch (error) {
    showToast(error.message);
  }
});

el.timeline.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = state.events.find(entry => entry.id === button.dataset.id);
  if (!item) return;

  try {
    if (button.dataset.action === "toggle") {
      await api(`/api/events/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done })
      });
      await loadEvents();
    }

    if (button.dataset.action === "delete") {
      if (!confirm("Delete this event for everyone?")) return;
      await api(`/api/events/${item.id}`, { method: "DELETE" });
      await loadEvents();
      showToast("Event deleted for everyone.");
    }

    if (button.dataset.action === "edit") {
      el.eventId.value = item.id;
      el.title.value = item.title;
      el.start.value = item.start;
      el.end.value = item.end;
      el.category.value = item.category;
      el.priority.value = item.priority;
      el.notes.value = item.notes;
      el.formTitle.textContent = "Edit event";
      el.cancelEdit.hidden = false;
      el.title.focus();
    }
  } catch (error) {
    showToast(error.message);
  }
});

el.datePicker.addEventListener("change", () => {
  state.selectedDate = el.datePicker.value;
  resetForm();
  loadEvents();
});

[el.search, el.statusFilter, el.categoryFilter].forEach(control => {
  control.addEventListener("input", render);
});

el.refreshButton.addEventListener("click", loadEvents);
el.cancelEdit.addEventListener("click", resetForm);

async function boot() {
  setAuthMode("login");
  el.datePicker.value = state.selectedDate;
  resetForm();
  try {
    const data = await api("/api/me");
    if (data.user) {
      showMain(data.user);
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

boot();
