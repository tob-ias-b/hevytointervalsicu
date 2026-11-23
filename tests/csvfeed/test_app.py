#!/usr/bin/env python3
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
APP_DIR = REPO_ROOT / "wwwroot" / "csvfeed"
HTML = (APP_DIR / "index.html").read_text(encoding="utf-8")
HELP_HTML = (APP_DIR / "help.html").read_text(encoding="utf-8")
CSS = (APP_DIR / "styles.css").read_text(encoding="utf-8")
JAVASCRIPT = (APP_DIR / "app.js").read_text(encoding="utf-8")


class AppMarkup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.assets = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.add(attributes["id"])
        if tag == "script" and attributes.get("src"):
            self.assets.append(attributes["src"])
        if tag == "link" and attributes.get("rel") == "stylesheet":
            self.assets.append(attributes.get("href"))
        if tag == "a":
            self.links.append(attributes)


class CsvAppSelectionTests(unittest.TestCase):
    def test_script_selectors_exist_and_local_assets_are_present(self):
        parser = AppMarkup()
        parser.feed(HTML)
        selectors = set(re.findall(r'document\.querySelector\("#([^"]+)"\)', JAVASCRIPT))
        self.assertTrue(selectors)
        self.assertEqual(set(), selectors - parser.ids)
        for asset in parser.assets:
            self.assertTrue((APP_DIR / asset).is_file(), asset)

    def test_workout_rows_have_individual_checkboxes_and_select_all(self):
        self.assertIn('id="selectAllCheckbox"', HTML)
        self.assertIn("Select all", HTML)
        self.assertIn('id="uploadButton"', HTML)
        self.assertIn("Upload selected to intervals.icu", HTML)
        self.assertIn('selection.className = "workout-selection";', JAVASCRIPT)
        self.assertIn('checkbox.type = "checkbox";', JAVASCRIPT)
        self.assertIn('checkbox.setAttribute("aria-label", `Select ${activity.name}`);', JAVASCRIPT)

    def test_action_menu_updates_button_and_offers_upload_or_delete(self):
        self.assertIn('<select id="actionSelect">', HTML)
        self.assertIn('<option value="upload">Upload</option>', HTML)
        self.assertIn('<option value="delete">Delete</option>', HTML)
        self.assertIn('actionSelect.addEventListener("change", updateSelectionControls);', JAVASCRIPT)
        self.assertIn('"Delete selected from intervals.icu"', JAVASCRIPT)
        self.assertIn('"Upload selected to intervals.icu"', JAVASCRIPT)

    def test_selection_state_updates_header_count_and_upload_availability(self):
        self.assertIn("let selectedActivityIds = new Set();", JAVASCRIPT)
        self.assertIn("selectedActivityIds.add(activity.id)", JAVASCRIPT)
        self.assertIn("selectedActivityIds.delete(activity.id)", JAVASCRIPT)
        self.assertIn("selectAllCheckbox.indeterminate", JAVASCRIPT)
        self.assertIn("uploadButton.disabled = selectedCount === 0;", JAVASCRIPT)
        self.assertRegex(JAVASCRIPT, re.compile(r"selectedActivityIds = new Set\(\);\s*renderActivities\(activities\)", re.S))

    def test_select_all_selects_or_clears_all_converted_activities(self):
        self.assertRegex(
            JAVASCRIPT,
            re.compile(
                r'selectAllCheckbox\.addEventListener\("change", \(\) => \{\s*'
                r'selectedActivityIds = selectAllCheckbox\.checked\s*\?\s*'
                r'new Set\(activities\.map\(\(activity\) => activity\.id\)\)\s*:\s*'
                r'new Set\(\);',
                re.S,
            ),
        )

    def test_upload_body_contains_only_selected_activities(self):
        self.assertIn(
            "const selectedActivities = activities.filter((activity) => selectedActivityIds.has(activity.id));",
            JAVASCRIPT,
        )
        self.assertIn("if (selectedActivities.length === 0) return;", JAVASCRIPT)
        self.assertIn("body: JSON.stringify(selectedActivities)", JAVASCRIPT)
        self.assertNotIn("body: JSON.stringify(activities)", JAVASCRIPT)

    def test_upload_reports_count_or_actionable_failure_without_response_json(self):
        upload = JAVASCRIPT.split('uploadButton.addEventListener("click"', 1)[1].split(
            'document.querySelector("#closeDialog")', 1
        )[0]
        self.assertIn("Successfully uploaded ${uploadedCount} workout", upload)
        self.assertIn('showActionError("upload", actionRequestErrorMessage(error))', upload)
        self.assertIn("Intervals.icu returned HTTP ${status}${suffix}", JAVASCRIPT)
        self.assertNotIn("jsonDialog.showModal()", upload)
        self.assertNotIn("jsonPreview.textContent", upload)

    def test_upload_error_dialog_shows_json_button_only_for_json_responses(self):
        self.assertIn('id="uploadErrorDialog"', HTML)
        self.assertIn('id="uploadErrorMessage"', HTML)
        self.assertIn('id="showUploadErrorJsonButton"', HTML)
        self.assertIn('type="button" hidden>Show response JSON</button>', HTML)
        self.assertIn("let hasResponseJson = false;", JAVASCRIPT)
        self.assertIn("hasResponseJson = true;", JAVASCRIPT)
        self.assertIn("showUploadErrorJsonButton.hidden = !hasResponseJson;", JAVASCRIPT)
        self.assertIn("if (!uploadErrorHasJson) return;", JAVASCRIPT)
        self.assertIn("uploadErrorResponseJson = responseJson;", JAVASCRIPT)
        self.assertIn('dialogTitle.textContent = `${uploadErrorAction === "delete" ? "Delete" : "Upload"} error response`;', JAVASCRIPT)

    def test_delete_uses_selected_workouts_and_safe_external_id_lookup(self):
        delete = JAVASCRIPT.split("async function deleteSelectedActivities", 1)[1].split(
            'uploadButton.addEventListener("click"', 1
        )[0]
        self.assertIn("window.confirm(", delete)
        self.assertIn("findMatchingIntervalsActivities(selectedActivities, key)", delete)
        self.assertIn('fields: "id,external_id"', JAVASCRIPT)
        self.assertIn("selectedByExternalId.has(candidate.external_id)", JAVASCRIPT)
        self.assertIn("found.length > 1", JAVASCRIPT)
        self.assertIn('{ method: "DELETE" }', delete)
        self.assertIn("activities.filter((activity) => selectedActivityIds.has(activity.id))", JAVASCRIPT)
        self.assertIn('showActionError("delete"', delete)
        self.assertNotIn("activities = activities.filter", delete)
        no_match = delete.split("if (matches.length === 0)", 1)[1].split("const failures", 1)[0]
        self.assertIn('setStatus("Delete complete", "success")', no_match)
        self.assertIn('showUploadMessage("Delete complete. Deleted 0 workouts', no_match)
        self.assertNotIn('"error"', no_match)
        self.assertNotIn("missingCount", delete)
        self.assertNotIn("no matching Intervals.icu activity", delete)

    def test_delete_lookup_uses_selected_date_range_in_one_request(self):
        lookup = JAVASCRIPT.split("async function findMatchingIntervalsActivities", 1)[1].split(
            "async function deleteSelectedActivities", 1
        )[0]
        self.assertIn("const dates = [];", lookup)
        self.assertIn("dates.sort();", lookup)
        self.assertIn("const oldest = dates[0];", lookup)
        self.assertIn("const newest = dateAfter(dates[dates.length - 1]);", lookup)
        self.assertIn('oldest: `${oldest}T00:00:00`', lookup)
        self.assertIn('newest: `${newest}T00:00:00`', lookup)
        self.assertEqual(1, lookup.count("await intervalsRequest("))
        self.assertNotIn("for (const [date", lookup)

    def test_selection_header_and_rows_share_responsive_grid(self):
        self.assertIn(".workout-header", CSS)
        self.assertIn(".workout-selection", CSS)
        self.assertIn("grid-template-columns: 105px", CSS)

    def test_csv_app_help_link_opens_separate_tab(self):
        parser = AppMarkup()
        parser.feed(HTML)
        help_link = next(link for link in parser.links if link.get("href") == "help.html")
        self.assertEqual("_blank", help_link.get("target"))
        self.assertIn("noopener", help_link.get("rel", ""))
        self.assertTrue((APP_DIR / help_link["href"]).is_file())

    def test_csv_help_covers_export_and_app_workflow(self):
        self.assertIn("https://help.hevyapp.com/hc/en-us/articles/43708290987415-Exporting-Your-Data-from-Hevy", HELP_HTML)
        self.assertIn("Profile → Settings → Export &amp; Import Data → Export Data", HELP_HTML)
        self.assertIn("Export Workouts", HELP_HTML)
        for field in ("title", "start_time", "end_time", "exercise_title"):
            self.assertIn(f"<code>{field}</code>", HELP_HTML)
        self.assertIn("Action", HELP_HTML)
        self.assertIn("Delete", HELP_HTML)
        self.assertIn("cannot be undone", HELP_HTML)
        self.assertIn("Download JSON", HELP_HTML)


if __name__ == "__main__":
    unittest.main(verbosity=2)
