const state = {
  courses: [], assignments: [], notes: [], timers: new Map(), points: [],
  line: { slope: 1, intercept: 0 }, expression: "", buddyMessages: [],
  buddyImage: null, buddyImageUrls: new Set(), buddySending: false
};

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
let toastTimeout;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function handleError(error) {
  notify(error.message || "Something went wrong. Please try again.");
}

function formatTime(seconds) {
  const totalMinutes = Math.floor((Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(value) {
  if (!value) return "No due date";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueText(assignment) {
  if (!assignment.due_date) return "No due date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${assignment.due_date}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0 && assignment.status !== "Done") return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return formatDate(assignment.due_date);
}

function render() {
  renderCourses();
  renderAssignments();
  renderNotes();
  renderStats();
  renderCourseOptions();
}

function renderCourses() {
  const list = $("#course-list");
  $("#course-empty").classList.toggle("hidden", state.courses.length > 0);
  list.innerHTML = state.courses.map((course) => {
    const assignmentCount = state.assignments.filter((item) => item.course_id === course.id && item.status !== "Done").length;
    return `<div class="course-item">
      <span class="course-swatch" style="background:${escapeHTML(course.color)}"></span>
      <div class="course-info"><strong>${escapeHTML(course.name)}</strong><span>${escapeHTML([course.code, course.instructor].filter(Boolean).join(" · ") || "Course details not added")}</span></div>
      <div class="course-actions"><span>${assignmentCount} open</span><button class="course-remove" data-delete-course="${course.id}" aria-label="Delete ${escapeHTML(course.name)}">×</button></div>
    </div>`;
  }).join("");
}

function renderAssignments() {
  const list = $("#assignment-list");
  const tasks = state.assignments;
  $("#assignment-count").textContent = tasks.length;
  $("#assignment-empty").classList.toggle("hidden", tasks.length > 0);
  list.innerHTML = tasks.slice(0, 6).map((task) => {
    const running = state.timers.has(task.id);
    const due = dueText(task);
    return `<tr>
      <td><div class="assignment-title" title="${escapeHTML(task.title)}">${escapeHTML(task.title)}</div><div class="assignment-course">${escapeHTML(task.course_name || "Independent study")}${task.estimate ? ` · ${task.estimate} min planned` : ""}</div></td>
      <td class="${due === "Overdue" || due === "Today" ? "due-soon" : ""}">${escapeHTML(due)}</td>
      <td class="time-cell">${formatTime(task.seconds_spent)}<button class="timer-button ${running ? "running" : ""}" data-timer="${task.id}">${running ? "Pause" : "▶ Start"}</button></td>
      <td><select class="status-select" data-status="${escapeHTML(task.status)}" data-status-id="${task.id}" aria-label="Status for ${escapeHTML(task.title)}">
        ${["To do", "In progress", "Done"].map((status) => `<option ${task.status === status ? "selected" : ""}>${status}</option>`).join("")}
      </select></td>
      <td><button class="delete-button" data-delete-assignment="${task.id}" aria-label="Delete ${escapeHTML(task.title)}">×</button></td>
    </tr>`;
  }).join("");
  const openTasks = tasks.filter((task) => task.status !== "Done");
  $("#assignment-footer").textContent = openTasks.length ? `${openTasks.length} assignment${openTasks.length === 1 ? "" : "s"} still in progress` : "Nothing due just yet";
  $("#show-all").classList.toggle("hidden", tasks.length <= 6);
}

function renderNotes() {
  const list = $("#notes-list");
  $("#notes-empty").classList.toggle("hidden", state.notes.length > 0);
  list.innerHTML = state.notes.map((note) => `<article class="note-card">
    <div class="note-card-top"><strong>${escapeHTML(note.title)}</strong><div class="note-card-actions">
      <button data-edit-note="${note.id}">Edit</button><button data-delete-note="${note.id}">Delete</button>
    </div></div>
    ${note.course_name ? `<span class="note-course">${escapeHTML(note.course_name)}</span>` : ""}
    <p>${escapeHTML(note.content || "No note text yet.")}</p>
  </article>`).join("");
}

function renderStats() {
  const open = state.assignments.filter((task) => task.status !== "Done");
  const totalSeconds = state.assignments.reduce((sum, task) => sum + Number(task.seconds_spent || 0), 0);
  $("#stat-upcoming").textContent = open.length;
  $("#stat-time").textContent = formatTime(totalSeconds);
  $("#stat-courses").textContent = state.courses.length;
  $("#stat-completed").textContent = state.assignments.filter((task) => task.status === "Done").length;
}

function renderCourseOptions() {
  const options = state.courses.map((course) => `<option value="${course.id}">${escapeHTML(course.name)}</option>`).join("");
  $("#assignment-course").innerHTML = `<option value="">No course</option>${options}`;
  $("#note-course").innerHTML = `<option value="">General</option>${options}`;
}

async function refresh() {
  const data = await api("/api/data");
  state.courses = data.courses;
  state.assignments = data.assignments;
  state.notes = data.notes;
  render();
}

function showForm(kind, visible = true) {
  $(`#${kind}-form-wrap`).classList.toggle("hidden", !visible);
  if (visible) {
    const form = $(`#${kind}-form`);
    form.reset();
    form.querySelector("input")?.focus();
  }
}

function startTimer(taskId) {
  const timer = { elapsed: 0, timeout: null };
  const tick = async () => {
    if (!state.timers.has(taskId)) return;
    timer.elapsed += 1;
    if (timer.elapsed >= 15) {
      const chunk = timer.elapsed;
      timer.elapsed = 0;
      try {
        await api(`/api/assignments/${taskId}/time`, { method: "POST", body: JSON.stringify({ seconds: chunk }) });
        await refresh();
      } catch (error) {
        stopTimer(taskId);
        handleError(error);
        return;
      }
    }
    if (state.timers.has(taskId)) timer.timeout = setTimeout(tick, 1000);
  };
  timer.timeout = setTimeout(tick, 1000);
  state.timers.set(taskId, timer);
  renderAssignments();
}

async function stopTimer(taskId) {
  const timer = state.timers.get(taskId);
  if (!timer) return;
  clearTimeout(timer.timeout);
  state.timers.delete(taskId);
  renderAssignments();
  if (timer.elapsed > 0) {
    await api(`/api/assignments/${taskId}/time`, {
      method: "POST", body: JSON.stringify({ seconds: timer.elapsed })
    });
  }
  await refresh();
}

function tokenize(expression) {
  const normalized = expression.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\s+/g, "");
  const tokens = normalized.match(/(?:\d+\.?\d*|\.\d+)|[()+\-*/]/g) || [];
  if (tokens.join("") !== normalized || !tokens.length) throw new Error("Check your expression.");
  return tokens;
}

function calculate(expression) {
  const tokens = tokenize(expression);
  let position = 0;
  function primary() {
    const token = tokens[position++];
    if (token === "+" || token === "-") {
      const value = primary();
      return token === "-" ? -value : value;
    }
    if (token === "(") {
      const value = sum();
      if (tokens[position++] !== ")") throw new Error("Check your parentheses.");
      return value;
    }
    if (!token || !/^(?:\d+\.?\d*|\.\d+)$/.test(token)) throw new Error("Check your expression.");
    return Number(token);
  }
  function product() {
    let value = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const next = primary();
      if (operator === "/" && next === 0) throw new Error("Cannot divide by zero.");
      value = operator === "*" ? value * next : value / next;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const next = product();
      value = operator === "+" ? value + next : value - next;
    }
    return value;
  }
  const result = sum();
  if (position !== tokens.length || !Number.isFinite(result)) throw new Error("Check your expression.");
  return Number(result.toPrecision(10));
}

function calculateDisplay() {
  $("#calc-expression").textContent = state.expression || "Ready when you are";
  if (!state.expression) {
    $("#calc-result").textContent = "0";
    return;
  }
  try {
    $("#calc-result").textContent = String(calculate(state.expression));
  } catch {
    $("#calc-result").textContent = "…";
  }
}

function drawGraph() {
  const canvas = $("#graph-canvas");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  const width = rect.width;
  const height = rect.height;
  const range = 5;
  const originX = width / 2;
  const originY = height / 2;
  const unit = Math.min((width - 34) / (range * 2), (height - 30) / (range * 2));
  context.clearRect(0, 0, width, height);
  context.font = '9px "DM Sans", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let n = -range; n <= range; n += 1) {
    const x = originX + n * unit;
    const y = originY - n * unit;
    context.beginPath();
    context.strokeStyle = n === 0 ? "#a8a8ba" : "#eeeef4";
    context.lineWidth = n === 0 ? 1.3 : 1;
    context.moveTo(x, 10); context.lineTo(x, height - 10);
    context.moveTo(10, y); context.lineTo(width - 10, y);
    context.stroke();
    if (n !== 0) {
      context.fillStyle = "#a0a0b1";
      context.fillText(String(n), x, originY + 11);
      context.fillText(String(n), originX - 11, y);
    }
  }
  context.fillStyle = "#77778b";
  context.textAlign = "right"; context.fillText("x", width - 10, originY - 10);
  context.textAlign = "left"; context.fillText("y", originX + 9, 10);
  if (state.line) {
    context.beginPath();
    context.strokeStyle = "#7567e8";
    context.lineWidth = 2;
    const leftX = -range, rightX = range;
    context.moveTo(originX + leftX * unit, originY - (state.line.slope * leftX + state.line.intercept) * unit);
    context.lineTo(originX + rightX * unit, originY - (state.line.slope * rightX + state.line.intercept) * unit);
    context.stroke();
  }
  state.points.forEach(({ x, y }) => {
    const px = originX + x * unit, py = originY - y * unit;
    context.beginPath(); context.arc(px, py, 4, 0, Math.PI * 2);
    context.fillStyle = "#e9a16d"; context.fill();
    context.strokeStyle = "#fff"; context.lineWidth = 1.5; context.stroke();
    context.fillStyle = "#936b4d"; context.textAlign = "left";
    context.fillText(`(${x}, ${y})`, px + 7, py - 8);
  });
}

function renderBuddyMessages() {
  const hasMessages = state.buddyMessages.length > 0;
  $("#buddy-intro").classList.toggle("hidden", hasMessages);
  $("#buddy-messages").classList.toggle("hidden", !hasMessages);
  $("#buddy-messages").innerHTML = state.buddyMessages.map((message) => `
    <div class="buddy-message ${message.role === "user" ? "user" : "assistant"}">
      <span class="buddy-message-avatar">${message.role === "user" ? "S" : "✳"}</span>
      <div class="buddy-message-body">
        ${message.imageUrl ? `<img src="${escapeHTML(message.imageUrl)}" alt="Image shared with Buddy">` : ""}
        <div class="buddy-message-text">${escapeHTML(message.content)}</div>
      </div>
    </div>`).join("");
  if (hasMessages) $("#buddy-messages").scrollTop = $("#buddy-messages").scrollHeight;
}

function clearBuddyImage(revoke = true) {
  if (state.buddyImage && revoke) {
    URL.revokeObjectURL(state.buddyImage.previewUrl);
    state.buddyImageUrls.delete(state.buddyImage.previewUrl);
  }
  state.buddyImage = null;
  $("#buddy-image-preview").classList.add("hidden");
  $("#buddy-image-input").value = "";
}

function setBuddyImage(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    notify("Choose a PNG or JPEG image.");
    $("#buddy-image-input").value = "";
    return;
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    notify("Images must be between 1 byte and 5 MB.");
    $("#buddy-image-input").value = "";
    return;
  }
  clearBuddyImage();
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result !== "string") {
      notify("That image could not be read. Try a different file.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    state.buddyImageUrls.add(previewUrl);
    state.buddyImage = { file, dataUrl: reader.result, previewUrl };
    $("#buddy-preview-image").src = previewUrl;
    $("#buddy-image-name").textContent = file.name;
    $("#buddy-image-preview").classList.remove("hidden");
    $("#buddy-question").focus();
  });
  reader.addEventListener("error", () => notify("That image could not be read. Try a different file."));
  reader.readAsDataURL(file);
}

