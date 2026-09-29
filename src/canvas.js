"use strict";

overflowExpanded = readExpansionState(GLOBAL_EXPANSION_KEY);

function buildSidebarModel() {
    const hiddenKeys = new Set(savedSidebarSettings.hidden);
    const preferredOrder = [
      ...savedSidebarSettings.order,
      ...sidebarDefaultOrder.filter((key) => !savedSidebarSettings.order.includes(key)),
    ];
    const positions = new Map(preferredOrder.map((key, index) => [key, index]));
    sidebarModel = [
      { key: MCANVAS_TODO_KEY, label: "To-do list" },
    ]
      .map((item) => ({
        ...item,
        visibility: hiddenKeys.has(item.key) ? "overflow" : "primary",
        configurable: true,
      }))
      .sort((first, second) =>
        positions.get(first.key) - positions.get(second.key)
      );
  }

  function courseTabKey(href, fallback) {
    try {
      const pathname = new URL(href, window.location.origin).pathname;
      const match = pathname.match(/^\/courses\/[^/]+(?:\/(.*))?$/);
      if (match) return `canvas-course:${match[1] || "home"}`;
    } catch {
      // Fall through to the Canvas tab identifier.
    }
    return `canvas-course:${textKey(String(fallback || href || "navigation-item"))}`;
  }

  function courseModelFromTabs(tabs, settings) {
    const hiddenKeys = new Set(settings.hidden);
    const items = tabs
      .filter((tab) => !tab.hidden && tab.visibility !== "none")
      .sort((first, second) =>
        (Number(first.position) || Number.MAX_SAFE_INTEGER) -
        (Number(second.position) || Number.MAX_SAFE_INTEGER)
      )
      .map((tab) => ({
        key: courseTabKey(tab.html_url, tab.id),
        label: tab.label || tab.id || "Navigation item",
        visibility: hiddenKeys.has(courseTabKey(tab.html_url, tab.id)) ? "overflow" : "primary",
        configurable: true,
      }));
    const positions = new Map(settings.order.map((key, index) => [key, index]));
    return items.sort((first, second) =>
      (positions.get(first.key) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(second.key) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  function discoverCourseItems(navigation) {
    return [...navigation.querySelectorAll(":scope > li")]
      .filter((element) => !element.dataset.mcanvasOwned)
      .map((element) => {
        const link = element.querySelector("a[href]");
        return {
          key: courseTabKey(link?.getAttribute("href"), link?.textContent),
          label: labelItem(element),
          visibility: "primary",
          configurable: true,
          element,
        };
      });
  }

  function createCourseOverflowToggle(courseId, expanded, hiddenItems) {
    const item = document.createElement("li");
    item.className = "section mcanvas-course-overflow-toggle-item";
    item.dataset.mcanvasOwned = "true";

    const button = document.createElement("button");
    button.className = "mcanvas-course-overflow-toggle";
    button.type = "button";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute(
      "aria-controls",
      hiddenItems.map((hiddenItem) => hiddenItem.element?.id).filter(Boolean).join(" ")
    );
    const tooltip = expanded ? "Hide hidden" : "Show hidden";
    button.setAttribute("aria-label", tooltip);
    button.title = tooltip;
    button.innerHTML = '<span class="mcanvas-overflow-dots" aria-hidden="true"></span>';
    button.addEventListener("click", () => {
      setCourseOverflowExpanded(courseId, !courseOverflowExpanded);
      navigationObserver?.disconnect();
      applyCourseNavigation(courseId);
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
      document.querySelector(".mcanvas-course-overflow-toggle")?.focus();
    });
    item.append(button);
    return item;
  }

  function applyCourseNavigation(courseId, suppliedModel) {
    if (String(currentCourseId()) !== String(courseId)) return;
    const navigation = document.querySelector(COURSE_NAVIGATION_SELECTOR);
    if (!navigation) return;
    if (expandedCourseId !== String(courseId)) {
      expandedCourseId = String(courseId);
      courseOverflowExpanded = readExpansionState(courseExpansionKey(courseId));
    }
    navigation.querySelectorAll(".mcanvas-course-overflow-toggle-item").forEach((item) => item.remove());
    const settings = courseSettings(courseId);
    const discovered = discoverCourseItems(navigation);
    const elementsByKey = new Map(discovered.map((item) => [item.key, item.element]));
    const model = suppliedModel || courseModelFromTabs(discovered.map((item) => ({
      id: item.key,
      label: item.label,
      html_url: item.element.querySelector("a[href]")?.getAttribute("href"),
    })), settings);
    const configuredKeys = new Set(model.map((item) => item.key));
    const ordered = [...model, ...discovered.filter((item) => !configuredKeys.has(item.key))];
    const hiddenItems = [];
    for (const item of ordered) {
      const element = elementsByKey.get(item.key) || item.element;
      if (!element) continue;
      const hidden = item.visibility === "overflow";
      if (hidden) {
        if (!element.id) element.id = `mcanvas-course-overflow-${textKey(item.key)}`;
        hiddenItems.push({ ...item, element });
      }
      element.classList.toggle(COURSE_HIDDEN_CLASS, hidden && !courseOverflowExpanded);
      navigation.append(element);
    }
    if (hiddenItems.length > 0) {
      navigation.append(
        createCourseOverflowToggle(courseId, courseOverflowExpanded, hiddenItems)
      );
    } else {
      setCourseOverflowExpanded(courseId, false);
    }
  }

  async function loadCourseModels(courseId) {
    const tabs = await fetchCanvasCollection(`/api/v1/courses/${encodeURIComponent(courseId)}/tabs?per_page=100`);
    return {
      configured: courseModelFromTabs(tabs, courseSettings(courseId)),
      canvasDefault: courseModelFromTabs(tabs, { order: [], hidden: [] }),
    };
  }

  function normalizedHref(link) {
    const href = link?.getAttribute("href");
    if (!href) return "";

    try {
      const url = new URL(href, window.location.origin);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return href;
    }
  }

  function textKey(value) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function identifyItem(element, usedKeys) {
    const link = element.querySelector("a, button");
    const candidates = [
      link?.id,
      element.dataset.testid,
      link?.dataset.testid,
      normalizedHref(link),
      link?.getAttribute("aria-label"),
      element.textContent,
    ];
    const base = candidates.map((value) => value?.trim()).find(Boolean) || "navigation-item";
    const normalized = textKey(base) || "navigation-item";
    let key = `canvas:${normalized}`;
    let suffix = 2;

    while (usedKeys.has(key)) {
      key = `canvas:${normalized}:${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);
    return key;
  }

  function labelItem(element) {
    const link = element.querySelector("a, button");
    return (
      link?.getAttribute("aria-label") ||
      element.querySelector(".menu-item__text")?.textContent ||
      element.textContent ||
      "Navigation item"
    )
      .trim()
      .replace(/\s+/g, " ");
  }

  function sidebarContainer() {
    return document.querySelector(SIDEBAR_SELECTOR) || undefined;
  }

  function measureCanvasLayoutWidths() {
    if (window.innerWidth < 1100 || document.body?.classList.contains("mcanvas-layout-width-measured")) {
      return;
    }

    const wrapper = document.querySelector(".ic-Layout-wrapper");
    const content = document.querySelector("#content-wrapper");
    const sidebar = sidebarContainer();
    if (!wrapper || !content || !sidebar) return;

    const nativeMaxWidth = Number.parseFloat(getComputedStyle(wrapper).maxWidth);
    const marginReservation = Number.parseFloat(getComputedStyle(content).marginRight) || 0;
    const paddingReservation = Number.parseFloat(getComputedStyle(content).paddingRight) || 0;
    const wrapperBounds = wrapper.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const sidebarBounds = sidebar.getBoundingClientRect();
    const geometricReservation = Math.max(0, wrapperBounds.right - contentBounds.right);
    const sidebarRegion = Math.max(0, wrapperBounds.right - sidebarBounds.left);
    const sidebarReservation = Math.max(
      marginReservation,
      paddingReservation,
      geometricReservation,
      sidebarRegion
    );
    if (!Number.isFinite(nativeMaxWidth) || sidebarReservation <= 0) return;

    document.body.style.setProperty(
      "--mcanvas-native-layout-max-width",
      `${nativeMaxWidth}px`
    );
    document.body.style.setProperty(
      "--mcanvas-sidebar-reservation",
      `${sidebarReservation}px`
    );
    document.body.classList.add("mcanvas-layout-width-measured");
  }

  function formatAssignmentDueDate(dueAt) {
    if (!dueAt) return "No due date";
    return `Due ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dueAt))}`;
  }

  function assignmentStorageKey(assignment) {
    return `${assignment.course.id}:${assignment.id}`;
  }

  function compareAssignmentsByReverseDueDate(first, second) {
    if (!first.due_at) return second.due_at ? 1 : first.name.localeCompare(second.name);
    if (!second.due_at) return -1;
    return new Date(second.due_at) - new Date(first.due_at);
  }

  function assignmentIsComplete(assignment) {
    const stored = savedAssignmentCompletions[window.location.host]?.[assignmentStorageKey(assignment)];
    return typeof stored?.completed === "boolean"
      ? stored.completed
      : isCanvasAssignmentComplete(assignment);
  }

  function assignmentCompletedAt(assignment) {
    const stored = savedAssignmentCompletions[window.location.host]?.[assignmentStorageKey(assignment)];
    if (stored?.completed && stored.completedAt) return new Date(stored.completedAt);
    if (!isCanvasAssignmentComplete(assignment)) return undefined;
    const canvasCompletedAt = assignment.submission?.submitted_at || assignment.submission?.graded_at;
    return canvasCompletedAt ? new Date(canvasCompletedAt) : undefined;
  }

  function assignmentIsInDoneHistory(assignment, now = new Date()) {
    const history = savedSidebarSettings.doneHistory;
    if (history === "all") return true;

    const completedAt = assignmentCompletedAt(assignment);
    if (!completedAt || !Number.isFinite(completedAt.getTime())) return false;
    const historyDays = history === "month" ? 30 : 7;
    return completedAt >= new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000);
  }

  function assignmentIsInTodoLookahead(assignment, now = new Date()) {
    const lookahead = savedSidebarSettings.todoLookahead;
    if (lookahead === "all" || !assignment.due_at) return true;

    const dueAt = new Date(assignment.due_at);
    if (!Number.isFinite(dueAt.getTime())) return true;
    const lookaheadDays = lookahead === "month" ? 30 : 7;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + lookaheadDays);
    cutoff.setHours(23, 59, 59, 999);
    return dueAt <= cutoff;
  }

  function assignmentIsVisibleForLockSetting(assignment) {
    return savedSidebarSettings.showLockedAssignments || !isAssignmentLocked(assignment);
  }

  function setAssignmentCompletion(assignment, completed) {
    const host = window.location.host;
    const key = assignmentStorageKey(assignment);
    const hostCompletions = { ...savedAssignmentCompletions[host] };

    if (completed === isCanvasAssignmentComplete(assignment)) delete hostCompletions[key];
    else {
      hostCompletions[key] = {
        completed,
        completedAt: completed ? new Date().toISOString() : null,
      };
    }

    savedAssignmentCompletions = {
      ...savedAssignmentCompletions,
      [host]: hostCompletions,
    };
    writeAssignmentCompletions();
  }

  function createAssignmentItem(assignment, completed, section) {
    const item = document.createElement("li");
    item.className = "mcanvas-todo-assignment";
    item.classList.toggle("mcanvas-todo-assignment-complete", completed);

    const toggle = document.createElement("button");
    toggle.className = "mcanvas-todo-toggle";
    toggle.type = "button";
    toggle.dataset.assignmentKey = assignmentStorageKey(assignment);
    toggle.setAttribute("aria-pressed", String(completed));
    toggle.setAttribute(
      "aria-label",
      `${completed ? "Mark incomplete" : "Mark complete"}: ${assignment.name}`
    );
    toggle.title = completed ? "Move back to To do" : "Mark complete";

    const content = document.createElement("div");
    content.className = "mcanvas-todo-content";

    const title = document.createElement("a");
    title.className = "mcanvas-todo-title";
    title.href = assignment.html_url;
    title.textContent = assignment.name;

    const details = document.createElement("span");
    details.className = "mcanvas-todo-details";
    details.textContent = `${assignment.course.name} · ${formatAssignmentDueDate(assignment.due_at)}`;

    toggle.addEventListener("click", () => {
      const nextCompleted = !completed;
      setAssignmentCompletion(assignment, nextCompleted);
      const remaining = todoAssignments.filter((itemAssignment) =>
        !assignmentIsComplete(itemAssignment) &&
        assignmentIsVisibleForLockSetting(itemAssignment) &&
        assignmentIsInTodoLookahead(itemAssignment)
      ).length;
      assignmentFeedback = nextCompleted
        ? `${assignment.name} completed. ${remaining ? `${remaining} left.` : "Everything is done!"}`
        : `${assignment.name} moved back to To do.`;
      renderTodoAssignments(section);

      const activePanel = section.querySelector('.mcanvas-todo-tab-panel:not([hidden])');
      const movedAssignmentToggle = activePanel?.querySelector(
        `.mcanvas-todo-toggle[data-assignment-key="${CSS.escape(assignmentStorageKey(assignment))}"]`
      );
      const focusToggle = movedAssignmentToggle || activePanel?.querySelector(".mcanvas-todo-toggle");
      if (focusToggle) focusToggle.focus();
      else section.querySelector('.mcanvas-todo-tab[aria-selected="true"]')?.focus();
      if (nextCompleted) {
        const movedItem = movedAssignmentToggle?.closest(".mcanvas-todo-assignment");
        movedItem?.classList.add("mcanvas-todo-assignment-celebrate");
        window.setTimeout(
          () => movedItem?.classList.remove("mcanvas-todo-assignment-celebrate"),
          650
        );
      }
    });

    content.append(title, details);
    item.append(toggle, content);
    return item;
  }

  function activateAssignmentTab(board, tabName, focus = false) {
    activeAssignmentTab = tabName;
    for (const tab of board.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.assignmentTab === tabName;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of board.querySelectorAll('[role="tabpanel"]')) {
      panel.hidden = panel.dataset.assignmentPanel !== tabName;
    }
  }

  function createAssignmentTab(label, count, tabName, board) {
    const tab = document.createElement("button");
    tab.className = "mcanvas-todo-tab";
    tab.id = `mcanvas-assignment-tab-${tabName}`;
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.dataset.assignmentTab = tabName;
    tab.setAttribute("aria-controls", `mcanvas-assignment-panel-${tabName}`);
    tab.setAttribute("aria-label", `${label}, ${count} assignments`);
    tab.append(document.createTextNode(label));

    const badge = document.createElement("span");
    badge.className = "mcanvas-todo-count";
    badge.textContent = String(count);
    tab.append(badge);

    tab.addEventListener("click", () => activateAssignmentTab(board, tabName));
    tab.addEventListener("keydown", (event) => {
      const tabNames = ["todo", "done"];
      const currentIndex = tabNames.indexOf(tabName);
      let nextIndex;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabNames.length) % tabNames.length;
      else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabNames.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabNames.length - 1;
      else return;
      event.preventDefault();
      activateAssignmentTab(board, tabNames[nextIndex], true);
    });
    return tab;
  }

  function createAssignmentTabPanel(assignments, completed, tabName, section) {
    const panel = document.createElement("section");
    panel.className = "mcanvas-todo-tab-panel";
    panel.id = `mcanvas-assignment-panel-${tabName}`;
    panel.setAttribute("role", "tabpanel");
    panel.dataset.assignmentPanel = tabName;
    panel.setAttribute("aria-labelledby", `mcanvas-assignment-tab-${tabName}`);

    const list = document.createElement("ul");
    list.className = "mcanvas-todo-list";
    list.id = `mcanvas-assignment-list-${tabName}`;
    list.setAttribute("aria-label", `${tabName === "todo" ? "To do" : "Done"} assignments`);
    for (const assignment of assignments) {
      list.append(createAssignmentItem(assignment, completed, section));
    }

    if (assignments.length === 0) {
      const empty = document.createElement("li");
      empty.className = "mcanvas-todo-empty";
      empty.textContent = completed ? "Better get moving then." : "Nice.";
      list.append(empty);
    }

    panel.append(list);
    return panel;
  }

  function renderTodoAssignments(section) {
    section.replaceChildren();

    const header = document.createElement("div");
    header.className = "mcanvas-todo-header";

    const heading = document.createElement("h2");
    heading.className = "mcanvas-todo-heading";
    heading.textContent = "Assignments";

    const settingsButton = document.createElement("button");
    settingsButton.className = "mcanvas-todo-settings";
    settingsButton.type = "button";
    settingsButton.setAttribute("aria-label", "Configure To-do list");
    settingsButton.title = "Configure To-do list";
    settingsButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>`;
    settingsButton.addEventListener("click", () => openConfigurationDialog("todo"));

    header.append(heading, settingsButton);
    section.append(header);

    if (todoAssignmentsState !== "ready") {
      const status = document.createElement("p");
      status.className = "mcanvas-todo-status";
      status.textContent = todoAssignmentsState === "error"
        ? "Assignments could not be loaded."
        : "Loading assignments…";
      section.append(status);
      return;
    }

    const incomplete = todoAssignments.filter((assignment) =>
      !assignmentIsComplete(assignment) &&
      assignmentIsVisibleForLockSetting(assignment) &&
      assignmentIsInTodoLookahead(assignment)
    );
    const allComplete = todoAssignments.filter((assignment) =>
      assignmentIsComplete(assignment) && assignmentIsVisibleForLockSetting(assignment)
    );
    const complete = allComplete
      .filter((assignment) => assignmentIsInDoneHistory(assignment))
      .sort(compareAssignmentsByReverseDueDate);
    const visibleTotal = incomplete.length + complete.length;
    if (visibleTotal === 0) {
      const empty = document.createElement("p");
      empty.className = "mcanvas-todo-status";
      empty.textContent = "No active assignments.";
      section.append(empty);
      return;
    }
    const progressText = document.createElement("span");
    progressText.className = "mcanvas-todo-progress-text";
    progressText.textContent = `${complete.length}/${visibleTotal} done`;
    header.insertBefore(progressText, settingsButton);

    const progress = document.createElement("progress");
    progress.className = "mcanvas-todo-progress";
    progress.max = visibleTotal;
    progress.value = complete.length;
    progress.setAttribute(
      "aria-label",
      `${complete.length} of ${visibleTotal} assignments complete`
    );

    const feedback = document.createElement("p");
    feedback.className = "mcanvas-todo-feedback";
    feedback.setAttribute("aria-live", "polite");
    feedback.textContent = assignmentFeedback;

    const board = document.createElement("div");
    board.className = "mcanvas-todo-board";
    const tabList = document.createElement("div");
    tabList.className = "mcanvas-todo-tabs";
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "Assignment status");
    tabList.append(
      createAssignmentTab("To do", incomplete.length, "todo", board),
      createAssignmentTab("Done", complete.length, "done", board)
    );
    board.append(
      tabList,
      createAssignmentTabPanel(incomplete, false, "todo", section),
      createAssignmentTabPanel(complete, true, "done", section)
    );
    activateAssignmentTab(board, activeAssignmentTab);
    section.append(progress, feedback, board);
  }

  function ensureTodoPlaceholder(container) {
    const existing = document.querySelector(`${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`);
    if (existing) {
      if (existing.parentElement !== container) container.append(existing);
      return existing;
    }
    const placeholder = document.createElement("section");
    placeholder.className = "mcanvas-todo-placeholder";
    placeholder.dataset.mcanvasOwned = "true";
    placeholder.setAttribute("aria-label", "Assignment tracker");
    renderTodoAssignments(placeholder);
    container.append(placeholder);
    return placeholder;
  }

  async function loadTodoAssignments() {
    try {
      todoAssignments = await fetchAssignmentTrackerAssignments();
      todoAssignmentsState = "ready";
    } catch (error) {
      todoAssignmentsState = "error";
      console.warn("mCanvas could not load assignments:", error);
    }
    const section = document.querySelector(`${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`);
    if (section) renderTodoAssignments(section);
  }

  function applySidebarLayout() {
    measureCanvasLayoutWidths();
    const container = sidebarContainer();
    if (!container) {
      document.body?.classList.remove("mcanvas-sidebar-empty");
      return;
    }
    const todoPlaceholder = ensureTodoPlaceholder(container);
    const canvasElements = [...container.children].filter(
      (element) => !element.dataset.mcanvasOwned
    );
    const itemsByKey = new Map(sidebarModel.map((item) => [item.key, item]));
    const todoVisible = itemsByKey.get(MCANVAS_TODO_KEY)?.visibility !== "overflow";

    todoPlaceholder.classList.toggle(SIDEBAR_HIDDEN_CLASS, !todoVisible);
    container.classList.add("mcanvas-native-sidebar-hidden");
    for (const element of canvasElements) {
      element.classList.add(SIDEBAR_HIDDEN_CLASS);
    }
    container.prepend(todoPlaceholder);

    document.body?.classList.toggle(
      "mcanvas-sidebar-empty",
      !todoVisible
    );
  }

  function discoverCanvasItems(navigation) {
    const usedKeys = new Set();
    return [...navigation.querySelectorAll(LIST_ITEM_SELECTOR)]
      .filter((element) => !element.dataset.mcanvasOwned)
      .map((element) => ({
        key: identifyItem(element, usedKeys),
        label: labelItem(element),
        visibility: "primary",
        configurable: true,
        element,
      }));
  }

  function mergeNavigationModel(discoveredItems) {
    const discoveredByKey = new Map(discoveredItems.map((item) => [item.key, item]));
    const existingByKey = new Map(navigationModel.map((item) => [item.key, item]));
    const overflowKeys = new Set(savedSettings.overflow);
    const merged = [];

    const currentOrder = navigationModel.map((item) => item.key);
    const currentKeys = new Set(currentOrder);
    const preferredOrder = [
      ...currentOrder,
      ...savedSettings.order.filter((key) => !currentKeys.has(key)),
    ];

    for (const key of preferredOrder) {
      const discovered = discoveredByKey.get(key);
      if (!discovered) continue;
      const existing = existingByKey.get(key);
      merged.push({
        ...discovered,
        visibility: existing?.visibility || (overflowKeys.has(key) ? "overflow" : "primary"),
      });
      discoveredByKey.delete(key);
    }

    for (const discovered of discoveredByKey.values()) {
      merged.push({
        ...discovered,
        visibility: overflowKeys.has(discovered.key) ? "overflow" : "primary",
      });
    }
    navigationModel = merged;
  }

  function createMCanvasItem() {
    const item = document.createElement("li");
    item.className = "ic-app-header__menu-list-item mcanvas-navigation-item";
    item.dataset.mcanvasKey = MCANVAS_KEY;
    item.dataset.mcanvasOwned = "true";

    const button = document.createElement("button");
    button.className = "ic-app-header__menu-list-link mcanvas-navigation-button";
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-label", "Open mCanvas configuration");
    button.innerHTML = `
      <span class="mcanvas-navigation-icon" aria-hidden="true">m</span>
      <span class="mcanvas-navigation-label">mCanvas</span>`;
    button.addEventListener("click", () => openConfigurationDialog());
    item.append(button);
    return item;
  }

  function createOverflowToggle(expanded, overflowItems) {
    const item = document.createElement("li");
    item.className = "ic-app-header__menu-list-item mcanvas-overflow-toggle-item";
    item.dataset.mcanvasOwned = "true";

    const button = document.createElement("button");
    button.className = "ic-app-header__menu-list-link mcanvas-overflow-toggle";
    button.type = "button";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute(
      "aria-controls",
      overflowItems.map((overflowItem) => overflowItem.element.id).join(" ")
    );
    const tooltip = expanded ? "Hide hidden" : "Show hidden";
    button.setAttribute("aria-label", tooltip);
    button.title = tooltip;
    button.innerHTML = '<span class="mcanvas-overflow-dots" aria-hidden="true"></span>';
    button.addEventListener("click", () => {
      setGlobalOverflowExpanded(!overflowExpanded);
      navigationObserver?.disconnect();
      applyNavigationLayout(document.querySelector(NAVIGATION_SELECTOR));
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
      document.querySelector(".mcanvas-overflow-toggle")?.focus();
    });
    item.append(button);
    return item;
  }

  function applyNavigationLayout(navigation) {
    if (!navigation) return;
    const mcanvasItem = navigation.querySelector(".mcanvas-navigation-item");
    const list = mcanvasItem?.parentElement || navigation.querySelector("ul") || navigation;
    navigation.querySelectorAll(".mcanvas-overflow-toggle-item").forEach((item) => item.remove());

    const primaryItems = navigationModel.filter((item) => item.visibility === "primary");
    const overflowItems = navigationModel.filter((item) => item.visibility === "overflow");

    for (const item of primaryItems) {
      item.element.classList.remove(HIDDEN_CLASS);
      list.append(item.element);
    }

    if (overflowItems.length > 0) {
      overflowItems.forEach((item, index) => {
        if (!item.element.id) item.element.id = `mcanvas-overflow-${textKey(item.key)}-${index + 1}`;
      });
      for (const item of overflowItems) {
        item.element.classList.toggle(HIDDEN_CLASS, !overflowExpanded);
        list.append(item.element);
      }
      list.append(createOverflowToggle(overflowExpanded, overflowItems));
    }

    if (mcanvasItem) list.append(mcanvasItem);
    navigation.classList.add("mcanvas-navigation-ready");
  }

  function ensureMCanvasItem(navigation) {
    const list = navigation.querySelector("ul") || navigation;
    const existing = navigation.querySelector(".mcanvas-navigation-item");
    if (existing) {
      if (list.lastElementChild !== existing) list.append(existing);
      return existing;
    }

    const item = createMCanvasItem();
    list.append(item);
    return item;
  }

  function refreshNavigation() {
    const navigation = document.querySelector(NAVIGATION_SELECTOR);
    navigationObserver?.disconnect();
    if (navigation) {
      const discoveredItems = discoverCanvasItems(navigation);
      const knownDefaultKeys = new Set(defaultOrder);
      discoveredItems.forEach((item) => {
        if (!knownDefaultKeys.has(item.key)) {
          defaultOrder.push(item.key);
          knownDefaultKeys.add(item.key);
        }
      });
      ensureMCanvasItem(navigation);
      mergeNavigationModel(discoveredItems);
      applyNavigationLayout(navigation);
    }
    const courseId = currentCourseId();
    if (courseId) applyCourseNavigation(courseId);
    applySidebarLayout();
    navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleRefresh() {
    window.cancelAnimationFrame(refreshFrame);
    refreshFrame = window.requestAnimationFrame(refreshNavigation);
  }

  function closeConfigurationDialog(backdrop) {
    backdrop.mcanvasCancelDrag?.();
    backdrop.mcanvasRemoveInitialFocusHandler?.();
    if (dialogEscapeHandler) {
      document.removeEventListener("keydown", dialogEscapeHandler, true);
      dialogEscapeHandler = undefined;
    }
    const returnFocusElement = backdrop.mcanvasReturnFocusElement;
    backdrop.remove();
    if (returnFocusElement?.isConnected) returnFocusElement.focus();
    else {
      (document.querySelector(".mcanvas-todo-settings") ||
        document.querySelector(".mcanvas-navigation-button"))?.focus();
    }
  }

  async function openConfigurationDialog(requestedPanel, requestedCourseId) {
    if (document.querySelector(".mcanvas-config-backdrop") || configurationDialogOpening) return;
    const returnFocusElement = document.activeElement;
    configurationDialogOpening = true;

    try {
      const [favorites, active] = await Promise.all([
        favoriteCourses.length > 0 ? favoriteCourses : fetchFavoriteCourses(),
        availableCourses.length > 0 ? availableCourses : fetchActiveCourses(),
      ]);
      favoriteCourses = favorites;
      availableCourses = active;
    } catch (error) {
      console.warn("mCanvas could not load courses:", error);
    }

    const pageCourseId = currentCourseId();
    requestedPanel ||= pageCourseId ? "course-navigation" : "global-navigation";
    requestedCourseId ||= pageCourseId || favoriteCourses[0]?.id || availableCourses[0]?.id;
    activeConfigurationPanel = requestedPanel;

    let globalEditorModel = navigationModel;
    const globalEditorDefaultOrder = [...defaultOrder];
    const globalEditorDefaultVisibility = new Map(
      navigationModel.map((item) => [item.key, "primary"])
    );
    let courseEditorModel = [];
    let courseEditorDefaultOrder = [];
    let courseEditorDefaultVisibility = new Map();
    if (requestedCourseId) {
      try {
        const courseModels = await loadCourseModels(requestedCourseId);
        courseEditorModel = courseModels.configured;
        courseEditorDefaultOrder = courseModels.canvasDefault.map((item) => item.key);
        courseEditorDefaultVisibility = new Map(
          courseModels.canvasDefault.map((item) => [item.key, item.visibility])
        );
      } catch (error) {
        console.warn("mCanvas could not load course navigation:", error);
      }
    }
    configurationDialogOpening = false;
    if (document.querySelector(".mcanvas-config-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.mcanvasReturnFocusElement = returnFocusElement;
    backdrop.className = "mcanvas-config-backdrop";
    backdrop.innerHTML = `
      <section class="mcanvas-config-dialog" role="dialog" aria-modal="true" aria-labelledby="mcanvas-config-title" tabindex="-1">
        <header class="mcanvas-config-header">
          <h2 class="mcanvas-config-heading" id="mcanvas-config-title">mCanvas</h2>
        </header>
        <div class="mcanvas-config-panel-tabs" role="tablist" aria-label="Configuration section">
          <button id="mcanvas-global-navigation-tab" role="tab" aria-selected="false" aria-controls="mcanvas-global-navigation-panel" tabindex="-1" type="button" data-panel="global-navigation">Global nav</button>
          <button id="mcanvas-course-navigation-tab" role="tab" aria-selected="false" aria-controls="mcanvas-course-navigation-panel" tabindex="-1" type="button" data-panel="course-navigation">Course nav</button>
          <button id="mcanvas-todo-tab" role="tab" aria-selected="false" aria-controls="mcanvas-todo-panel" tabindex="-1" type="button" data-panel="todo">To-do list</button>
        </div>
        <p class="mcanvas-sr-only" aria-live="polite" aria-atomic="true"></p>
        <div id="mcanvas-global-navigation-panel" role="tabpanel" aria-labelledby="mcanvas-global-navigation-tab" data-panel="global-navigation">
          <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-global-visible-heading">
            <h3 class="mcanvas-config-group-heading" id="mcanvas-global-visible-heading">Visible</h3>
            <ul class="mcanvas-config-tab-list" data-visibility="primary"></ul>
          </section>
          <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-global-hidden-heading">
            <h3 class="mcanvas-config-group-heading" id="mcanvas-global-hidden-heading">Hidden</h3>
            <ul class="mcanvas-config-tab-list" data-visibility="overflow"></ul>
          </section>
          <footer class="mcanvas-config-footer">
            <p class="mcanvas-config-keyboard-tip"><code>↑/↓</code> to focus · <code>Alt + ↑/↓</code> to reorder</p>
            <button class="mcanvas-config-restore-button" type="button" data-panel="global-navigation">Restore Defaults</button>
          </footer>
        </div>
        <div id="mcanvas-course-navigation-panel" role="tabpanel" aria-labelledby="mcanvas-course-navigation-tab" data-panel="course-navigation" hidden>
          <div class="mcanvas-config-context-field">
            <label for="mcanvas-course-context">Course</label>
            <select id="mcanvas-course-context"></select>
          </div>
          <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-course-visible-heading">
            <h3 class="mcanvas-config-group-heading" id="mcanvas-course-visible-heading">Visible</h3>
            <ul class="mcanvas-config-tab-list" data-visibility="primary"></ul>
          </section>
          <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-course-hidden-heading">
            <h3 class="mcanvas-config-group-heading" id="mcanvas-course-hidden-heading">Hidden</h3>
            <ul class="mcanvas-config-tab-list" data-visibility="overflow"></ul>
          </section>
          <footer class="mcanvas-config-footer">
            <p class="mcanvas-config-keyboard-tip"><code>↑/↓</code> to focus · <code>Alt + ↑/↓</code> to reorder</p>
            <button class="mcanvas-config-restore-button" type="button" data-panel="course-navigation">Restore Defaults</button>
          </footer>
        </div>
        <div id="mcanvas-todo-panel" role="tabpanel" aria-labelledby="mcanvas-todo-tab" data-panel="todo" hidden>
          <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-todo-visibility-heading">
            <h3 class="mcanvas-config-group-heading" id="mcanvas-todo-visibility-heading">Widget visibility</h3>
            <ul class="mcanvas-config-tab-list">
              <li class="mcanvas-config-tab-row mcanvas-config-static-row" tabindex="0">
                <span class="mcanvas-config-tab-name">Show/Hide</span>
                <input id="mcanvas-todo-visible" type="checkbox" role="switch" aria-label="Show/Hide">
              </li>
            </ul>
          </section>
          <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-todo-locked-heading">
            <h3 class="mcanvas-config-group-heading" id="mcanvas-todo-locked-heading">Locked assignments</h3>
            <ul class="mcanvas-config-tab-list">
              <li class="mcanvas-config-tab-row mcanvas-config-static-row" tabindex="0">
                <span class="mcanvas-config-tab-name">Show locked assignments</span>
                <input id="mcanvas-show-locked" type="checkbox" role="switch" aria-label="Show locked assignments">
              </li>
            </ul>
          </section>
          <div class="mcanvas-config-context-field mcanvas-config-todo-setting">
            <label for="mcanvas-done-history">Done history</label>
            <select id="mcanvas-done-history">
              <option value="week">Past week</option>
              <option value="month">Past month</option>
              <option value="all">All time</option>
            </select>
          </div>
          <div class="mcanvas-config-context-field mcanvas-config-todo-setting">
            <label for="mcanvas-todo-lookahead">To-do lookahead</label>
            <select id="mcanvas-todo-lookahead">
              <option value="week">Next week</option>
              <option value="month">Next month</option>
              <option value="all">All posted</option>
            </select>
          </div>
          <footer class="mcanvas-config-footer">
            <button class="mcanvas-config-todo-restore-button" type="button">Restore Defaults</button>
          </footer>
        </div>
      </section>`;

    const tabLists = [...backdrop.querySelectorAll(".mcanvas-config-tab-list[data-visibility]")];
    const dialog = backdrop.querySelector(".mcanvas-config-dialog");
    const courseSelect = backdrop.querySelector("#mcanvas-course-context");
    const restoreButtons = [...backdrop.querySelectorAll(".mcanvas-config-restore-button")];
    const todoVisibilityToggle = backdrop.querySelector("#mcanvas-todo-visible");
    const todoVisibilityRow = todoVisibilityToggle.closest(".mcanvas-config-static-row");
    const showLockedToggle = backdrop.querySelector("#mcanvas-show-locked");
    const showLockedRow = showLockedToggle.closest(".mcanvas-config-static-row");
    const todoLookaheadSelect = backdrop.querySelector("#mcanvas-todo-lookahead");
    const doneHistorySelect = backdrop.querySelector("#mcanvas-done-history");
    const todoRestoreDefaultsButton = backdrop.querySelector(".mcanvas-config-todo-restore-button");
    const announcer = backdrop.querySelector(".mcanvas-sr-only");
    let dragSession;
    let suppressClick = false;

    function appendCourseOptions(group, courses) {
      for (const course of courses) {
        const option = document.createElement("option");
        option.value = course.id;
        option.textContent = course.code && course.code !== course.name
          ? `${course.name} (${course.code})`
          : course.name;
        group.append(option);
      }
    }

    function populateCourseSelect() {
      courseSelect.replaceChildren();
      const favoriteIds = new Set(favoriteCourses.map((course) => course.id));
      const activeById = new Map(availableCourses.map((course) => [course.id, course]));
      const favorites = [...activeById.values()]
        .filter((course) => favoriteIds.has(course.id))
        .sort((first, second) => first.name.localeCompare(second.name));
      const others = [...activeById.values()]
        .filter((course) => !favoriteIds.has(course.id))
        .sort((first, second) => first.name.localeCompare(second.name));

      if (requestedCourseId && !activeById.has(String(requestedCourseId))) {
        const currentGroup = document.createElement("optgroup");
        currentGroup.label = "Current course";
        appendCourseOptions(currentGroup, [{
          id: String(requestedCourseId),
          name: favoriteCourses.find((course) => course.id === String(requestedCourseId))?.name ||
            `Course ${requestedCourseId}`,
          code: "",
        }]);
        courseSelect.append(currentGroup);
      }
      if (favorites.length > 0) {
        const favoriteGroup = document.createElement("optgroup");
        favoriteGroup.label = "Favorite courses";
        appendCourseOptions(favoriteGroup, favorites);
        courseSelect.append(favoriteGroup);
      }
      if (others.length > 0) {
        const activeGroup = document.createElement("optgroup");
        activeGroup.label = "Other active courses";
        appendCourseOptions(activeGroup, others);
        courseSelect.append(activeGroup);
      }
      if (courseSelect.options.length === 0) {
        const option = document.createElement("option");
        option.textContent = "No active courses available";
        option.disabled = true;
        courseSelect.append(option);
      } else {
        courseSelect.value = String(requestedCourseId);
      }
    }

    populateCourseSelect();
    todoVisibilityToggle.checked = sidebarModel.find(
      (item) => item.key === MCANVAS_TODO_KEY
    )?.visibility !== "overflow";
    showLockedToggle.checked = savedSidebarSettings.showLockedAssignments;
    todoLookaheadSelect.value = savedSidebarSettings.todoLookahead;
    doneHistorySelect.value = savedSidebarSettings.doneHistory;

    const panelTabs = [...backdrop.querySelectorAll('.mcanvas-config-panel-tabs [role="tab"]')];

    function activateConfigurationPanel(panelName, moveFocus = false) {
      const selectedTab = panelTabs.find((tab) => tab.dataset.panel === panelName) || panelTabs[0];
      if (!selectedTab) return;
      activeConfigurationPanel = selectedTab.dataset.panel;
      for (const tab of panelTabs) {
        const selected = tab === selectedTab;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      backdrop.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== activeConfigurationPanel;
      });
      if (moveFocus) selectedTab.focus();
    }

    for (const tab of panelTabs) {
      tab.addEventListener("click", () => activateConfigurationPanel(tab.dataset.panel));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = panelTabs.indexOf(tab);
        let nextIndex;
        if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = panelTabs.length - 1;
        else if (event.key === "ArrowLeft") {
          nextIndex = (currentIndex - 1 + panelTabs.length) % panelTabs.length;
        } else {
          nextIndex = (currentIndex + 1) % panelTabs.length;
        }
        activateConfigurationPanel(panelTabs[nextIndex].dataset.panel, true);
      });
    }
    activateConfigurationPanel(activeConfigurationPanel);

    function announce(message) {
      announcer.textContent = "";
      window.requestAnimationFrame(() => {
        announcer.textContent = message;
      });
    }

    function restoreRowFocus(row) {
      row.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        if (row.isConnected && document.activeElement !== row) {
          row.focus({ preventScroll: true });
        }
      });
    }

    function panelElement(panelName) {
      return backdrop.querySelector(`[role="tabpanel"][data-panel="${panelName}"]`);
    }

    function listsForPanel(panelName) {
      const panel = panelElement(panelName);
      return {
        all: [...panel.querySelectorAll(".mcanvas-config-tab-list")],
        visible: panel.querySelector('[data-visibility="primary"]'),
        hidden: panel.querySelector('[data-visibility="overflow"]'),
      };
    }

    function modelForPanel(panelName) {
      if (panelName === "course-navigation") return courseEditorModel;
      return globalEditorModel;
    }

    function setModelForPanel(panelName, model) {
      if (panelName === "course-navigation") courseEditorModel = model;
      else globalEditorModel = model;
    }

    function updateRowPositions() {
      tabLists.forEach((list) => {
        const groupName = list.dataset.visibility === "primary" ? "Visible" : "Hidden";
        [...list.children].forEach((row, index) => {
          if (!row.classList.contains("mcanvas-config-tab-row")) return;
          const name = row.querySelector(".mcanvas-config-tab-name")?.textContent;
          row.setAttribute(
            "aria-label",
            `${name}, ${groupName}, position ${index + 1} of ${list.children.length}. Hold Alt and press an arrow key to move.`
          );
        });
      });
    }

    function applyRowOrder(message, persist = true, panelName = activeConfigurationPanel) {
      const model = modelForPanel(panelName);
      const lists = listsForPanel(panelName);
      const itemsByKey = new Map(model.map((item) => [item.key, item]));
      const configured = lists.all.flatMap((list) =>
        [...list.querySelectorAll(":scope > .mcanvas-config-tab-row")].map((row) => {
          const item = itemsByKey.get(row.dataset.key);
          if (!item) return undefined;
          item.visibility = list.dataset.visibility;
          row.querySelector("input").checked = item.visibility === "primary";
          return item;
        })
      ).filter(Boolean);
      const orderedKeys = new Set(configured.map((item) => item.key));
      const unlisted = model.filter((item) => !orderedKeys.has(item.key));
      const nextModel = [...configured, ...unlisted];
      setModelForPanel(panelName, nextModel);

      if (panelName === "global-navigation") {
        navigationModel = globalEditorModel;
        if (persist) writeSettings();
      } else if (panelName === "course-navigation") {
        if (persist) writeCourseSettings(requestedCourseId, courseEditorModel);
      }

      navigationObserver?.disconnect();
      if (panelName === "global-navigation") {
        applyNavigationLayout(document.querySelector(NAVIGATION_SELECTOR));
      } else if (panelName === "course-navigation") {
        applyCourseNavigation(requestedCourseId, courseEditorModel);
      }
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
      updateRowPositions();
      if (message) announce(message);
    }

    function restoreRowOrder(panelName) {
      const lists = listsForPanel(panelName);
      const rowsByKey = new Map(
        lists.all.flatMap((list) => [...list.querySelectorAll(":scope > .mcanvas-config-tab-row")])
          .map((candidate) => [candidate.dataset.key, candidate])
      );
      for (const modelItem of modelForPanel(panelName)) {
        const modelRow = rowsByKey.get(modelItem.key);
        if (modelRow) {
          const destination = modelItem.visibility === "primary" ? lists.visible : lists.hidden;
          destination.append(modelRow);
        }
      }
      updateRowPositions();
    }

    function removeDragListeners() {
      window.removeEventListener("pointermove", moveDrag, true);
      window.removeEventListener("pointerup", completeDrag, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
    }

    function finishDrag(commit) {
      if (!dragSession) return;
      const { row, floatingList, placeholder, active } = dragSession;
      removeDragListeners();

      if (active) {
        placeholder.replaceWith(row);
        floatingList.remove();
        row.classList.remove("mcanvas-config-tab-row-dragging");
        if (commit) {
          const groupName = row.parentElement.dataset.visibility === "primary" ? "Visible" : "Hidden";
          applyRowOrder(
            `${row.querySelector(".mcanvas-config-tab-name")?.textContent} moved to ${groupName}.`,
            true,
            row.dataset.panel
          );
        } else {
          restoreRowOrder(row.dataset.panel);
        }
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
        restoreRowFocus(row);
      }

      dragSession = undefined;
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
    }

    function beginVisualDrag(event) {
      const { row } = dragSession;
      const bounds = row.getBoundingClientRect();
      const placeholder = document.createElement("li");
      placeholder.className = "mcanvas-config-drop-placeholder";
      placeholder.style.height = `${bounds.height}px`;
      row.before(placeholder);

      const floatingList = document.createElement("ul");
      floatingList.className = "mcanvas-config-floating-list";
      Object.assign(floatingList.style, {
        insetInlineStart: `${bounds.left}px`,
        insetBlockStart: `${bounds.top}px`,
        width: `${bounds.width}px`,
      });
      row.classList.add("mcanvas-config-tab-row-dragging");
      floatingList.append(row);
      document.body.append(floatingList);
      dragSession = {
        ...dragSession,
        active: true,
        floatingList,
        offsetY: Math.min(event.clientY - bounds.top, 24),
        placeholder,
      };
      navigationObserver?.disconnect();
    }

    function moveDrag(event) {
      if (!dragSession || event.pointerId !== dragSession.pointerId) return;
      if (!dragSession.active) {
        const distance = Math.hypot(
          event.clientX - dragSession.startX,
          event.clientY - dragSession.startY
        );
        if (distance < 5) return;
        beginVisualDrag(event);
      }

      event.preventDefault();
      dragSession.floatingList.style.insetBlockStart = `${event.clientY - dragSession.offsetY}px`;

      const dialogBounds = dialog.getBoundingClientRect();
      if (event.clientY < dialogBounds.top + 40) dialog.scrollBy(0, -10);
      else if (event.clientY > dialogBounds.bottom - 40) dialog.scrollBy(0, 10);

      const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
      let destinationList = pointedElement?.closest(".mcanvas-config-tab-list");
      if (!destinationList) {
        destinationList = pointedElement
          ?.closest(".mcanvas-config-tab-group")
          ?.querySelector(".mcanvas-config-tab-list");
      }
      if (!destinationList || destinationList.closest("[role='tabpanel']")?.dataset.panel !== dragSession.row.dataset.panel) return;

      const nextRow = [...destinationList.querySelectorAll(".mcanvas-config-tab-row")].find(
        (candidate) => event.clientY < candidate.getBoundingClientRect().top + candidate.offsetHeight / 2
      );
      if (nextRow) destinationList.insertBefore(dragSession.placeholder, nextRow);
      else destinationList.append(dragSession.placeholder);
    }

    function completeDrag(event) {
      if (!dragSession || event.pointerId !== dragSession.pointerId) return;
      finishDrag(true);
    }

    function cancelDrag(event) {
      if (event && dragSession && event.pointerId !== dragSession.pointerId) return;
      finishDrag(false);
    }

    function startDrag(event, row) {
      if (event.button !== 0 || event.target.closest("input")) return;
      dragSession = {
        active: false,
        pointerId: event.pointerId,
        row,
        startX: event.clientX,
        startY: event.clientY,
      };
      window.addEventListener("pointermove", moveDrag, { capture: true, passive: false });
      window.addEventListener("pointerup", completeDrag, true);
      window.addEventListener("pointercancel", cancelDrag, true);
    }

    backdrop.mcanvasCancelDrag = cancelDrag;

    function renderEditorPanel(panelName, panelModel) {
      const lists = listsForPanel(panelName);
      lists.all.forEach((list) => list.replaceChildren());
      for (const item of panelModel.filter((candidate) => candidate.configurable)) {
        const row = document.createElement("li");
        row.className = "mcanvas-config-tab-row";
        row.dataset.key = item.key;
        row.dataset.panel = panelName;
        row.tabIndex = 0;

      const handle = document.createElement("span");
      handle.className = "mcanvas-config-drag-handle";
      handle.setAttribute("aria-hidden", "true");
      handle.title = "Drag to reorder";
      handle.textContent = "⠿";

      const label = document.createElement("span");
      const name = document.createElement("span");
      name.className = "mcanvas-config-tab-name";
      name.textContent = item.label;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `mcanvas-${panelName}-visibility-${textKey(item.key)}`;
      checkbox.checked = item.visibility === "primary";
      checkbox.setAttribute("aria-label", `Show ${item.label}`);
      checkbox.addEventListener("change", () => {
        if (panelName.endsWith("navigation") && checkbox.checked) {
          if (panelName === "global-navigation") setGlobalOverflowExpanded(false);
          else setCourseOverflowExpanded(requestedCourseId, false);
        }
        const destination = checkbox.checked ? lists.visible : lists.hidden;
        if (checkbox.checked) destination.append(row);
        else destination.prepend(row);
        applyRowOrder(
          `${item.label} moved to ${checkbox.checked ? "Visible" : "Hidden"}.`,
          true,
          panelName
        );
        restoreRowFocus(row);
      });
      label.append(name);
      row.append(handle, label, checkbox);

      row.addEventListener("pointerdown", (event) => {
        startDrag(event, row);
      });

      row.addEventListener("click", (event) => {
        if (suppressClick) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.target.closest("input")) return;
        checkbox.click();
      });

      row.addEventListener("keydown", (event) => {
        if (event.target.closest("input")) return;
        if (event.key === "Enter") {
          event.preventDefault();
          checkbox.click();
          return;
        }
        if (
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          ["ArrowUp", "ArrowDown"].includes(event.key)
        ) {
          event.preventDefault();
          const rows = lists.all.flatMap((list) => [
            ...list.querySelectorAll(":scope > .mcanvas-config-tab-row"),
          ]);
          const currentIndex = rows.indexOf(row);
          const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
          rows[nextIndex]?.focus();
          return;
        }
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const allRows = lists.all.flatMap((list) => [
          ...list.querySelectorAll(":scope > .mcanvas-config-tab-row"),
        ]);
        const rowIndex = allRows.indexOf(row);
        const target = allRows[event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1];
        const sourceList = row.parentElement;
        let destinationList = target?.parentElement;
        if (!target) {
          if (event.key === "ArrowDown" && sourceList === lists.visible) destinationList = lists.hidden;
          else if (event.key === "ArrowUp" && sourceList === lists.hidden) destinationList = lists.visible;
          else return;
        }
        const crossesGroupBoundary = sourceList !== destinationList;
        if (!target) {
          destinationList.append(row);
        } else if (event.key === "ArrowUp") {
          if (crossesGroupBoundary) target.after(row);
          else target.before(row);
        } else if (crossesGroupBoundary) {
          target.before(row);
        } else {
          target.after(row);
        }
        const destinationName = destinationList.dataset.visibility === "primary" ? "Visible" : "Hidden";
        applyRowOrder(`${item.label} moved in ${destinationName}.`, true, panelName);
        restoreRowFocus(row);
      });

      const destination = item.visibility === "primary" ? lists.visible : lists.hidden;
      destination.append(row);
      }
      updateRowPositions();
    }

    renderEditorPanel("global-navigation", globalEditorModel);
    renderEditorPanel("course-navigation", courseEditorModel);

    todoVisibilityToggle.addEventListener("change", () => {
      const todoItem = sidebarModel.find((item) => item.key === MCANVAS_TODO_KEY);
      if (!todoItem) return;
      todoItem.visibility = todoVisibilityToggle.checked ? "primary" : "overflow";
      writeSidebarSettings();
      navigationObserver?.disconnect();
      applySidebarLayout();
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
      announce(`To-do list ${todoVisibilityToggle.checked ? "shown" : "hidden"}.`);
    });
    todoVisibilityRow.addEventListener("click", (event) => {
      if (!event.target.closest("input")) todoVisibilityToggle.click();
    });
    todoVisibilityRow.addEventListener("keydown", (event) => {
      if (event.target.closest("input") || event.key !== "Enter") return;
      event.preventDefault();
      todoVisibilityToggle.click();
    });
    showLockedToggle.addEventListener("change", () => {
      savedSidebarSettings = {
        ...savedSidebarSettings,
        showLockedAssignments: showLockedToggle.checked,
      };
      writeSidebarSettings();
      const section = document.querySelector(`${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`);
      if (section) renderTodoAssignments(section);
      announce(`Locked assignments ${showLockedToggle.checked ? "shown" : "hidden"}.`);
    });
    showLockedRow.addEventListener("click", (event) => {
      if (!event.target.closest("input")) showLockedToggle.click();
    });
    showLockedRow.addEventListener("keydown", (event) => {
      if (event.target.closest("input") || event.key !== "Enter") return;
      event.preventDefault();
      showLockedToggle.click();
    });
    todoLookaheadSelect.addEventListener("change", () => {
      savedSidebarSettings = {
        ...savedSidebarSettings,
        todoLookahead: todoLookaheadSelect.value,
      };
      writeSidebarSettings();
      const section = document.querySelector(`${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`);
      if (section) renderTodoAssignments(section);
      const selectedLabel = todoLookaheadSelect.selectedOptions[0]?.textContent || "All posted";
      announce(`To-do lookahead set to ${selectedLabel}.`);
    });
    doneHistorySelect.addEventListener("change", () => {
      savedSidebarSettings = {
        ...savedSidebarSettings,
        doneHistory: doneHistorySelect.value,
      };
      writeSidebarSettings();
      const section = document.querySelector(`${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`);
      if (section) renderTodoAssignments(section);
      const selectedLabel = doneHistorySelect.selectedOptions[0]?.textContent || "Past month";
      announce(`Done history set to ${selectedLabel}.`);
    });
    todoRestoreDefaultsButton.addEventListener("click", () => {
      const todoItem = sidebarModel.find((item) => item.key === MCANVAS_TODO_KEY);
      if (todoItem) todoItem.visibility = "primary";
      savedSidebarSettings = {
        ...savedSidebarSettings,
        doneHistory: "month",
        todoLookahead: "all",
        showLockedAssignments: false,
      };
      todoVisibilityToggle.checked = true;
      showLockedToggle.checked = false;
      doneHistorySelect.value = "month";
      todoLookaheadSelect.value = "all";
      writeSidebarSettings();
      navigationObserver?.disconnect();
      applySidebarLayout();
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
      const section = document.querySelector(`${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`);
      if (section) renderTodoAssignments(section);
      announce("To-do list defaults restored.");
      todoRestoreDefaultsButton.focus();
    });

    courseSelect.addEventListener("change", async () => {
      const nextCourseId = courseSelect.value;
      if (!nextCourseId || nextCourseId === String(requestedCourseId)) return;
      const previousCourseId = requestedCourseId;
      courseSelect.disabled = true;
      announce("Loading course navigation.");
      try {
        const courseModels = await loadCourseModels(nextCourseId);
        requestedCourseId = nextCourseId;
        courseEditorModel = courseModels.configured;
        courseEditorDefaultOrder = courseModels.canvasDefault.map((item) => item.key);
        courseEditorDefaultVisibility = new Map(
          courseModels.canvasDefault.map((item) => [item.key, item.visibility])
        );
        renderEditorPanel("course-navigation", courseEditorModel);
        announce("Course navigation loaded.");
      } catch (error) {
        console.warn("mCanvas could not load course navigation:", error);
        courseSelect.value = String(previousCourseId);
        announce("Course navigation could not be loaded.");
      } finally {
        courseSelect.disabled = false;
        courseSelect.focus();
      }
    });

    for (const restoreButton of restoreButtons) {
      restoreButton.addEventListener("click", () => {
        const panelName = restoreButton.dataset.panel;
        const lists = listsForPanel(panelName);
        const model = modelForPanel(panelName);
        const defaultOrderForPanel = panelName === "course-navigation"
            ? courseEditorDefaultOrder
            : globalEditorDefaultOrder;
        const defaultVisibilityForPanel = panelName === "course-navigation"
            ? courseEditorDefaultVisibility
            : globalEditorDefaultVisibility;
        const defaultPositions = new Map(defaultOrderForPanel.map((key, index) => [key, index]));
        model.sort((first, second) =>
          (defaultPositions.get(first.key) ?? Number.MAX_SAFE_INTEGER) -
          (defaultPositions.get(second.key) ?? Number.MAX_SAFE_INTEGER)
        );
        model.forEach((item) => {
          item.visibility = defaultVisibilityForPanel.get(item.key) || "primary";
          const row = panelElement(panelName).querySelector(
            `.mcanvas-config-tab-row[data-key="${CSS.escape(item.key)}"]`
          );
          if (!row) return;
          const visible = item.visibility === "primary";
          row.querySelector("input").checked = visible;
          (visible ? lists.visible : lists.hidden).append(row);
        });
        if (panelName === "global-navigation") {
          setGlobalOverflowExpanded(false);
        } else if (panelName === "course-navigation") {
          setCourseOverflowExpanded(requestedCourseId, false);
          clearCourseSettings(requestedCourseId);
        }
        const persist = panelName === "global-navigation";
        applyRowOrder(
          "Navigation defaults restored.",
          persist,
          panelName
        );
        restoreButton.focus();
      });
    }

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeConfigurationDialog(backdrop);
      }
    });

    dialogEscapeHandler = (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        closeConfigurationDialog(backdrop);
      }
    };
    document.addEventListener("keydown", dialogEscapeHandler, true);

    let hasPointerInteraction = false;
    const markPointerInteraction = () => {
      hasPointerInteraction = true;
      document.removeEventListener("keydown", focusFirstRowOnKeyboardEntry, true);
    };
    function focusFirstRowOnKeyboardEntry(event) {
      if (
        hasPointerInteraction ||
        event.key === "Escape" ||
        event.key === "Esc" ||
        ["Alt", "Control", "Meta", "Shift"].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Tab") {
        backdrop.querySelector('[role="tab"][aria-selected="true"]')?.focus();
      }
      else {
        const activePanel = backdrop.querySelector('[role="tabpanel"]:not([hidden])');
        (activePanel?.querySelector(".mcanvas-config-tab-row") ||
          backdrop.querySelector('[role="tab"][aria-selected="true"]'))?.focus();
      }
      document.removeEventListener("keydown", focusFirstRowOnKeyboardEntry, true);
    }
    backdrop.addEventListener("pointerdown", markPointerInteraction, {
      capture: true,
      once: true,
    });
    document.addEventListener("keydown", focusFirstRowOnKeyboardEntry, true);
    backdrop.mcanvasRemoveInitialFocusHandler = () => {
      document.removeEventListener("keydown", focusFirstRowOnKeyboardEntry, true);
    };

    backdrop.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const activePanel = backdrop.querySelector('[role="tabpanel"]:not([hidden])');
      const focusable = [
        ...panelTabs.filter((tab) => tab.getAttribute("aria-selected") === "true"),
        ...activePanel.querySelectorAll('.mcanvas-config-tab-row, select:not(:disabled), input:not(:disabled), button:not(:disabled)'),
      ].filter(Boolean);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });

    document.body.append(backdrop);
    dialog.focus();
  }

  async function initialize() {
    [savedSettings, savedCourseSettings, savedSidebarSettings, savedAssignmentCompletions] = await Promise.all([
      readSettings(),
      readCourseSettings(),
      readSidebarSettings(),
      readAssignmentCompletions(),
    ]);
    buildSidebarModel();
    navigationObserver = new MutationObserver(scheduleRefresh);
    navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", measureCanvasLayoutWidths);
    refreshNavigation();
    loadTodoAssignments();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      if (areaName === "sync" && changes[STORAGE_KEY]) {
        const updated = changes[STORAGE_KEY].newValue;
        const nextSettings = {
          order: Array.isArray(updated?.order) ? updated.order : [],
          overflow: Array.isArray(updated?.overflow) ? updated.overflow : [],
        };
        if (JSON.stringify(nextSettings) !== JSON.stringify(savedSettings)) {
          savedSettings = nextSettings;
          navigationModel = [];
          refreshNavigation();
        }
      }
      if (areaName === "sync" && changes[COURSE_STORAGE_KEY]) {
        const updated = changes[COURSE_STORAGE_KEY].newValue;
        const nextSettings = updated && typeof updated === "object" ? updated : {};
        if (JSON.stringify(nextSettings) !== JSON.stringify(savedCourseSettings)) {
          savedCourseSettings = nextSettings;
          const courseId = currentCourseId();
          if (courseId) applyCourseNavigation(courseId);
        }
      }
      if (areaName === "sync" && changes[SIDEBAR_STORAGE_KEY]) {
        const nextSettings = normalizedSidebarSettings(changes[SIDEBAR_STORAGE_KEY].newValue);
        if (JSON.stringify(nextSettings) !== JSON.stringify(savedSidebarSettings)) {
          savedSidebarSettings = nextSettings;
          buildSidebarModel();
          refreshNavigation();
          const section = document.querySelector(
            `${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`
          );
          if (section) renderTodoAssignments(section);
        }
      }
      if (areaName === "local" && changes[ASSIGNMENT_COMPLETION_STORAGE_KEY]) {
        const nextCompletions = normalizedAssignmentCompletions(
          changes[ASSIGNMENT_COMPLETION_STORAGE_KEY].newValue
        );
        if (JSON.stringify(nextCompletions) !== JSON.stringify(savedAssignmentCompletions)) {
          savedAssignmentCompletions = nextCompletions;
          const section = document.querySelector(
            `${SIDEBAR_SELECTOR} .mcanvas-todo-placeholder`
          );
          if (section) renderTodoAssignments(section);
        }
      }
    });
  }

initialize();
