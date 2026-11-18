# Contributing

## Development

The app is plain HTML, CSS, and JavaScript. Open `index.html` in a browser or serve the folder with any static HTTP server.

## Changes

- Keep API payload behavior aligned with `schema.json`.
- Do not include workout exports, API keys, athlete IDs, or generated JSON in commits.
- Test conversion using `examples/hevy-export.csv` or a local export placed under `data/`.
- Keep the app dependency-free unless a new dependency is clearly justified.

## API specification

Refresh `schema.json` from the Intervals.icu API specification:

```sh
curl -fsSL https://intervals.icu/api/v1/docs -o schema.json
```

Do not commit a specification from an unrelated or unofficial source.
