# Hevy to Intervals.icu

A dependency-free browser tool for converting Hevy workouts into Intervals.icu manual activities. It offers two equally supported versions: CSV Feed imports a Hevy workout export, while API Feed fetches workouts directly from Hevy.

The app does not upload FIT, TCX, GPX, or other activity files.

## Features

- Runs entirely in the browser with no package installation.
- Supports CSV import and direct Hevy API access.
- Generates stable SHA-256 IDs and `external_id` values.
- Creates a grouped exercise description for each workout.
- Calculates kilograms lifted from `weight_kg × reps`.
- Downloads generated manual activities as JSON.
- Lets you select workouts before uploading them to Intervals.icu.

## Run locally

Open `wwwroot/index.html` in a modern browser, or serve the web root with a static HTTP server:

```sh
python3 -m http.server 4173 --directory wwwroot
```

Then open `http://127.0.0.1:4173` and choose the CSV or API version.

Both versions can also be opened directly from `wwwroot/csvfeed/` and `wwwroot/apifeed/`.

## CSV Feed

CSV Feed is under `wwwroot/csvfeed/`. Select a Hevy workout export, convert it, then choose which activities to upload. See [CSV format](#csv-format) for required columns.

## API Feed

API Feed is under `wwwroot/apifeed/`. Enter a Hevy API key to fetch workouts and an Intervals.icu API key to upload selected workouts. Workouts are fetched 10 at a time; selections apply to the current page only. The browser must be able to make cross-origin requests to both APIs.

Run the API-version checks with:

```sh
./tests/apifeed/test.sh
```

The script uses Node for an optional JavaScript syntax check when available, then runs the API app contract tests with Python 3. These checks do not contact either API.

## CSV format

The source CSV must contain:

- `title`
- `start_time`
- `end_time`
- `exercise_title`
- `weight_kg`
- `reps`

A synthetic example is included at `examples/hevy-export.csv`.

Run the CSV-version checks with:

```sh
./tests/csvfeed/test.sh
```

The script uses Node for an optional JavaScript syntax check when available, then runs the CSV app contract tests with Python 3. These checks do not contact Intervals.icu.

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
