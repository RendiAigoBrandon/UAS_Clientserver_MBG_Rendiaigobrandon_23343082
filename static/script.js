const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || "";

const TRASH_ICON_HTML = `
  <svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 3.75A1.75 1.75 0 0 1 10.75 2h2.5A1.75 1.75 0 0 1 15 3.75V5h4a1 1 0 1 1 0 2h-.72l-.78 11.17A3 3 0 0 1 14.51 21H9.49a3 3 0 0 1-2.99-2.83L5.72 7H5a1 1 0 0 1 0-2h4V3.75ZM11 5h2v-.75h-2V5Zm-3.27 2 .77 11.03c.04.55.5.97 1 .97h5.01c.51 0 .96-.42 1-.97L16.28 7H7.73ZM10 9a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z"/>
  </svg>`;


const BOOK_OPEN_SOUND_SRC = "/static/sounds/book-open.mp3";
const BOOK_SOUND_VOLUME = 0.35;
let bookOpenSound = null;
let lastBookSoundAt = 0;

function getBookOpenSound() {
  if (!bookOpenSound) {
    bookOpenSound = new Audio(BOOK_OPEN_SOUND_SRC);
    bookOpenSound.preload = "auto";
    bookOpenSound.volume = BOOK_SOUND_VOLUME;
  }
  return bookOpenSound;
}