async function sendBuddyMessage(event) {
  event.preventDefault();
  if (state.buddySending) return;
  const question = $("#buddy-question").value.trim();
  if (!question && !state.buddyImage) {
    $("#buddy-question").focus();
    return;
  }
  const content = question || "Please help me understand this image.";
  const currentImage = state.buddyImage;
  const userMessage = {
    role: "user",
    content,
    imageUrl: currentImage?.previewUrl || null
  };
  state.buddyMessages.push(userMessage);
  renderBuddyMessages();
  state.buddySending = true;
  $("#buddy-typing").classList.remove("hidden");
  $("#buddy-send-button").disabled = true;
  $("#buddy-image-input").disabled = true;
  try {
    const history = state.buddyMessages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-20)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    const image = currentImage ? {
      mime_type: currentImage.file.type,
      data: currentImage.dataUrl.split(",", 2)[1]
    } : null;
    const result = await api("/api/buddy/chat", {
      method: "POST",
      body: JSON.stringify({ messages: history, image })
    });
    state.buddyMessages.push({ role: "assistant", content: result.reply });
    $("#buddy-question").value = "";
    $("#buddy-question").style.height = "auto";
    if (currentImage) clearBuddyImage(false);
    renderBuddyMessages();
  } catch (error) {
    state.buddyMessages.pop();
    renderBuddyMessages();
    handleError(error);
  } finally {
    state.buddySending = false;
    $("#buddy-typing").classList.add("hidden");
    $("#buddy-send-button").disabled = false;
    $("#buddy-image-input").disabled = false;
    $("#buddy-question").focus();
  }
}

