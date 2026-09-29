"use strict";

function currentCourseId() {
  return window.location.pathname.match(/^\/courses\/([^/]+)/)?.[1];
}

async function fetchCanvasCollection(path) {
  const items = [];
  let nextUrl = new URL(path, window.location.origin).href;
  while (nextUrl) {
    const response = await fetch(nextUrl, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Canvas request failed (${response.status})`);
    const result = await response.json();
    if (Array.isArray(result)) items.push(...result);
    const nextLink = response.headers.get("Link")
      ?.split(",")
      .find((link) => /rel="next"/.test(link));
    nextUrl = nextLink?.match(/<([^>]+)>/)?.[1] || "";
  }
  return items;
}

function courseLabel(course) {
  return course.name || course.course_code || `Course ${course.id}`;
}

async function fetchFavoriteCourses() {
  const courses = await fetchCanvasCollection(
    "/api/v1/users/self/favorites/courses?per_page=100&exclude_blueprint_courses=true"
  );
  return courses.map((course) => ({
    id: String(course.id),
    name: courseLabel(course),
    code: course.course_code || "",
  }));
}

async function fetchActiveCourses() {
  const courses = await fetchCanvasCollection(
    "/api/v1/courses?per_page=100&enrollment_type=student&enrollment_state=active&state[]=available"
  );
  return courses.map((course) => ({
    id: String(course.id),
    name: courseLabel(course),
    code: course.course_code || "",
  }));
}

function isUnsubmittedActiveAssignment(assignment, now = new Date()) {
  const unlockAt = assignment.unlock_at && new Date(assignment.unlock_at);
  const lockAt = assignment.lock_at && new Date(assignment.lock_at);
  const submission = assignment.submission;

  return assignment.published !== false &&
    (!unlockAt || unlockAt <= now) &&
    (!lockAt || lockAt > now) &&
    submission?.excused !== true &&
    (!submission || submission.workflow_state === "unsubmitted");
}

async function fetchAssignmentTrackerCourses() {
  const pageCourseId = currentCourseId();
  const activeCourses = await fetchActiveCourses();

  if (pageCourseId) {
    return activeCourses.filter((course) => course.id === String(pageCourseId));
  }

  const favoriteCourses = await fetchFavoriteCourses();
  const favoriteIds = new Set(favoriteCourses.map((course) => course.id));
  return activeCourses.filter((course) => favoriteIds.has(course.id));
}

async function fetchUnsubmittedActiveAssignments() {
  const courses = await fetchAssignmentTrackerCourses();
  const assignmentsByCourse = await Promise.all(courses.map(async (course) => {
    const assignments = await fetchCanvasCollection(
      `/api/v1/users/self/courses/${encodeURIComponent(course.id)}/assignments` +
      "?per_page=100&include[]=submission&order_by=due_at&override_assignment_dates=true"
    );
    return assignments
      .filter((assignment) => isUnsubmittedActiveAssignment(assignment))
      .map((assignment) => ({ ...assignment, course }));
  }));

  return assignmentsByCourse.flat().sort((first, second) => {
    if (!first.due_at) return second.due_at ? 1 : first.name.localeCompare(second.name);
    if (!second.due_at) return -1;
    return new Date(first.due_at) - new Date(second.due_at);
  });
}