function playBookOpenSound() {
  try {
    const soundEnabled = localStorage.getItem("mbgSoundEnabled");
    if (soundEnabled === "false") return;

    const now = Date.now();
    if (now - lastBookSoundAt < 180) return;
    lastBookSoundAt = now;

    const audio = getBookOpenSound();
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch (error) {
    console.warn("Suara buku tidak bisa diputar:", error);
  }
}


const sidebarToggle = document.getElementById("sidebarToggle");
const sidePanel = document.getElementById("sidePanel");
const noteForm = document.getElementById("noteForm");
const composerCard = document.getElementById("composerCard");
const composerPrompt = document.getElementById("composerPrompt");
const titleInput = document.getElementById("title");
const contentInput = document.getElementById("content");
const tagsInput = document.getElementById("tags");
const deadlineInput = document.getElementById("deadline");
const favoriteInput = document.getElementById("favorite");
const resetButton = document.getElementById("resetButton");
const notesList = document.getElementById("notesList");
const messageBox = document.getElementById("message");
const noteCount = document.getElementById("noteCount");
const allCount = document.getElementById("allCount");
const favoriteCount = document.getElementById("favoriteCount");
const labelCount = document.getElementById("labelCount");
const labelSummaryCount = document.getElementById("labelSummaryCount");
const labelFilterList = document.getElementById("labelFilterList");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const activeViewLabel = document.getElementById("activeViewLabel");
const sideItems = document.querySelectorAll("[data-view]");
const labelSummaryButton = document.getElementById("labelSummaryButton");

const noteModal = document.getElementById("noteModal");
const modalReadView = document.getElementById("modalReadView");
const modalEditView = document.getElementById("modalEditView");
const readTitle = document.getElementById("readTitle");
const readContent = document.getElementById("readContent");
const readLabels = document.getElementById("readLabels");
const readDeadline = document.getElementById("readDeadline");
const readCreatedAt = document.getElementById("readCreatedAt");
const readUpdatedAt = document.getElementById("readUpdatedAt");
const readFavoriteButton = document.getElementById("readFavoriteButton");
const readEditButton = document.getElementById("readEditButton");
const readDeleteButton = document.getElementById("readDeleteButton");
const readCloseButton = document.getElementById("readCloseButton");
const modalForm = document.getElementById("modalForm");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const modalTags = document.getElementById("modalTags");
const modalDeadline = document.getElementById("modalDeadline");
const modalFavorite = document.getElementById("modalFavorite");
const modalCreatedAt = document.getElementById("modalCreatedAt");
const modalUpdatedAt = document.getElementById("modalUpdatedAt");
const modalMessage = document.getElementById("modalMessage");
const modalDeleteButton = document.getElementById("modalDeleteButton");
const modalCancelButton = document.getElementById("modalCancelButton");
const modalCloseButton = document.getElementById("modalCloseButton");

let activeNote = null;
let modalMode = "read";
let allNotes = [];
let filteredNotes = [];
let currentSearchQuery = "";
let currentSortOption = "manual";
let currentView = { type: "all", label: "" };
let messageTimer = null;
let modalMessageTimer = null;
let isDraggingNote = false;
let dragState = null;
const composerContentMaxHeight = 280;
const masonryResizeObserver = "ResizeObserver" in window
  ? new ResizeObserver(() => syncMasonryLayout())
  : null;

function showMessage(text, type = "success", target = messageBox) {
  const isModalMessage = target === modalMessage;
  clearTimeout(isModalMessage ? modalMessageTimer : messageTimer);

  target.textContent = text;
  target.className = isModalMessage ? `message modal-message ${type}` : `message toast ${type}`;

  const timer = setTimeout(() => {
    target.textContent = "";
    target.className = isModalMessage ? "message modal-message" : "message toast";
  }, 3200);

  if (isModalMessage) {
    modalMessageTimer = timer;
  } else {
    messageTimer = timer;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(value) {
  const safeText = escapeHtml(value);
  const keyword = currentSearchQuery.trim();

  if (!keyword) return safeText;

  const pattern = new RegExp(`(${escapeRegExp(keyword)})`, "gi");
  return safeText.replace(pattern, '<mark class="highlight">$1</mark>');
}

function parseLabels(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();

  return source
    .map((label) => String(label).trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getNoteLabels(note) {
  return parseLabels(note.labels || note.tags || []);
}

function labelsToText(labels) {
  return parseLabels(labels).join(", ");
}

function normalizeNote(note) {
  return {
    ...note,
    order: Number.isFinite(Number(note.order)) ? Number(note.order) : 0,
    labels: getNoteLabels(note)
  };
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getDeadlineTone(deadline) {
  if (!deadline) return "deadline-default";

  const targetDate = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(targetDate.getTime())) return "deadline-default";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((targetDate - today) / 86400000);

  if (diffDays < 0) return "deadline-late";
  if (diffDays <= 3) return "deadline-soon";
  return "deadline-safe";
}

function getNotePayload({ title, content, labels, favorite, deadline }) {
  const cleanLabels = parseLabels(labels);
  return {
    title: title.trim(),
    content: content.trim(),
    labels: cleanLabels,
    tags: cleanLabels,
    favorite: Boolean(favorite),
    deadline: deadline || ""
  };
}

function expandComposer(focusTitle = false) {
  const wasCollapsed = composerCard.classList.contains("collapsed");

  if (wasCollapsed) {
    playBookOpenSound();
  }

  composerCard.classList.remove("collapsed");
  composerCard.classList.add("expanded");
  composerPrompt.setAttribute("aria-hidden", "true");
  resizeComposerContent();

  if (focusTitle && wasCollapsed) {
    setTimeout(() => titleInput.focus(), 0);
  }
}

function composerHasDraft() {
  return [
    titleInput.value,
    contentInput.value,
    tagsInput.value,
    deadlineInput.value
  ].some((value) => String(value || "").trim()) || favoriteInput.checked;
}

function collapseComposer(force = false, keepDraft = false) {
  const hasContent = composerHasDraft();

  if (hasContent && !force && !keepDraft) return;

  if (!keepDraft) {
    noteForm.reset();
    contentInput.style.height = "";
    contentInput.style.overflowY = "hidden";
  }

  composerCard.classList.add("collapsed");
  composerCard.classList.remove("expanded");
  composerPrompt.removeAttribute("aria-hidden");
}

function collapseComposerFromOutside() {
  if (!composerCard.classList.contains("expanded")) return;
  if (composerHasDraft()) return;
  collapseComposer(true);
}

function resizeComposerContent() {
  if (composerCard.classList.contains("collapsed")) return;

  contentInput.style.height = "auto";
  const nextHeight = Math.min(contentInput.scrollHeight, composerContentMaxHeight);
  contentInput.style.height = `${Math.max(nextHeight, 64)}px`;
  contentInput.style.overflowY = contentInput.scrollHeight > composerContentMaxHeight ? "auto" : "hidden";
}

async function fetchJson(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (["POST", "PUT", "DELETE"].includes(method)) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(url, { ...options, method, headers });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = { message: "Server tidak mengirim response JSON." };
  }

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Sesi login habis. Silakan login kembali.");
  }

  if (!response.ok) {
    throw new Error(data.message || "Terjadi kesalahan pada server.");
  }

  return data;
}

async function loadNotes() {
  notesList.classList.add("is-empty");
  notesList.innerHTML = `
    <div class="empty-state loading-state">
      <div class="empty-icon" aria-hidden="true">...</div>
      <strong>Memuat catatan...</strong>
    </div>
  `;

  try {
    const result = await fetchJson("/api/notes");
    allNotes = (result.data || []).map(normalizeNote);
    renderSidebarLabels();
    filterNotes();
  } catch (error) {
    showMessage(error.message, "error");
    notesList.classList.add("is-empty");
    notesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">!</div>
        <strong>Gagal memuat catatan.</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

function getLabels() {
  const labelMap = new Map();

  allNotes.forEach((note) => {
    getNoteLabels(note).forEach((label) => {
      const key = label.toLowerCase();
      if (!labelMap.has(key)) {
        labelMap.set(key, { name: label, count: 0 });
      }
      labelMap.get(key).count += 1;
    });
  });

  return Array.from(labelMap.values()).sort((a, b) => a.name.localeCompare(b.name, "id"));
}

function renderSidebarLabels() {
  const labels = getLabels();
  labelCount.textContent = labels.length;
  if (labelSummaryCount) labelSummaryCount.textContent = labels.length;

  if (labels.length === 0) {
    labelFilterList.innerHTML = '<div class="empty-label">Belum ada label.</div>';
    return;
  }

  labelFilterList.innerHTML = labels.map((label) => {
    const isActive = currentView.type === "label" && currentView.label.toLowerCase() === label.name.toLowerCase();
    return `
      <button type="button" class="side-item label-item ${isActive ? "active" : ""}" data-label="${escapeHtml(label.name)}" title="${escapeHtml(label.name)}">
        <span class="side-icon" aria-hidden="true">#</span>
        <span class="side-text">${escapeHtml(label.name)}</span>
        <b>${label.count}</b>
      </button>
    `;
  }).join("");

  labelFilterList.querySelectorAll("[data-label]").forEach((button) => {
    button.addEventListener("click", () => filterByLabel(button.dataset.label));
  });
}

function updateCounts() {
  allCount.textContent = allNotes.length;
  favoriteCount.textContent = allNotes.filter((note) => note.favorite).length;
  noteCount.textContent = `${filteredNotes.length} catatan`;
}

function setView(type, label = "") {
  currentView = { type, label };

  sideItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === type);
  });

  renderSidebarLabels();
  filterNotes();
}

function filterByLabel(label) {
  setView("label", label);
  closeSidebarOnMobile();
}

function matchesView(note) {
  if (currentView.type === "favorite") {
    return Boolean(note.favorite);
  }

  if (currentView.type === "label") {
    return getNoteLabels(note).some((label) => label.toLowerCase() === currentView.label.toLowerCase());
  }

  return true;
}

function setActiveViewLabel() {
  if (currentView.type === "favorite") {
    activeViewLabel.textContent = "Catatan Favorit";
  } else if (currentView.type === "label") {
    activeViewLabel.textContent = `Label: ${currentView.label}`;
  } else {
    activeViewLabel.textContent = "Semua Catatan";
  }
}

function filterNotes() {
  currentSearchQuery = searchInput.value.trim().toLowerCase();

  filteredNotes = allNotes.filter((note) => {
    const searchableText = [
      note.title,
      note.content,
      getNoteLabels(note).join(" "),
      note.deadline,
      note.favorite ? "favorite favorit bintang" : ""
    ].join(" ").toLowerCase();

    const matchesSearch = !currentSearchQuery || searchableText.includes(currentSearchQuery);
    return matchesView(note) && matchesSearch;
  });

  setActiveViewLabel();
  sortNotes(sortSelect.value);
}

function sortNotes(option = currentSortOption) {
  currentSortOption = option;

  filteredNotes.sort((a, b) => {
    if (currentSortOption === "manual") {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    }

    if (currentSortOption === "updated_desc") {
      return new Date(b.updated_at) - new Date(a.updated_at);
    }

    if (currentSortOption === "title_asc") {
      return String(a.title || "").localeCompare(String(b.title || ""), "id");
    }

    return new Date(b.created_at) - new Date(a.created_at);
  });

  renderNotes(filteredNotes);
  updateCounts();
}

function renderTagBadges(labels, highlight = true) {
  const cleanLabels = parseLabels(labels);

  if (cleanLabels.length === 0) {
    return '<span class="muted-badge">Tanpa label</span>';
  }

  return cleanLabels
    .map((label) => `<span class="tag-badge">${highlight ? highlightText(label) : escapeHtml(label)}</span>`)
    .join("");
}

function renderMetaBadges(note, highlight = true) {
  const favoriteBadge = note.favorite ? '<span class="favorite-badge">&#9733; Favorit</span>' : "";
  const deadlineBadge = note.deadline
    ? `<span class="deadline-badge ${getDeadlineTone(note.deadline)}">Deadline: ${highlight ? highlightText(note.deadline) : escapeHtml(note.deadline)}</span>`
    : '<span class="muted-badge">Tanpa deadline</span>';

  return `${favoriteBadge}${deadlineBadge}`;
}

function renderNotes(notes) {
  if (notes.length === 0) {
    notesList.classList.add("is-empty");
    const isSearching = Boolean(currentSearchQuery);
    const message = isSearching
      ? "Coba gunakan kata kunci, label, atau deadline lain."
      : currentView.type === "favorite"
        ? "Belum ada catatan favorit. Klik bintang pada card untuk menandainya."
        : currentView.type === "label"
          ? "Belum ada catatan di label ini."
          : "Tambahkan catatan belajar pertamamu.";

    notesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">${isSearching ? "&#8981;" : "+"}</div>
        <strong>${isSearching ? "Catatan tidak ditemukan." : "Belum ada catatan."}</strong>
        <span>${message}</span>
      </div>
    `;
    return;
  }

  notesList.classList.remove("is-empty");
  notesList.innerHTML = notes.map((note) => `
    <article class="note-card" draggable="false" data-note-id="${escapeHtml(note.id)}" tabindex="0" role="button" aria-label="Buka detail ${escapeHtml(note.title)}">
      <div class="note-body">
        <div class="note-top">
          <h3>${highlightText(note.title)}</h3>
          ${note.favorite ? '<span class="card-star" aria-label="Favorit">&#9733;</span>' : ""}
        </div>
        <p class="note-preview">${highlightText(note.content)}</p>
        <div class="card-badges">
          ${renderTagBadges(note.labels)}
          ${renderMetaBadges(note)}
        </div>
      </div>
      <div class="card-actions" aria-label="Aksi catatan">
        <button class="card-action" type="button" data-action="edit" data-id="${escapeHtml(note.id)}" title="Edit">&#9998;</button>
        <button class="card-action ${note.favorite ? "active" : ""}" type="button" data-action="favorite" data-id="${escapeHtml(note.id)}" title="Favorit">${note.favorite ? "&#9733;" : "&#9734;"}</button>
        <button class="card-action" type="button" data-action="label" data-id="${escapeHtml(note.id)}" title="Label">#</button>
        <button class="card-action" type="button" data-action="deadline" data-id="${escapeHtml(note.id)}" title="Deadline">&#8986;</button>
        <button class="card-action danger" type="button" data-action="delete" data-id="${escapeHtml(note.id)}" title="Hapus" aria-label="Hapus catatan">${TRASH_ICON_HTML}</button>
      </div>
      <div class="note-meta">
        <span>Dibuat: ${escapeHtml(formatDateTime(note.created_at))}</span>
        <span>Diperbarui: ${escapeHtml(formatDateTime(note.updated_at))}</span>
      </div>
    </article>
  `).join("");

  syncMasonryLayout();

  notesList.querySelectorAll(".note-card").forEach((card) => {
    const selectedNote = allNotes.find((note) => note.id === card.dataset.noteId);

    card.addEventListener("click", () => {
      if (isDraggingNote) return;
      if (selectedNote) openNoteModal(selectedNote);
    });

    card.addEventListener("keydown", (event) => {
      if (!isDraggingNote && (event.key === "Enter" || event.key === " ") && selectedNote) {
        event.preventDefault();
        openNoteModal(selectedNote);
      }
    });
  });

  notesList.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const selectedNote = allNotes.find((note) => note.id === button.dataset.id);
      if (!selectedNote) return;

      if (button.dataset.action === "favorite") toggleFavorite(selectedNote);
      if (button.dataset.action === "edit") openNoteModal(selectedNote, "edit");
      if (button.dataset.action === "delete") deleteNote(selectedNote);
      if (button.dataset.action === "label") openNoteModal(selectedNote, "label");
      if (button.dataset.action === "deadline") openNoteModal(selectedNote, "deadline");
    });
  });

  setupDragAndDrop();
  observeMasonryCards();
}

function syncMasonryLayout() {
  if (!notesList || notesList.classList.contains("is-empty")) return;

  const styles = window.getComputedStyle(notesList);
  const rowHeight = parseFloat(styles.gridAutoRows) || 8;
  const rowGap = parseFloat(styles.rowGap) || 22;
  const items = notesList.querySelectorAll(".note-card:not(.dragging), .note-drop-placeholder");

  items.forEach((item) => {
    item.style.gridRowEnd = "auto";
  });

  items.forEach((item) => {
    const height = item.getBoundingClientRect().height;
    const span = Math.ceil((height + rowGap) / (rowHeight + rowGap));
    item.style.gridRowEnd = `span ${Math.max(span, 1)}`;
  });
}

function observeMasonryCards() {
  if (!masonryResizeObserver) return;

  masonryResizeObserver.disconnect();
  notesList.querySelectorAll(".note-card").forEach((card) => {
    masonryResizeObserver.observe(card);
  });
}

async function saveManualOrder() {
  const ids = [...notesList.querySelectorAll(".note-card")].map((card) => card.dataset.noteId);
  if (!ids.length) return;

  ids.forEach((id, index) => {
    const note = allNotes.find((item) => item.id === id);
    if (note) note.order = index;
  });

  currentSortOption = "manual";
  sortSelect.value = "manual";

  try {
    await fetchJson("/api/notes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ids })
    });
    showMessage("Urutan catatan berhasil disimpan.", "success");
  } catch (error) {
    showMessage(error.message, "error");
    loadNotes();
  }
}

function setupDragAndDrop() {
  const cards = notesList.querySelectorAll(".note-card");

  cards.forEach((card) => {
    card.addEventListener("dragstart", (event) => event.preventDefault());
  });

  if (notesList.dataset.dragReady === "true") return;
  notesList.dataset.dragReady = "true";

  notesList.addEventListener("pointerdown", handleNotePointerDown);
  window.addEventListener("pointermove", handleNotePointerMove);
  window.addEventListener("pointerup", finishNoteDrag);
  window.addEventListener("pointercancel", cancelNoteDrag);
}

function isInteractiveDragTarget(target) {
  return Boolean(target.closest("button, a, input, textarea, select, label, .card-actions"));
}

function getNoteRects() {
  return [...notesList.querySelectorAll(".note-card:not(.dragging)")].map((card) => ({
    card,
    rect: card.getBoundingClientRect()
  }));
}

function animateNoteReorder(previousRects) {
  getNoteRects().forEach(({ card, rect }) => {
    const previousRect = previousRects.get(card);
    if (!previousRect) return;

    const deltaX = previousRect.left - rect.left;
    const deltaY = previousRect.top - rect.top;
    if (!deltaX && !deltaY) return;

    card.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: "translate(0, 0)" }
      ],
      { duration: 210, easing: "cubic-bezier(.2, 0, .2, 1)" }
    );
  });
}

function getDropTarget(x, y) {
  const items = [...notesList.querySelectorAll(".note-card:not(.dragging)")];
  if (!items.length) return { element: null, before: false };

  let closest = { element: null, before: false, distance: Number.POSITIVE_INFINITY };

  items.forEach((card) => {
    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const normalizedX = (x - centerX) / Math.max(rect.width, 1);
    const normalizedY = (y - centerY) / Math.max(rect.height, 1);
    const distance = Math.hypot(normalizedX, normalizedY);

    if (distance < closest.distance) {
      closest = {
        element: card,
        before: y < centerY || (Math.abs(y - centerY) < rect.height * 0.35 && x < centerX),
        distance
      };
    }
  });

  return closest;
}

function movePlaceholder(x, y) {
  if (!dragState) return;

  const target = getDropTarget(x, y);
  const placeholder = dragState.placeholder;
  const previousRects = new Map(getNoteRects().map(({ card, rect }) => [card, rect]));

  if (!target.element) {
    notesList.appendChild(placeholder);
  } else if (target.before) {
    notesList.insertBefore(placeholder, target.element);
  } else {
    notesList.insertBefore(placeholder, target.element.nextElementSibling);
  }

  syncMasonryLayout();
  animateNoteReorder(previousRects);
}

function beginNoteDrag(event) {
  if (!dragState || dragState.started) return;

  const card = dragState.card;
  const rect = dragState.initialRect;
  const placeholder = document.createElement("div");
  placeholder.className = "note-drop-placeholder";
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;

  card.parentNode.insertBefore(placeholder, card);
  card.classList.add("dragging");
  notesList.classList.add("drag-active");
  document.body.classList.add("is-note-dragging");

  Object.assign(card.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: "1000",
    pointerEvents: "none",
    transform: "translate3d(0, 0, 0)"
  });

  dragState.placeholder = placeholder;
  dragState.started = true;
  clearTimeout(dragState.longPressTimer);
  isDraggingNote = true;
  card.setPointerCapture?.(event.pointerId);
}

function handleNotePointerDown(event) {
  const card = event.target.closest(".note-card");
  if (!card || isInteractiveDragTarget(event.target)) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  dragState = {
    card,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    initialRect: card.getBoundingClientRect(),
    started: false,
    placeholder: null,
    moved: false,
    longPressTimer: null
  };

  if (event.pointerType === "touch") {
    dragState.longPressTimer = setTimeout(() => {
      if (dragState && dragState.pointerId === event.pointerId && !dragState.started) {
        beginNoteDrag(event);
      }
    }, 150);
  }
}

function handleNotePointerMove(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;
  const distance = Math.hypot(deltaX, deltaY);

  if (event.pointerType === "touch" && !dragState.started && distance > 10) {
    clearTimeout(dragState.longPressTimer);
    dragState = null;
    return;
  }

  if (!dragState.started && distance < 7) return;
  if (!dragState.started) beginNoteDrag(event);
  if (!dragState.started) return;

  event.preventDefault();
  dragState.moved = true;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  dragState.card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(.7deg)`;
  movePlaceholder(event.clientX, event.clientY);
}

function clearDragStyles(card) {
  card.style.position = "";
  card.style.left = "";
  card.style.top = "";
  card.style.width = "";
  card.style.height = "";
  card.style.zIndex = "";
  card.style.pointerEvents = "";
  card.style.transform = "";
}

function finishNoteDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const state = dragState;
  dragState = null;
  clearTimeout(state.longPressTimer);

  if (!state.started) {
    setTimeout(() => { isDraggingNote = false; }, 0);
    return;
  }

  const card = state.card;
  const placeholder = state.placeholder;
  const targetRect = placeholder.getBoundingClientRect();
  const currentRect = card.getBoundingClientRect();

  card.style.left = `${targetRect.left}px`;
  card.style.top = `${targetRect.top}px`;
  card.style.transform = `translate3d(${currentRect.left - targetRect.left}px, ${currentRect.top - targetRect.top}px, 0)`;

  requestAnimationFrame(() => {
    card.style.transition = "transform 180ms cubic-bezier(.2, 0, .2, 1)";
    card.style.transform = "translate3d(0, 0, 0)";

    setTimeout(() => {
      placeholder.replaceWith(card);
      clearDragStyles(card);
      card.style.transition = "";
      card.classList.remove("dragging");
      notesList.classList.remove("drag-active");
      document.body.classList.remove("is-note-dragging");
      syncMasonryLayout();
      observeMasonryCards();
      saveManualOrder();
      setTimeout(() => { isDraggingNote = false; }, 80);
    }, 190);
  });
}

function cancelNoteDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const { card, placeholder } = dragState;
  clearTimeout(dragState.longPressTimer);
  dragState = null;

  if (placeholder) placeholder.replaceWith(card);
  clearDragStyles(card);
  card.classList.remove("dragging");
  notesList.classList.remove("drag-active");
  document.body.classList.remove("is-note-dragging");
  syncMasonryLayout();
  observeMasonryCards();
  setTimeout(() => { isDraggingNote = false; }, 80);
}

function renderReadView(note) {
  readTitle.textContent = note.title || "Tanpa judul";
  readContent.textContent = note.content || "";
  readLabels.innerHTML = renderTagBadges(note.labels, false);
  readDeadline.innerHTML = renderMetaBadges({ ...note, favorite: false }, false);
  readCreatedAt.textContent = `Dibuat: ${formatDateTime(note.created_at)}`;
  readUpdatedAt.textContent = `Diperbarui: ${formatDateTime(note.updated_at)}`;
  readFavoriteButton.innerHTML = note.favorite ? "&#9733;" : "&#9734;";
  readFavoriteButton.classList.toggle("active", Boolean(note.favorite));
  readFavoriteButton.setAttribute("aria-label", note.favorite ? "Hapus dari favorit" : "Jadikan favorit");
}

function fillEditForm(note) {
  modalTitle.value = note.title;
  modalContent.value = note.content;
  modalTags.value = labelsToText(note.labels);
  modalDeadline.value = note.deadline || "";
  modalFavorite.checked = Boolean(note.favorite);
  modalCreatedAt.textContent = `Dibuat: ${formatDateTime(note.created_at)}`;
  modalUpdatedAt.textContent = `Diperbarui: ${formatDateTime(note.updated_at)}`;
  modalMessage.textContent = "";
  modalMessage.className = "message modal-message";
}

function setModalMode(mode = "read", focusTarget = "title") {
  modalMode = mode;
  const isEdit = mode === "edit";

  modalReadView.classList.toggle("hidden", isEdit);
  modalEditView.classList.toggle("hidden", !isEdit);

  if (isEdit) {
    fillEditForm(activeNote);
    const focusMap = {
      label: modalTags,
      deadline: modalDeadline,
      title: modalTitle
    };
    setTimeout(() => (focusMap[focusTarget] || modalTitle).focus(), 0);
  }
}

function triggerPaperOpenAnimation(mode = "read") {
  const modalPaper = noteModal?.querySelector(".keep-modal");
  if (!modalPaper) return;

  modalPaper.classList.remove("paper-open-animation", "paper-open-read", "paper-open-edit");
  // Paksa browser membaca ulang layout agar animasi dapat diputar ulang setiap modal dibuka.
  void modalPaper.offsetWidth;
  modalPaper.classList.add("paper-open-animation", mode === "edit" ? "paper-open-edit" : "paper-open-read");

  window.setTimeout(() => {
    modalPaper.classList.remove("paper-open-animation", "paper-open-read", "paper-open-edit");
  }, 760);
}

function openNoteModal(note, mode = "read") {
  activeNote = note;
  renderReadView(activeNote);

  const nextMode = mode === "label" || mode === "deadline" || mode === "edit" ? "edit" : "read";
  playBookOpenSound();

  noteModal.classList.remove("hidden");
  noteModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  triggerPaperOpenAnimation(nextMode);

  const focusTarget = mode === "label" || mode === "deadline" ? mode : "title";
  setModalMode(nextMode, focusTarget);
}

function closeNoteModal() {
  activeNote = null;
  modalMode = "read";
  noteModal.classList.add("hidden");
  noteModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function closeSidebarOnMobile() {
  if (!isMobileViewport()) return;
  document.body.classList.remove("sidebar-expanded");
  document.body.classList.add("sidebar-collapsed");
  sidebarToggle.setAttribute("aria-pressed", "false");
}

async function createNote(event) {
  event.preventDefault();

  const payload = getNotePayload({
    title: titleInput.value,
    content: contentInput.value,
    labels: tagsInput.value,
    favorite: favoriteInput.checked,
    deadline: deadlineInput.value
  });

  if (!payload.title || !payload.content) {
    showMessage("Judul dan isi catatan tidak boleh kosong.", "error");
    expandComposer(true);
    return;
  }

  try {
    const result = await fetchJson("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    showMessage(result.message, "success");
    currentSortOption = "manual";
    sortSelect.value = "manual";
    collapseComposer(true);
    loadNotes();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function updateNote(event) {
  event.preventDefault();
  if (!activeNote) return;

  const payload = getNotePayload({
    title: modalTitle.value,
    content: modalContent.value,
    labels: modalTags.value,
    favorite: modalFavorite.checked,
    deadline: modalDeadline.value
  });

  if (!payload.title || !payload.content) {
    showMessage("Judul dan isi catatan tidak boleh kosong.", "error", modalMessage);
    return;
  }

  try {
    const result = await fetchJson(`/api/notes/${activeNote.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    activeNote = normalizeNote(result.data);
    allNotes = allNotes.map((note) => note.id === activeNote.id ? activeNote : note);
    renderReadView(activeNote);
    setModalMode("read");
    showMessage(result.message, "success");
    loadNotes();
  } catch (error) {
    showMessage(error.message, "error", modalMessage);
  }
}

async function deleteNote(note = activeNote) {
  if (!note) return;

  const confirmed = confirm("Yakin ingin menghapus catatan ini?");
  if (!confirmed) return;

  try {
    const result = await fetchJson(`/api/notes/${note.id}`, { method: "DELETE" });

    showMessage(result.message, "success");
    closeNoteModal();
    loadNotes();
  } catch (error) {
    const target = !noteModal.classList.contains("hidden") && modalMode === "edit" ? modalMessage : messageBox;
    showMessage(error.message, "error", target);
  }
}

async function toggleFavorite(note) {
  const payload = getNotePayload({
    title: note.title,
    content: note.content,
    labels: note.labels,
    favorite: !note.favorite,
    deadline: note.deadline || ""
  });

  try {
    const result = await fetchJson(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const updatedNote = normalizeNote(result.data);
    allNotes = allNotes.map((item) => item.id === updatedNote.id ? updatedNote : item);
    if (activeNote && activeNote.id === updatedNote.id) {
      activeNote = updatedNote;
      renderReadView(activeNote);
      if (modalMode === "edit") fillEditForm(activeNote);
    }

    showMessage(payload.favorite ? "Catatan ditambahkan ke favorit." : "Catatan dihapus dari favorit.", "success");
    loadNotes();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

sidebarToggle.addEventListener("click", () => {
  const isExpanded = document.body.classList.toggle("sidebar-expanded");
  document.body.classList.toggle("sidebar-collapsed", !isExpanded);
  sidebarToggle.setAttribute("aria-pressed", String(isExpanded));
});

sideItems.forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
    closeSidebarOnMobile();
  });
});

if (labelSummaryButton) {
  labelSummaryButton.addEventListener("click", () => {
    const isExpanded = document.body.classList.contains("sidebar-expanded");
    if (!isExpanded) {
      document.body.classList.add("sidebar-expanded");
      document.body.classList.remove("sidebar-collapsed");
      sidebarToggle.setAttribute("aria-pressed", "true");
    }
  });
}

composerPrompt.addEventListener("click", (event) => {
  event.stopPropagation();
  expandComposer(true);
});

composerCard.addEventListener("click", (event) => {
  if (composerCard.classList.contains("collapsed")) {
    event.stopPropagation();
    expandComposer(true);
  }
});

titleInput.addEventListener("focus", () => expandComposer(false));
contentInput.addEventListener("focus", () => expandComposer(false));
contentInput.addEventListener("input", resizeComposerContent);
noteForm.addEventListener("submit", createNote);
resetButton.addEventListener("click", () => collapseComposer(true));
searchInput.addEventListener("input", filterNotes);
sortSelect.addEventListener("change", () => sortNotes(sortSelect.value));
modalForm.addEventListener("submit", updateNote);
modalDeleteButton.addEventListener("click", () => deleteNote(activeNote));
modalCancelButton.addEventListener("click", () => {
  if (activeNote) {
    renderReadView(activeNote);
    setModalMode("read");
  }
});
modalCloseButton.addEventListener("click", closeNoteModal);
readEditButton.addEventListener("click", () => {
  playBookOpenSound();
  setModalMode("edit");
});
readDeleteButton.addEventListener("click", () => deleteNote(activeNote));
readCloseButton.addEventListener("click", closeNoteModal);
readFavoriteButton.addEventListener("click", () => {
  if (activeNote) toggleFavorite(activeNote);
});
document.querySelector("[data-modal-close]").addEventListener("click", closeNoteModal);

document.addEventListener("pointerdown", (event) => {
  if (composerCard.classList.contains("expanded") && !composerCard.contains(event.target)) {
    collapseComposerFromOutside();
  }

  if (
    isMobileViewport() &&
    document.body.classList.contains("sidebar-expanded") &&
    !sidePanel.contains(event.target) &&
    !sidebarToggle.contains(event.target)
  ) {
    closeSidebarOnMobile();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !noteModal.classList.contains("hidden")) {
    closeNoteModal();
  }
});

document.addEventListener("DOMContentLoaded", loadNotes);