function activateView(viewName) {
  const views = ["overview", "assignments", "courses", "notes", "calculator", "graph", "buddy"];
  const view = views.includes(viewName) ? viewName : "overview";
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
    section.setAttribute("aria-hidden", String(section.dataset.view !== view));
  });
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const active = link.dataset.viewLink === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const titles = {
    overview: "Overview",
    assignments: "Assignments",
    courses: "My courses",
    notes: "Notes",
    calculator: "Calculator",
    graph: "Graph",
    buddy: "Buddy"
  };
  $("#page-title").textContent = titles[view];
  if (view === "graph") drawGraph();
  window.scrollTo(0, 0);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  activateView(window.location.hash.slice(1));
  window.addEventListener("hashchange", () => activateView(window.location.hash.slice(1)));
  try {
    await refresh();
  } catch (error) {
    handleError(error);
  }

  $("#open-assignment-form").addEventListener("click", () => showForm("assignment"));
  $("#add-assignment-shortcut").addEventListener("click", () => {
    if (window.location.hash !== "#assignments") window.location.hash = "#assignments";
    activateView("assignments");
    showForm("assignment");
    $("#assignments").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#open-course-form").addEventListener("click", () => showForm("course"));
  $("#open-note-form").addEventListener("click", () => showForm("note"));
  document.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", () => showForm(button.dataset.cancel, false)));

  $("#assignment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/api/assignments", { method: "POST", body: JSON.stringify(data) });
      showForm("assignment", false);
      await refresh();
      notify("Assignment added to your planner.");
    } catch (error) { handleError(error); }
  });

  $("#course-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/api/courses", { method: "POST", body: JSON.stringify(data) });
      showForm("course", false);
      await refresh();
      notify("Course saved.");
    } catch (error) { handleError(error); }
  });

  $("#note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const editing = form.dataset.editId;
    try {
      await api(editing ? `/api/notes/${editing}` : "/api/notes", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(data)
      });
      delete form.dataset.editId;
      showForm("note", false);
      await refresh();
      notify(editing ? "Note updated." : "Note saved.");
    } catch (error) { handleError(error); }
  });

  document.body.addEventListener("click", async (event) => {
    const timer = event.target.closest("[data-timer]");
    const removeAssignment = event.target.closest("[data-delete-assignment]");
    const removeCourse = event.target.closest("[data-delete-course]");
    const removeNote = event.target.closest("[data-delete-note]");
    const editNote = event.target.closest("[data-edit-note]");
    try {
      if (timer) {
        const taskId = Number(timer.dataset.timer);
        if (state.timers.has(taskId)) await stopTimer(taskId);
        else startTimer(taskId);
      } else if (removeAssignment) {
        await api(`/api/assignments/${removeAssignment.dataset.deleteAssignment}`, { method: "DELETE" });
        await refresh(); notify("Assignment removed.");
      } else if (removeCourse) {
        const course = state.courses.find((item) => item.id === Number(removeCourse.dataset.deleteCourse));
        if (course && confirm(`Delete ${course.name}? Its assignments and notes will stay, but become unassigned.`)) {
          await api(`/api/courses/${course.id}`, { method: "DELETE" });
          await refresh(); notify("Course removed.");
        }
      } else if (removeNote) {
        await api(`/api/notes/${removeNote.dataset.deleteNote}`, { method: "DELETE" });
        await refresh(); notify("Note deleted.");
      } else if (editNote) {
        const note = state.notes.find((item) => item.id === Number(editNote.dataset.editNote));
        if (note) {
          showForm("note");
          const form = $("#note-form");
          form.dataset.editId = note.id;
          form.elements.title.value = note.title;
          form.elements.content.value = note.content;
          form.elements.course_id.value = note.course_id || "";
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    } catch (error) { handleError(error); }
  });

  document.body.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-status-id]");
    if (!select) return;
    try {
      await api(`/api/assignments/${select.dataset.statusId}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
      await refresh();
    } catch (error) { handleError(error); }
  });

  $("#calc-keys").addEventListener("click", (event) => {
    const key = event.target.closest("[data-value]")?.dataset.value;
    if (!key) return;
    if (key === "clear") state.expression = "";
    else if (key === "back") state.expression = state.expression.slice(0, -1);
    else if (key === "=") {
      try {
        const result = calculate(state.expression);
        $("#calc-expression").textContent = `${state.expression} =`;
        state.expression = String(result);
      } catch (error) {
        $("#calc-result").textContent = error.message;
        return;
      }
    } else state.expression += key;
    calculateDisplay();
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (/^[0-9.+\-*/()]$/.test(event.key)) {
      state.expression += event.key; calculateDisplay();
    } else if (event.key === "Enter" || event.key === "=") {
      try {
        const result = calculate(state.expression);
        $("#calc-expression").textContent = `${state.expression} =`;
        state.expression = String(result);
        calculateDisplay();
      } catch (error) { $("#calc-result").textContent = error.message; }
    } else if (event.key === "Backspace") {
      state.expression = state.expression.slice(0, -1); calculateDisplay();
    } else if (event.key === "Escape") {
      state.expression = ""; calculateDisplay();
    }
  });

  $("#point-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const point = { x: Number(data.get("x")), y: Number(data.get("y")) };
    if (Math.abs(point.x) > 5 || Math.abs(point.y) > 5) return notify("Keep points between −5 and 5 to fit the graph.");
    state.points.push(point); drawGraph();
  });
  $("#line-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const slope = Number(data.get("slope")), intercept = Number(data.get("intercept"));
    if (Math.abs(slope) > 10 || Math.abs(intercept) > 10) return notify("Use a slope and intercept between −10 and 10.");
    state.line = { slope, intercept }; drawGraph();
  });
  $("#clear-graph").addEventListener("click", () => {
    state.points = []; state.line = null; drawGraph();
  });
  $("#buddy-form").addEventListener("submit", sendBuddyMessage);
  $("#buddy-image-input").addEventListener("change", (event) => setBuddyImage(event.target.files?.[0]));
  $("#remove-buddy-image").addEventListener("click", () => clearBuddyImage());
  $("#buddy-question").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 150)}px`;
  });
  $("#buddy-question").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("#buddy-form").requestSubmit();
    }
  });
  document.querySelectorAll("[data-buddy-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#buddy-question").value = button.dataset.buddyPrompt;
      $("#buddy-form").requestSubmit();
    });
  });
  window.addEventListener("beforeunload", () => {
    state.buddyImageUrls.forEach((url) => URL.revokeObjectURL(url));
  });
  window.addEventListener("resize", drawGraph);
  if (window.location.hash === "#graph") drawGraph();
});
