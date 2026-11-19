"use strict";

const timezoneInput = document.querySelector("#timezone");
const hevyApiKeyInput = document.querySelector("#hevyApiKey");
const intervalsApiKeyInput = document.querySelector("#intervalsApiKey");
const fetchButton = document.querySelector("#fetchButton");
const downloadButton = document.querySelector("#downloadButton");
const uploadButton = document.querySelector("#uploadButton");
const firstPageButton = document.querySelector("#firstPageButton");
const previousPageButton = document.querySelector("#previousPageButton");
const nextPageButton = document.querySelector("#nextPageButton");
const lastPageButton = document.querySelector("#lastPageButton");
const selectAllCheckbox = document.querySelector("#selectAllCheckbox");
const workoutList = document.querySelector("#workoutList");
const resultCount = document.querySelector("#resultCount");
const pageStatus = document.querySelector("#pageStatus");
const warnings = document.querySelector("#warnings");
const statusBadge = document.querySelector("#statusBadge");
const jsonDialog = document.querySelector("#jsonDialog");
const jsonPreview = document.querySelector("#jsonPreview");
const dialogTitle = document.querySelector("#dialogTitle");
const uploadErrorDialog = document.querySelector("#uploadErrorDialog");
const uploadErrorMessage = document.querySelector("#uploadErrorMessage");
const showUploadErrorJsonButton = document.querySelector("#showUploadErrorJsonButton");

const PAGE_SIZE = 10;
const REQUEST_TIMEOUT_MS = 15000;
let currentWorkouts = [];
let currentActivities = new Map();
let selectedWorkoutIds = new Set();
let currentPage = 0;
let pageCount = 0;
let isFetching = false;
let isUploading = false;
let uploadErrorResponseJson = null;
let uploadErrorHasJson = false;

timezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function setStatus(message, type = "") {
  statusBadge.textContent = message;
  statusBadge.className = `status-badge ${type}`.trim();
}

function showWarning(message, type = "") {
  warnings.textContent = message;
  warnings.hidden = !message;
  warnings.className = `warnings ${type}`.trim();
}

async function responseError(response) {
  const text = (await response.text()).trim();
  let detail = text;
  let responseJson = null;
  let hasResponseJson = false;
  if (text) {
    try {
      responseJson = JSON.parse(text);
      hasResponseJson = true;
      if (typeof responseJson === "string") detail = responseJson;
      else if (responseJson && typeof responseJson === "object") {
        const candidate = responseJson.message || responseJson.error || responseJson.detail;
        detail = typeof candidate === "string" ? candidate : candidate ? JSON.stringify(candidate) : text;
      }
    } catch (error) {
      detail = text;
    }
  }
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const suffix = detail ? `: ${detail.slice(0, 400)}` : "";
  return {
    message: `Intervals.icu returned HTTP ${status}${suffix}`,
    responseJson,
    hasResponseJson
  };
}

function showUploadError(message, responseJson = null, hasResponseJson = false) {
  uploadErrorResponseJson = responseJson;
  uploadErrorHasJson = hasResponseJson;
  uploadErrorMessage.textContent = message;
  showUploadErrorJsonButton.hidden = !hasResponseJson;
  uploadErrorDialog.showModal();
}

