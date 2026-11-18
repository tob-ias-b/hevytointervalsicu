"use strict";

const csvFile = document.querySelector("#csvFile");
const timezoneInput = document.querySelector("#timezone");
const apiKey = document.querySelector("#apiKey");
const convertButton = document.querySelector("#convertButton");
const downloadButton = document.querySelector("#downloadButton");
const uploadButton = document.querySelector("#uploadButton");
const workoutList = document.querySelector("#workoutList");
const resultCount = document.querySelector("#resultCount");
const warnings = document.querySelector("#warnings");
const statusBadge = document.querySelector("#statusBadge");
const jsonDialog = document.querySelector("#jsonDialog");
const jsonPreview = document.querySelector("#jsonPreview");
const dialogTitle = document.querySelector("#dialogTitle");

let activities = [];

timezoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function setStatus(message, type = "") {
  statusBadge.textContent = message;
  statusBadge.className = `status-badge ${type}`.trim();
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
    return;
  }

  for (const activity of items) {
    const row = document.createElement("article");
    row.className = "workout-row";

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

    row.append(name, date, sets, lifted, view);
    workoutList.append(row);
  }
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
    renderActivities(activities);

    const invalidRows = rows.filter((row) => !row.title || !row.start_time || !row.end_time || !row.exercise_title).length;
    warnings.hidden = invalidRows === 0;
    warnings.textContent = invalidRows ? `${invalidRows} incomplete CSV row(s) were ignored.` : "";

    resultCount.textContent = `${activities.length} workout${activities.length === 1 ? "" : "s"}`;
    downloadButton.disabled = activities.length === 0;
    uploadButton.disabled = activities.length === 0;
    setStatus("Converted", "success");
  } catch (error) {
    setStatus("Error", "error");
    warnings.hidden = false;
    warnings.textContent = error.message;
  } finally {
    convertButton.disabled = false;
  }
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

uploadButton.addEventListener("click", async () => {
  const key = apiKey.value.trim();
  if (!key) {
    setStatus("API key", "error");
    return;
  }

  try {
    uploadButton.disabled = true;
    setStatus("Uploading");

    const response = await fetch("https://intervals.icu/api/v1/athlete/0/activities/manual/bulk", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`API_KEY:${key}`)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(activities)
    });

    const text = await response.text();
    if (!response.ok) throw new Error(text || `Upload failed (${response.status})`);

    let data = text;
    try { data = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}
    setStatus("Uploaded", "success");
    dialogTitle.textContent = "Upload response";
    jsonPreview.textContent = data;
    jsonDialog.showModal();
  } catch (error) {
    setStatus("Upload failed", "error");
    warnings.hidden = false;
    warnings.textContent = error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

document.querySelector("#closeDialog").addEventListener("click", () => jsonDialog.close());
