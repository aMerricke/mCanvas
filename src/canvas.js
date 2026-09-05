(() => {
  "use strict";

  const NAVIGATION_SELECTOR = ".ic-app-header__main-navigation";
  const LIST_ITEM_SELECTOR = ".ic-app-header__menu-list-item";
  const MCANVAS_KEY = "mcanvas:configuration";

  let navigationModel = [];
  let refreshTimer;

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
      .filter((element) => !element.classList.contains("mcanvas-navigation-item"))
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
    const merged = [];

    for (const existing of navigationModel) {
      const discovered = discoveredByKey.get(existing.key);
      if (!discovered) continue;
      merged.push({ ...discovered, visibility: existing.visibility });
      discoveredByKey.delete(existing.key);
    }

    merged.push(...discoveredByKey.values());
    navigationModel = merged;
  }

  function createMCanvasItem() {
    const item = document.createElement("li");
    item.className = "ic-app-header__menu-list-item mcanvas-navigation-item";
    item.dataset.mcanvasKey = MCANVAS_KEY;

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

    const discoveredItems = discoverCanvasItems(navigation);
    ensureMCanvasItem(navigation);
    mergeNavigationModel(discoveredItems);
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshNavigation, 100);
  }

  function closeConfigurationDialog(backdrop) {
    backdrop.remove();
    document.querySelector(".mcanvas-navigation-button")?.focus();
  }

  function openConfigurationDialog() {
    if (document.querySelector(".mcanvas-config-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.className = "mcanvas-config-backdrop";
    backdrop.innerHTML = `
      <section class="mcanvas-config-dialog" role="dialog" aria-modal="true" aria-labelledby="mcanvas-config-title" aria-describedby="mcanvas-config-description">
        <h2 class="mcanvas-config-heading" id="mcanvas-config-title" tabindex="-1">mCanvas</h2>
        <p class="mcanvas-config-description" id="mcanvas-config-description">Configure your Canvas experience</p>
      </section>`;

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeConfigurationDialog(backdrop);
    });

    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeConfigurationDialog(backdrop);
        return;
      }
      if (event.key === "Tab") event.preventDefault();
    });

    document.body.append(backdrop);
    backdrop.querySelector(".mcanvas-config-heading")?.focus();
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refreshNavigation();
})();
