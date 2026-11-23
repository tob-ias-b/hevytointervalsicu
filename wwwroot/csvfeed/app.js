"use strict";

const csvFile = document.querySelector("#csvFile");
const timezoneInput = document.querySelector("#timezone");
const apiKey = document.querySelector("#apiKey");
const actionSelect = document.querySelector("#actionSelect");
const convertButton = document.querySelector("#convertButton");
const downloadButton = document.querySelector("#downloadButton");
const uploadButton = document.querySelector("#uploadButton");
const selectAllCheckbox = document.querySelector("#selectAllCheckbox");
const workoutList = document.querySelector("#workoutList");
const resultCount = document.querySelector("#resultCount");
const warnings = document.querySelector("#warnings");
const statusBadge = document.querySelector("#statusBadge");
const jsonDialog = document.querySelector("#jsonDialog");
const jsonPreview = document.querySelector("#jsonPreview");
const dialogTitle = document.querySelector("#dialogTitle");
const uploadErrorDialog = document.querySelector("#uploadErrorDialog");
const uploadErrorMessage = document.querySelector("#uploadErrorMessage");
const uploadErrorTitle = document.querySelector("#uploadErrorTitle");
const showUploadErrorJsonButton = document.querySelector("#showUploadErrorJsonButton");

let activities = [];
let selectedActivityIds = new Set();
let uploadErrorResponseJson = null;
let uploadErrorHasJson = false;
let uploadErrorAction = "upload";

timezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function setStatus(message, type = "") {
  statusBadge.textContent = message;
  statusBadge.className = `status-badge ${type}`.trim();
}

function showUploadMessage(message, type) {
  warnings.textContent = message;
  warnings.className = `warnings ${type}`;
  warnings.hidden = false;
}

function responseError(response, text, responseJson, hasResponseJson) {
  let detail = text;
  if (typeof responseJson === "string") {
    detail = responseJson;
  } else if (responseJson && typeof responseJson === "object") {
    const candidate = responseJson.message || responseJson.error || responseJson.detail;
    detail = typeof candidate === "string" ? candidate : candidate ? JSON.stringify(candidate) : text;
  }
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const suffix = detail ? `: ${detail.slice(0, 400)}` : "";
  return {
    message: `Intervals.icu returned HTTP ${status}${suffix}`,
    responseJson,
    hasResponseJson
  };
}