function requestErrorMessage(error) {
  if (error.name === "AbortError") {
    return "The upload request timed out. Check your connection and try again.";
  }
  if (error instanceof TypeError || /failed to fetch|networkerror/i.test(error.message || "")) {
    return "Could not reach Intervals.icu. Check your connection and whether the API permits browser cross-origin requests.";
  }
  return error.message || "Unable to upload activities to Intervals.icu.";
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function validDate(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Hevy returned an invalid ${label}.`);
  return date;
}

function formatLocalIso(date, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
  } catch (error) {
    throw new Error(`Unknown timezone: ${timeZone}`);
  }

  const values = Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure browser cryptography is unavailable. Open this app over HTTPS or localhost.");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setDescription(set) {
  const weight = numberValue(set.weight_kg);
  const reps = numberValue(set.reps);
  const distance = numberValue(set.distance_meters);
  const duration = numberValue(set.duration_seconds);
  const details = [];

  if (weight > 0) details.push(`${formatNumber(weight)} kg`);
  if (reps > 0) details.push(`${formatNumber(reps)} reps`);
  if (distance > 0) details.push(`${formatNumber(distance)} m`);
  if (duration > 0) details.push(`${formatNumber(duration)} sec`);
  return details.join(" × ") || "Set";
}

async function convertWorkout(workout) {
  const start = validDate(workout.start_time, "workout start time");
  const end = validDate(workout.end_time, "workout end time");
  const timeZone = timezoneInput.value.trim() || "UTC";
  const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
  const description = [];
  let setCount = 0;
  let kilogramsLifted = 0;

  if (workout.description?.trim()) description.push(workout.description.trim());
  for (const exercise of exercises) {
    const lines = [exercise.title || "Exercise"];
    if (exercise.notes?.trim()) lines.push(exercise.notes.trim());
    const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
    setCount += sets.length;
    for (const set of sets) {
      const weight = numberValue(set.weight_kg);
      const reps = numberValue(set.reps);
      kilogramsLifted += weight * reps;
      lines.push(setDescription(set));
    }
    description.push(lines.join("\n"));
  }

  const elapsedSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const id = await sha256(`hevy:${workout.id}`);
  return {
    activity: {
      id,
      external_id: id,
      name: workout.title || "Hevy workout",
      description: description.join("\n\n"),
      start_date_local: formatLocalIso(start, timeZone),
      start_date: start.toISOString().replace(".000Z", "Z"),
      timezone: timeZone,
      elapsed_time: elapsedSeconds,
      moving_time: elapsedSeconds,
      distance: 0,
      type: "WeightTraining",
      kg_lifted: kilogramsLifted,
      source: "MANUAL"
    },
    setCount
  };
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const data = JSON.parse(text);
        if (typeof data === "string") {
          detail = data;
        } else if (data && typeof data === "object") {
          const candidate = data.message || data.error || data.detail;
          detail = typeof candidate === "string" ? candidate : candidate ? JSON.stringify(candidate) : text;
        }
      } catch (error) {}
      throw new Error(`Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${detail ? `: ${detail.slice(0, 400)}` : ""}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch (error) {
      throw new Error("The API returned an invalid JSON response.");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function selectedActivities() {
  return currentWorkouts
    .filter((workout) => selectedWorkoutIds.has(workout.id))
    .map((workout) => currentActivities.get(workout.id).activity);
}

function updateControls() {
  const hasWorkouts = currentWorkouts.length > 0;
  const selectedCount = selectedWorkoutIds.size;
  const firstPage = currentPage <= 1;
  const lastPage = currentPage <= 0 || currentPage >= pageCount;
  const busy = isFetching || isUploading;

  fetchButton.disabled = busy;
  firstPageButton.disabled = busy || firstPage;
  previousPageButton.disabled = busy || firstPage;
  nextPageButton.disabled = busy || lastPage;
  lastPageButton.disabled = busy || lastPage;
  selectAllCheckbox.disabled = !hasWorkouts || busy;
  workoutList.querySelectorAll(".workout-selection input").forEach((checkbox) => {
    checkbox.disabled = busy;
  });
  selectAllCheckbox.checked = hasWorkouts && selectedCount === currentWorkouts.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < currentWorkouts.length;
  downloadButton.disabled = selectedCount === 0 || busy;
  uploadButton.disabled = selectedCount === 0 || busy;
  resultCount.textContent = currentPage > 0
    ? `${currentWorkouts.length} workout${currentWorkouts.length === 1 ? "" : "s"} · ${selectedCount} selected`
    : "No workouts loaded";
  pageStatus.textContent = `Page ${currentPage} of ${pageCount}`;
}

function showEmpty(message) {
  workoutList.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = message;
  workoutList.append(empty);
}

function renderWorkouts() {
  workoutList.innerHTML = "";
  if (currentWorkouts.length === 0) {
    showEmpty("No workouts on this page.");
    updateControls();
    return;
  }

  for (const workout of currentWorkouts) {
    const converted = currentActivities.get(workout.id);
    const activity = converted.activity;
    const row = document.createElement("article");
    row.className = "workout-row";

    const selection = document.createElement("label");
    selection.className = "workout-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedWorkoutIds.has(workout.id);
    checkbox.setAttribute("aria-label", `Select ${workout.title || "Hevy workout"}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedWorkoutIds.add(workout.id);
      else selectedWorkoutIds.delete(workout.id);
      updateControls();
    });
    selection.append(checkbox);

    const name = document.createElement("div");
    const title = document.createElement("div");
    title.className = "workout-name";
    title.textContent = workout.title || "Hevy workout";
    const meta = document.createElement("div");
    meta.className = "workout-meta";
    meta.textContent = workout.exercises?.length
      ? `${workout.exercises.length} exercise${workout.exercises.length === 1 ? "" : "s"}`
      : "No exercises";
    name.append(title, meta);

    const date = document.createElement("div");
    date.className = "date workout-meta";
    date.textContent = activity.start_date_local.replace("T", " ");

    const sets = document.createElement("div");
    sets.className = "sets workout-meta";
    sets.textContent = `${converted.setCount} set${converted.setCount === 1 ? "" : "s"}`;

    const lifted = document.createElement("div");
    lifted.className = "workout-number";
    lifted.textContent = `${formatNumber(activity.kg_lifted)} kg`;

    const view = document.createElement("button");
    view.type = "button";
    view.textContent = "View JSON";
    view.addEventListener("click", () => {
      dialogTitle.textContent = activity.name;
      jsonPreview.textContent = JSON.stringify(activity, null, 2);
      jsonDialog.showModal();
    });

    row.append(selection, name, date, sets, lifted, view);
    workoutList.append(row);
  }
  updateControls();
}

async function loadPage(requestedPage) {
  const key = hevyApiKeyInput.value.trim();
  if (!key) {
    setStatus("Hevy key required", "error");
    showWarning("Enter your Hevy API key to fetch workouts.");
    return;
  }

  isFetching = true;
  updateControls();
  setStatus("Fetching");
  showWarning("");

  try {
    const query = new URLSearchParams({ page: String(requestedPage), pageSize: String(PAGE_SIZE) });
    const data = await fetchJson(`https://api.hevyapp.com/v1/workouts?${query}`, {
      headers: { "api-key": key }
    });
    if (!data || !Array.isArray(data.workouts) || !Number.isInteger(data.page) || !Number.isInteger(data.page_count)) {
      throw new Error("Hevy returned an unexpected paginated workouts response.");
    }

    const activities = await Promise.all(data.workouts.map(async (workout) => {
      if (!workout || typeof workout.id !== "string" || !workout.id) {
        throw new Error("Hevy returned a workout without an ID.");
      }
      return [workout.id, await convertWorkout(workout)];
    }));

    currentWorkouts = data.workouts;
    currentActivities = new Map(activities);
    selectedWorkoutIds = new Set();
    currentPage = data.page;
    pageCount = data.page_count;
    renderWorkouts();
    setStatus("Loaded", "success");
  } catch (error) {
    setStatus("Fetch failed", "error");
    showWarning(error.message || "Unable to fetch workouts from Hevy.");
  } finally {
    isFetching = false;
    updateControls();
  }
}

function downloadSelectedActivities() {
  const activities = selectedActivities();
  const blob = new Blob([JSON.stringify(activities, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "intervals_icu_manual_activities.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function uploadSelectedActivities() {
  const key = intervalsApiKeyInput.value.trim();
  if (!key) {
    setStatus("Intervals key required", "error");
    showUploadError("Enter your Intervals.icu API key to upload selected workouts.");
    return;
  }

  const activities = selectedActivities();
  if (activities.length === 0) return;
  const uploadedCount = activities.length;

  isUploading = true;
  updateControls();
  setStatus("Uploading");
  showWarning("");
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch("https://intervals.icu/api/v1/athlete/0/activities/manual/bulk", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`API_KEY:${key}`)}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(activities),
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const error = await responseError(response);
      setStatus("Upload failed", "error");
      showUploadError(error.message, error.responseJson, error.hasResponseJson);
      return;
    }

    setStatus("Uploaded", "success");
    showWarning(`Successfully uploaded ${uploadedCount} workout${uploadedCount === 1 ? "" : "s"} to Intervals.icu.`, "success");
  } catch (error) {
    setStatus("Upload failed", "error");
    showUploadError(requestErrorMessage(error));
  } finally {
    isUploading = false;
    updateControls();
  }
}

fetchButton.addEventListener("click", () => loadPage(1));
firstPageButton.addEventListener("click", () => loadPage(1));
previousPageButton.addEventListener("click", () => loadPage(Math.max(1, currentPage - 1)));
nextPageButton.addEventListener("click", () => loadPage(Math.min(pageCount, currentPage + 1)));
lastPageButton.addEventListener("click", () => loadPage(pageCount));
selectAllCheckbox.addEventListener("change", () => {
  selectedWorkoutIds = selectAllCheckbox.checked
    ? new Set(currentWorkouts.map((workout) => workout.id))
    : new Set();
  renderWorkouts();
});
downloadButton.addEventListener("click", downloadSelectedActivities);
uploadButton.addEventListener("click", uploadSelectedActivities);
document.querySelector("#closeDialog").addEventListener("click", () => jsonDialog.close());
document.querySelector("#closeUploadErrorDialog").addEventListener("click", () => uploadErrorDialog.close());
showUploadErrorJsonButton.addEventListener("click", () => {
  if (!uploadErrorHasJson) return;
  uploadErrorDialog.close();
  dialogTitle.textContent = "Upload error response";
  jsonPreview.textContent = JSON.stringify(uploadErrorResponseJson, null, 2);
  jsonDialog.showModal();
});

showEmpty("Enter your Hevy API key and select Fetch to load workouts.");
updateControls();
