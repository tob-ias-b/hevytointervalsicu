# Hevy to Intervals.icu

A dependency-free browser tool that converts a Hevy CSV workout export into Intervals.icu manual activities and uploads them through the Intervals.icu API.

The app does not upload FIT, TCX, GPX, or other activity files.

## Features

- Runs entirely in the browser with no package installation.
- Groups CSV rows into workouts by title, start time, and end time.
- Generates stable SHA-256 IDs and `external_id` values.
- Creates a grouped exercise description for each workout.
- Calculates kilograms lifted from `weight_kg × reps`.
- Downloads generated manual activities as JSON.
- Uploads directly to the athlete associated with the API key.

## Run locally

Open `index.html` in a modern browser, or serve the folder with a static HTTP server:

```sh
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

Place a real export in `data/`. That directory is ignored by Git.

## CSV format

The source CSV must contain:

- `title`
- `start_time`
- `end_time`
- `exercise_title`
- `weight_kg`
- `reps`

A synthetic example is included at `examples/hevy-export.csv`.

## Conversion behavior

- ID and `external_id`: SHA-256 of `title + start_time + end_time`.
- Name: source `title`.
- Description: exercises in source order, with repeated set combinations compacted.
- Kilograms lifted: sum of `weight_kg × reps` for each workout.
- Start date: parsed using the selected timezone.
- Activity type: `WeightTraining`.
- Source: `MANUAL`.

CSV timestamps do not include timezone information. Confirm the timezone before conversion.

## API

The bulk endpoint is:

```text
POST https://intervals.icu/api/v1/athlete/0/activities/manual/bulk
```

Athlete ID `0` uses the athlete associated with the API key.

Authentication uses HTTP Basic authentication with username `API_KEY` and the Intervals.icu API key as the password. The key remains in the current browser tab and is never written to the generated JSON or to repository files.

## API specification

`schema.json` is the Intervals.icu OpenAPI 3.0.1 specification from `https://intervals.icu/api/v1/docs`.

Future payload and endpoint changes should be based on:

- `paths` for endpoints and HTTP methods.
- `components.schemas.Activity` for manual activity fields.
- `components.securitySchemes.APIKey` for authentication.
- `components.schemas.Activity.source` and other enum definitions.

Refresh it with:

```sh
curl -fsSL https://intervals.icu/api/v1/docs -o schema.json
```

## Privacy

Do not commit personal CSV exports, API keys, generated JSON, or other athlete data. The repository ignores `data/` and generated export files.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance.