async function intervalsRequest(url, key, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Basic ${btoa(`API_KEY:${key}`)}`,
        ...options.headers
      },
      signal: controller.signal
    });
    const text = (await response.text()).trim();
    let responseJson = null;
    let hasResponseJson = false;
    if (text) {
      try {
        responseJson = JSON.parse(text);
        hasResponseJson = true;
      } catch (error) {}
    }
    return {
      response,
      text,
      responseJson,
      hasResponseJson
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function showActionError(action, message, responseJson = null, hasResponseJson = false) {
  uploadErrorAction = action;
  uploadErrorResponseJson = responseJson;
  uploadErrorHasJson = hasResponseJson;
  uploadErrorTitle.textContent = `${action === "delete" ? "Delete" : "Upload"} failed`;
  uploadErrorMessage.textContent = message;
  showUploadErrorJsonButton.hidden = !hasResponseJson;
  uploadErrorDialog.showModal();
}

function actionRequestErrorMessage(error) {
  if (error.name === "AbortError") {
    return "The request timed out. Check your connection and try again.";
  }
  if (error instanceof TypeError || /failed to fetch|networkerror/i.test(error.message || "")) {
    return "Could not reach Intervals.icu. Check your connection and whether the API permits browser cross-origin requests.";
  }
  return error.message || "Unable to complete the Intervals.icu request.";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function parseSourceDate(value) {
  const match = /^\s*(\d{1,2}) ([A-Za-z]{3}) (\d{4}), (\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) throw new Error(`Unsupported date format: ${value}`);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames.indexOf(match[2]);
  if (month < 0) throw new Error(`Unsupported month: ${match[2]}`);
  return {
    year: Number(match[3]),
    month,
    day: Number(match[1]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second)
  );
  return Math.round((representedAsUtc - date.getTime()) / 60000);
}

function localDateToUtcIso(local, timeZone) {
  const wallClockUtc = Date.UTC(local.year, local.month, local.day, local.hour, local.minute, 0);
  let utcGuess = wallClockUtc;

  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
    const adjusted = wallClockUtc - offset * 60000;
    if (adjusted === utcGuess) break;
    utcGuess = adjusted;
  }

  return new Date(utcGuess).toISOString().replace(".000Z", "Z");
}

function formatLocalIso(local) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${local.year}-${pad(local.month + 1)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}:00`;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function numberValue(value) {
  if (value === "" || value == null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function compactSetLines(rows) {
  const exerciseMap = [];

  for (const row of rows) {
    let exercise = exerciseMap.find((item) => item.title === row.exercise_title);
    if (!exercise) {
      exercise = { title: row.exercise_title, sets: [] };
      exerciseMap.push(exercise);
    }

    const weight = numberValue(row.weight_kg);
    const reps = numberValue(row.reps);
    const key = `${weight}|${reps}`;
    const existing = exercise.sets.find((set) => set.key === key);
    if (existing) {
      existing.count += 1;
    } else {
      exercise.sets.push({ key, weight, reps, count: 1 });
    }
  }

  return exerciseMap.map((exercise) => {
    const setLines = exercise.sets.map((set) => {
      const weightText = set.weight > 0 ? `${formatNumber(set.weight)} kg × ` : "";
      const repsText = set.reps > 0 ? `${formatNumber(set.reps)} reps` : "bodyweight";
      const countText = set.count > 1 ? ` × ${set.count}` : "";
      return `${weightText}${repsText}${countText}`;
    });
    return `${exercise.title}\n${setLines.join("\n")}`;
  }).join("\n\n");
}

async function convertRows(rows) {
  const workouts = new Map();

  for (const row of rows) {
    const title = (row.title || "").trim();
    const startTime = (row.start_time || "").trim();
    const endTime = (row.end_time || "").trim();
    if (!title || !startTime || !endTime) continue;

    const key = `${title}|${startTime}|${endTime}`;
    if (!workouts.has(key)) workouts.set(key, { title, startTime, endTime, rows: [] });
    workouts.get(key).rows.push(row);
  }

  const timezone = timezoneInput.value.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch (error) {
    throw new Error(`Unknown timezone: ${timezone}`);
  }

  const output = [];
  for (const workout of workouts.values()) {
    const start = parseSourceDate(workout.startTime);
    const end = parseSourceDate(workout.endTime);
    const startUtc = localDateToUtcIso(start, timezone);
    const endUtc = localDateToUtcIso(end, timezone);
    const elapsedSeconds = Math.round((new Date(endUtc).getTime() - new Date(startUtc).getTime()) / 1000);

    const kgLifted = workout.rows.reduce((sum, row) => sum + numberValue(row.weight_kg) * numberValue(row.reps), 0);
    const hash = await sha256(`${workout.title}|${workout.startTime}|${workout.endTime}`);

    output.push({
      id: hash,
      external_id: hash,
      name: workout.title,
      description: compactSetLines(workout.rows),
      start_date_local: formatLocalIso(start),
      start_date: startUtc,
      timezone,
      elapsed_time: Math.max(0, elapsedSeconds),
      moving_time: Math.max(0, elapsedSeconds),
      distance: 0,
      type: "WeightTraining",
      kg_lifted: kgLifted,
      source: "MANUAL"
    });
  }

  return output.sort((a, b) => b.start_date.localeCompare(a.start_date));
}

function renderActivities(items) {
  workoutList.innerHTML = "";

  if (items.length === 0) {
    workoutList.innerHTML = '<div class="empty">No valid workouts found in this CSV.</div>';
    updateSelectionControls();
    return;
  }

  for (const activity of items) {
    const row = document.createElement("article");
    row.className = "workout-row";

    const selection = document.createElement("label");
    selection.className = "workout-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedActivityIds.has(activity.id);
    checkbox.setAttribute("aria-label", `Select ${activity.name}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedActivityIds.add(activity.id);
      else selectedActivityIds.delete(activity.id);
      updateSelectionControls();
    });
    selection.append(checkbox);

    const name = document.createElement("div");
    name.innerHTML = `<div class="workout-name"></div><div class="workout-meta">${activity.description.split("\n\n").length} exercise${activity.description.includes("\n\n") ? "s" : ""}</div>`;
    name.querySelector(".workout-name").textContent = activity.name;

    const date = document.createElement("div");
    date.className = "date workout-meta";
    date.textContent = activity.start_date_local.replace("T", " ");

    const sets = document.createElement("div");
    sets.className = "sets workout-meta";
    const setCount = (activity.description.match(/kg ×|reps|bodyweight/g) || []).length;
    sets.textContent = `${setCount} set groups`;

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

  updateSelectionControls();
}

function updateSelectionControls() {
  const selectedCount = selectedActivityIds.size;
  selectAllCheckbox.disabled = activities.length === 0;
  selectAllCheckbox.checked = activities.length > 0 && selectedCount === activities.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < activities.length;
  uploadButton.disabled = selectedCount === 0;
  uploadButton.textContent = actionSelect.value === "delete"
    ? "Delete selected from intervals.icu"
    : "Upload selected to intervals.icu";
  resultCount.textContent = activities.length > 0
    ? `${activities.length} workout${activities.length === 1 ? "" : "s"} · ${selectedCount} selected`
    : "0 workouts";
}

convertButton.addEventListener("click", async () => {
  if (!csvFile.files.length) {
    setStatus("Choose CSV", "error");
    warnings.hidden = false;
    warnings.textContent = "Choose a Hevy workout_data.csv or compatible CSV export first.";
    return;
  }

  try {
    convertButton.disabled = true;
    setStatus("Converting");
    const text = await csvFile.files[0].text();
    const rows = parseCsv(text);
    const required = ["title", "start_time", "end_time", "exercise_title"];
    const missing = required.filter((header) => !(header in rows[0] || {}));
    if (missing.length) throw new Error(`Missing required CSV columns: ${missing.join(", ")}`);

    activities = await convertRows(rows);
    selectedActivityIds = new Set();
    renderActivities(activities);

    const invalidRows = rows.filter((row) => !row.title || !row.start_time || !row.end_time || !row.exercise_title).length;
    warnings.hidden = invalidRows === 0;
    warnings.textContent = invalidRows ? `${invalidRows} incomplete CSV row(s) were ignored.` : "";

    downloadButton.disabled = activities.length === 0;
    updateSelectionControls();
    setStatus("Converted", "success");
  } catch (error) {
    setStatus("Error", "error");
    warnings.hidden = false;
    warnings.textContent = error.message;
  } finally {
    convertButton.disabled = false;
  }
});

selectAllCheckbox.addEventListener("change", () => {
  selectedActivityIds = selectAllCheckbox.checked
    ? new Set(activities.map((activity) => activity.id))
    : new Set();
  renderActivities(activities);
});

downloadButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(activities, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "intervals_icu_manual_activities.json";
  link.click();
  URL.revokeObjectURL(url);
});

function dateAfter(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function findMatchingIntervalsActivities(selectedActivities, key) {
  const byDate = new Map();
  for (const activity of selectedActivities) {
    const date = activity.start_date_local.slice(0, 10);
    if (!activity.external_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Cannot safely identify the Intervals.icu activity for "${activity.name}".`);
    }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(activity);
  }

  const matches = [];
  for (const [date, dateActivities] of byDate) {
    const query = new URLSearchParams({
      oldest: `${date}T00:00:00`,
      newest: `${dateAfter(date)}T00:00:00`,
      limit: "10000",
      fields: "id,external_id"
    });
    const result = await intervalsRequest(
      `https://intervals.icu/api/v1/athlete/0/activities?${query}`,
      key
    );
    if (!result.response.ok) {
      return { error: responseError(result.response, result.text, result.responseJson, result.hasResponseJson) };
    }
    if (!Array.isArray(result.responseJson)) {
      throw new Error("Intervals.icu returned an unexpected activity-list response while resolving selected workouts.");
    }
    if (result.responseJson.length >= 10000) {
      throw new Error(`Intervals.icu returned 10,000 or more activities for ${date}; refusing to delete without an unambiguous lookup.`);
    }

    for (const activity of dateActivities) {
      const found = result.responseJson.filter((candidate) => candidate.external_id === activity.external_id);
      if (found.length > 1) {
        throw new Error(`More than one Intervals.icu activity matches "${activity.name}". No workouts were deleted.`);
      }
      if (found.length === 1) {
        if (typeof found[0].id !== "string" || !found[0].id) {
          throw new Error(`The matching Intervals.icu activity for "${activity.name}" has no usable ID.`);
        }
        matches.push({ sourceActivity: activity, intervalsId: found[0].id });
      }
    }
  }
  return { matches };
}

async function deleteSelectedActivities(selectedActivities, key) {
  const count = selectedActivities.length;
  if (!window.confirm(`Permanently delete ${count} selected workout${count === 1 ? "" : "s"} from Intervals.icu? This cannot be undone.`)) {
    return;
  }

  uploadButton.disabled = true;
  actionSelect.disabled = true;
  setStatus("Finding activities");
  showUploadMessage("", "");
  const deleted = [];
  try {
    const lookup = await findMatchingIntervalsActivities(selectedActivities, key);
    if (lookup.error) {
      setStatus("Delete failed", "error");
      showActionError("delete", lookup.error.message, lookup.error.responseJson, lookup.error.hasResponseJson);
      return;
    }

    const matches = lookup.matches;
    if (matches.length === 0) {
      for (const activity of selectedActivities) selectedActivityIds.delete(activity.id);
      updateSelectionControls();
      setStatus("Delete complete", "success");
      showUploadMessage("Delete complete. Deleted 0 workouts from Intervals.icu.", "success");
      return;
    }

    const failures = [];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      setStatus(`Deleting ${index + 1}/${matches.length}`);
      try {
        const result = await intervalsRequest(
          `https://intervals.icu/api/v1/activity/${encodeURIComponent(match.intervalsId)}`,
          key,
          { method: "DELETE" }
        );
        if (!result.response.ok) {
          failures.push(responseError(result.response, result.text, result.responseJson, result.hasResponseJson));
        } else {
          deleted.push(match.sourceActivity);
        }
      } catch (error) {
        failures.push({
          message: actionRequestErrorMessage(error),
          responseJson: null,
          hasResponseJson: false
        });
      }
    }

    for (const activity of selectedActivities) selectedActivityIds.delete(activity.id);
    updateSelectionControls();

    if (failures.length > 0) {
      const message = `Deleted ${deleted.length} matching workout${deleted.length === 1 ? "" : "s"}. ${failures.length} deletion${failures.length === 1 ? "" : "s"} failed. ${failures[0].message}`;
      setStatus("Delete failed", "error");
      showActionError("delete", message, failures[0].responseJson, failures[0].hasResponseJson);
      return;
    }

    setStatus("Deleted", "success");
    showUploadMessage(`Deleted ${deleted.length} workout${deleted.length === 1 ? "" : "s"} from Intervals.icu.`, "success");
  } catch (error) {
    setStatus("Delete failed", "error");
    showActionError("delete", actionRequestErrorMessage(error));
  } finally {
    actionSelect.disabled = false;
    updateSelectionControls();
  }
}

uploadButton.addEventListener("click", async () => {
  const key = apiKey.value.trim();
  const action = actionSelect.value;
  if (!key) {
    setStatus("API key", "error");
    showActionError(action, `Enter your Intervals.icu API key to ${action} selected workouts.`);
    return;
  }

  const selectedActivities = activities.filter((activity) => selectedActivityIds.has(activity.id));
  if (selectedActivities.length === 0) return;
  if (action === "delete") {
    await deleteSelectedActivities(selectedActivities, key);
    return;
  }
  const uploadedCount = selectedActivities.length;

  try {
    uploadButton.disabled = true;
    actionSelect.disabled = true;
    setStatus("Uploading");

    const result = await intervalsRequest("https://intervals.icu/api/v1/athlete/0/activities/manual/bulk", key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selectedActivities)
    });

    if (!result.response.ok) {
      const error = responseError(result.response, result.text, result.responseJson, result.hasResponseJson);
      setStatus("Upload failed", "error");
      showActionError("upload", error.message, error.responseJson, error.hasResponseJson);
      return;
    }

    setStatus("Uploaded", "success");
    showUploadMessage(`Successfully uploaded ${uploadedCount} workout${uploadedCount === 1 ? "" : "s"} to Intervals.icu.`, "success");
  } catch (error) {
    setStatus("Upload failed", "error");
    showActionError("upload", actionRequestErrorMessage(error));
  } finally {
    actionSelect.disabled = false;
    updateSelectionControls();
  }
});

actionSelect.addEventListener("change", updateSelectionControls);

document.querySelector("#closeDialog").addEventListener("click", () => jsonDialog.close());
document.querySelector("#closeUploadErrorDialog").addEventListener("click", () => uploadErrorDialog.close());
showUploadErrorJsonButton.addEventListener("click", () => {
  if (!uploadErrorHasJson) return;
  uploadErrorDialog.close();
  dialogTitle.textContent = `${uploadErrorAction === "delete" ? "Delete" : "Upload"} error response`;
  jsonPreview.textContent = JSON.stringify(uploadErrorResponseJson, null, 2);
  jsonDialog.showModal();
});
