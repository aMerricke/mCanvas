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
    "/api/v1/courses?per_page=100&enrollment_state=active&state[]=available"
  );
  return courses.map((course) => ({
    id: String(course.id),
    name: courseLabel(course),
    code: course.course_code || "",
  }));
}
