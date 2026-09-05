(() => {
  "use strict";

  const NAVIGATION_SELECTOR = ".ic-app-header__main-navigation";
  const LIST_ITEM_SELECTOR = ".ic-app-header__menu-list-item";
  const MCANVAS_KEY = "mcanvas:configuration";
  const HIDDEN_CLASS = "mcanvas-overflow-hidden";
  const STORAGE_KEY = "globalNavigation";

  const defaultOrder = [];
  let navigationModel = [];
  let dialogEscapeHandler;
  let navigationObserver;
  let overflowExpanded = false;
  let refreshFrame;
  let savedSettings = { order: [], overflow: [] };

  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.warn("mCanvas could not read navigation settings:", chrome.runtime.lastError.message);
          resolve({ order: [], overflow: [] });
          return;
        }

        const stored = result[STORAGE_KEY];
        resolve({
          order: Array.isArray(stored?.order) ? stored.order : [],
          overflow: Array.isArray(stored?.overflow) ? stored.overflow : [],
        });
      });
    });
  }

  function writeSettings() {
    savedSettings = {
      order: navigationModel.map((item) => item.key),
      overflow: navigationModel
        .filter((item) => item.visibility === "overflow")
        .map((item) => item.key),
    };

    chrome.storage.sync.set({ [STORAGE_KEY]: savedSettings }, () => {
      if (chrome.runtime.lastError) {
        console.warn("mCanvas could not save navigation settings:", chrome.runtime.lastError.message);
      }
    });
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
    button.addEventListener("click", openConfigurationDialog);
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
      overflowExpanded = !overflowExpanded;
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
    if (!navigation) return;

    navigationObserver?.disconnect();
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
    backdrop.remove();
    document.querySelector(".mcanvas-navigation-button")?.focus();
  }

  function openConfigurationDialog() {
    if (document.querySelector(".mcanvas-config-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.className = "mcanvas-config-backdrop";
    backdrop.innerHTML = `
      <section class="mcanvas-config-dialog" role="dialog" aria-modal="true" aria-labelledby="mcanvas-config-title" tabindex="-1">
        <header class="mcanvas-config-header">
          <h2 class="mcanvas-config-heading" id="mcanvas-config-title">mCanvas</h2>
          <button class="mcanvas-config-restore-button" type="button">Restore Defaults</button>
        </header>
        <p class="mcanvas-config-keyboard-tip"><code>↑/↓</code> to focus · <code>Alt + ↑/↓</code> to reorder</p>
        <p class="mcanvas-sr-only" aria-live="polite" aria-atomic="true"></p>
        <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-visible-heading">
          <h3 class="mcanvas-config-group-heading" id="mcanvas-visible-heading">Visible</h3>
          <ul class="mcanvas-config-tab-list" data-visibility="primary"></ul>
        </section>
        <section class="mcanvas-config-tab-group" aria-labelledby="mcanvas-hidden-heading">
          <h3 class="mcanvas-config-group-heading" id="mcanvas-hidden-heading">Hidden</h3>
          <ul class="mcanvas-config-tab-list" data-visibility="overflow"></ul>
        </section>
      </section>`;

    const tabLists = [...backdrop.querySelectorAll(".mcanvas-config-tab-list")];
    const visibleList = backdrop.querySelector('[data-visibility="primary"]');
    const hiddenList = backdrop.querySelector('[data-visibility="overflow"]');
    const configurableItems = navigationModel.filter((candidate) => candidate.configurable);
    const dialog = backdrop.querySelector(".mcanvas-config-dialog");
    const restoreButton = backdrop.querySelector(".mcanvas-config-restore-button");
    const announcer = backdrop.querySelector(".mcanvas-sr-only");
    let dragSession;
    let suppressClick = false;

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

    function applyRowOrder(message) {
      const itemsByKey = new Map(navigationModel.map((item) => [item.key, item]));
      const configured = tabLists.flatMap((list) =>
        [...list.querySelectorAll(":scope > .mcanvas-config-tab-row")].map((row) => {
          const item = itemsByKey.get(row.dataset.key);
          if (!item) return undefined;
          item.visibility = list.dataset.visibility;
          row.querySelector("input").checked = item.visibility === "primary";
          return item;
        })
      ).filter(Boolean);
      const orderedKeys = new Set(configured.map((item) => item.key));
      const unlisted = navigationModel.filter((item) => !orderedKeys.has(item.key));
      navigationModel = [...configured, ...unlisted];
      writeSettings();

      navigationObserver?.disconnect();
      applyNavigationLayout(document.querySelector(NAVIGATION_SELECTOR));
      navigationObserver?.observe(document.documentElement, { childList: true, subtree: true });
      updateRowPositions();
      if (message) announce(message);
    }

    function restoreRowOrder() {
      const rowsByKey = new Map(
        tabLists.flatMap((list) => [...list.querySelectorAll(":scope > .mcanvas-config-tab-row")])
          .map((candidate) => [candidate.dataset.key, candidate])
      );
      for (const modelItem of navigationModel) {
        const modelRow = rowsByKey.get(modelItem.key);
        if (modelRow) {
          const destination = modelItem.visibility === "primary" ? visibleList : hiddenList;
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
          applyRowOrder(`${row.querySelector(".mcanvas-config-tab-name")?.textContent} moved to ${groupName}.`);
        } else {
          restoreRowOrder();
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
      if (!destinationList) return;

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

    for (const item of configurableItems) {
      const row = document.createElement("li");
      row.className = "mcanvas-config-tab-row";
      row.dataset.key = item.key;
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
      checkbox.id = `mcanvas-visibility-${textKey(item.key)}`;
      checkbox.checked = item.visibility === "primary";
      checkbox.setAttribute("aria-label", `Show ${item.label} immediately`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) overflowExpanded = false;
        const destination = checkbox.checked ? visibleList : hiddenList;
        if (checkbox.checked) destination.append(row);
        else destination.prepend(row);
        applyRowOrder(`${item.label} moved to ${checkbox.checked ? "Visible" : "Hidden"}.`);
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
          const rows = tabLists.flatMap((list) => [
            ...list.querySelectorAll(":scope > .mcanvas-config-tab-row"),
          ]);
          const currentIndex = rows.indexOf(row);
          const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
          rows[nextIndex]?.focus();
          return;
        }
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const allRows = tabLists.flatMap((list) => [
          ...list.querySelectorAll(":scope > .mcanvas-config-tab-row"),
        ]);
        const rowIndex = allRows.indexOf(row);
        const target = allRows[event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1];
        const sourceList = row.parentElement;
        let destinationList = target?.parentElement;
        if (!target) {
          if (event.key === "ArrowDown" && sourceList === visibleList) destinationList = hiddenList;
          else if (event.key === "ArrowUp" && sourceList === hiddenList) destinationList = visibleList;
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
        applyRowOrder(`${item.label} moved in ${destinationName}.`);
        restoreRowFocus(row);
      });

      const destination = item.visibility === "primary" ? visibleList : hiddenList;
      destination.append(row);
    }
    updateRowPositions();

    restoreButton.addEventListener("click", () => {
      const defaultPositions = new Map(defaultOrder.map((key, index) => [key, index]));
      navigationModel.sort((first, second) =>
        (defaultPositions.get(first.key) ?? Number.MAX_SAFE_INTEGER) -
        (defaultPositions.get(second.key) ?? Number.MAX_SAFE_INTEGER)
      );
      navigationModel.forEach((item) => {
        item.visibility = "primary";
        const row = backdrop.querySelector(
          `.mcanvas-config-tab-row[data-key="${CSS.escape(item.key)}"]`
        );
        if (!row) return;
        row.querySelector("input").checked = true;
        visibleList.append(row);
      });
      overflowExpanded = false;
      applyRowOrder("Navigation defaults restored.");
      restoreButton.focus();
    });

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
      backdrop.querySelector(".mcanvas-config-tab-row")?.focus();
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
      const focusable = [
        restoreButton,
        ...backdrop.querySelectorAll('.mcanvas-config-tab-row, input:not(:disabled)'),
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
    savedSettings = await readSettings();
    navigationObserver = new MutationObserver(scheduleRefresh);
    navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
    refreshNavigation();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[STORAGE_KEY]) return;
      const updated = changes[STORAGE_KEY].newValue;
      const nextSettings = {
        order: Array.isArray(updated?.order) ? updated.order : [],
        overflow: Array.isArray(updated?.overflow) ? updated.overflow : [],
      };
      if (JSON.stringify(nextSettings) === JSON.stringify(savedSettings)) return;
      savedSettings = nextSettings;
      navigationModel = [];
      overflowExpanded = false;
      refreshNavigation();
    });
  }

  initialize();
})();
