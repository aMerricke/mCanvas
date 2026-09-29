"use strict";

function readExpansionState(key) {
  try {
    return window.sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeExpansionState(key, expanded) {
  try {
    window.sessionStorage.setItem(key, String(expanded));
  } catch {
    // Navigation expansion can remain in memory if session storage is unavailable.
  }
}

function courseExpansionKey(courseId) {
  return `${COURSE_EXPANSION_KEY_PREFIX}${courseId}`;
}

function setGlobalOverflowExpanded(expanded) {
  overflowExpanded = expanded;
  writeExpansionState(GLOBAL_EXPANSION_KEY, expanded);
}

function setCourseOverflowExpanded(courseId, expanded) {
  expandedCourseId = String(courseId);
  courseOverflowExpanded = expanded;
  writeExpansionState(courseExpansionKey(courseId), expanded);
}

function setSyncStorage(values, warning) {
  try {
    if (!chrome.runtime?.id) return;
    chrome.storage.sync.set(values, () => {
      if (chrome.runtime.lastError) console.warn(warning, chrome.runtime.lastError.message);
    });
  } catch (error) {
    if (error?.message !== "Extension context invalidated.") console.warn(warning, error);
  }
}

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
    overflow: navigationModel.filter((item) => item.visibility === "overflow").map((item) => item.key),
  };
  setSyncStorage(
    { [STORAGE_KEY]: savedSettings },
    "mCanvas could not save navigation settings:"
  );
}

function normalizedSidebarSettings(stored) {
  const knownKeys = new Set(sidebarDefaultOrder);
  return {
    order: Array.isArray(stored?.order) ? stored.order.filter((key) => knownKeys.has(key)) : [],
    hidden: Array.isArray(stored?.hidden)
      ? stored.hidden.filter((key) => knownKeys.has(key))
      : [],
    doneHistory: ["week", "month", "all"].includes(stored?.doneHistory)
      ? stored.doneHistory
      : "month",
    todoLookahead: ["week", "month", "all"].includes(stored?.todoLookahead)
      ? stored.todoLookahead
      : "all",
    showLockedAssignments: stored?.showLockedAssignments === true,
  };
}

function readSidebarSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SIDEBAR_STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        console.warn("mCanvas could not read sidebar settings:", chrome.runtime.lastError.message);
        resolve(normalizedSidebarSettings());
        return;
      }
      resolve(normalizedSidebarSettings(result[SIDEBAR_STORAGE_KEY]));
    });
  });
}

function writeSidebarSettings() {
  savedSidebarSettings = {
    order: sidebarModel.map((item) => item.key),
    hidden: sidebarModel.filter((item) => item.visibility === "overflow").map((item) => item.key),
    doneHistory: savedSidebarSettings.doneHistory,
    todoLookahead: savedSidebarSettings.todoLookahead,
    showLockedAssignments: savedSidebarSettings.showLockedAssignments,
  };
  setSyncStorage(
    { [SIDEBAR_STORAGE_KEY]: savedSidebarSettings },
    "mCanvas could not save sidebar settings:"
  );
}

function readCourseSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(COURSE_STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        console.warn("mCanvas could not read course navigation settings:", chrome.runtime.lastError.message);
        resolve({});
        return;
      }
      const stored = result[COURSE_STORAGE_KEY];
      resolve(stored && typeof stored === "object" ? stored : {});
    });
  });
}

function courseSettings(courseId) {
  const hostSettings = savedCourseSettings[window.location.host];
  const stored = hostSettings?.[String(courseId)];
  return {
    order: Array.isArray(stored?.order) ? stored.order : [],
    hidden: Array.isArray(stored?.hidden) ? stored.hidden : [],
  };
}

function writeCourseSettings(courseId, model) {
  const host = window.location.host;
  savedCourseSettings = {
    ...savedCourseSettings,
    [host]: {
      ...savedCourseSettings[host],
      [String(courseId)]: {
        order: model.map((item) => item.key),
        hidden: model.filter((item) => item.visibility === "overflow").map((item) => item.key),
      },
    },
  };
  setSyncStorage(
    { [COURSE_STORAGE_KEY]: savedCourseSettings },
    "mCanvas could not save course navigation settings:"
  );
}

function clearCourseSettings(courseId) {
  const host = window.location.host;
  const hostSettings = { ...savedCourseSettings[host] };
  delete hostSettings[String(courseId)];
  savedCourseSettings = { ...savedCourseSettings };
  if (Object.keys(hostSettings).length > 0) savedCourseSettings[host] = hostSettings;
  else delete savedCourseSettings[host];
  setSyncStorage(
    { [COURSE_STORAGE_KEY]: savedCourseSettings },
    "mCanvas could not clear course navigation settings:"
  );
}

function normalizedAssignmentCompletions(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

  return Object.fromEntries(
    Object.entries(stored).flatMap(([host, assignments]) => {
      if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) return [];
      const normalizedAssignments = Object.fromEntries(
        Object.entries(assignments).flatMap(([key, value]) => {
          if (typeof value === "boolean") {
            return [[key, { completed: value, completedAt: null }]];
          }
          if (!value || typeof value !== "object" || typeof value.completed !== "boolean") {
            return [];
          }
          const completedAt = typeof value.completedAt === "string" &&
            Number.isFinite(new Date(value.completedAt).getTime())
            ? value.completedAt
            : null;
          return [[key, { completed: value.completed, completedAt }]];
        })
      );
      return [[host, normalizedAssignments]];
    })
  );
}

function readAssignmentCompletions() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(ASSIGNMENT_COMPLETION_STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "mCanvas could not read assignment completion settings:",
          chrome.runtime.lastError.message
        );
        resolve({});
        return;
      }
      resolve(normalizedAssignmentCompletions(result[ASSIGNMENT_COMPLETION_STORAGE_KEY]));
    });
  });
}

function writeAssignmentCompletions() {
  setSyncStorage(
    { [ASSIGNMENT_COMPLETION_STORAGE_KEY]: savedAssignmentCompletions },
    "mCanvas could not save assignment completion settings:"
  );
}
