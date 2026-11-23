#!/usr/bin/env python3
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
WWWROOT_DIR = REPO_ROOT / "wwwroot"
APP_DIR = REPO_ROOT / "wwwroot" / "apifeed"
LANDING_HTML = (WWWROOT_DIR / "index.html").read_text(encoding="utf-8")
HTML = (APP_DIR / "index.html").read_text(encoding="utf-8")
HELP_HTML = (APP_DIR / "help.html").read_text(encoding="utf-8")
CSV_HTML = (WWWROOT_DIR / "csvfeed" / "index.html").read_text(encoding="utf-8")
CSS = (APP_DIR / "styles.css").read_text(encoding="utf-8")
JAVASCRIPT = (APP_DIR / "app.js").read_text(encoding="utf-8")


class AppMarkup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.labels = []
        self.assets = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.add(attributes["id"])
        if tag == "label":
            self.labels.append(attributes)
        if tag == "script" and attributes.get("src"):
            self.assets.append(attributes["src"])
        if tag == "link" and attributes.get("rel") == "stylesheet":
            self.assets.append(attributes.get("href"))
        if tag == "a":
            self.links.append(attributes)

    def handle_data(self, data):
        pass


def markup():
    parser = AppMarkup()
    parser.feed(HTML)
    return parser


class ApiAppContractTests(unittest.TestCase):
    def test_all_script_selectors_exist_in_markup(self):
        ids = markup().ids
        selectors = set(re.findall(r'document\.querySelector\("#([^"]+)"\)', JAVASCRIPT))
        self.assertTrue(selectors)
        self.assertEqual(set(), selectors - ids)

    def test_markup_loads_local_assets_and_has_separate_api_keys(self):
        parsed = markup()
        for asset in parsed.assets:
            self.assertTrue((APP_DIR / asset).is_file(), asset)
        self.assertIn('id="hevyApiKey"', HTML)
        self.assertIn('id="intervalsApiKey"', HTML)
        self.assertIn("Hevy API key", HTML)
        self.assertIn("Intervals.icu API key", HTML)

    def test_feed_notice_is_between_header_and_app_grid(self):
        notice = (
            "CSV Feed and API Feed use different activity id's and so will appear as different workouts if both are used."
        )
        self.assertIn(notice, HTML)
        self.assertRegex(HTML, re.compile(r"</header>\s*<aside class=\"feed-notice\" role=\"note\">.*?</aside>\s*<section class=\"grid\">", re.S))
        self.assertIn(".feed-notice", CSS)

    def test_csv_source_is_absent_from_api_version(self):
        self.assertNotIn('type="file"', HTML)
        self.assertNotIn("csvFile", JAVASCRIPT)
        self.assertNotIn("parseCsv", JAVASCRIPT)
        self.assertIn('id="fetchButton"', HTML)
        self.assertIn(">Fetch</button>", HTML)

    def test_hevy_request_uses_documented_endpoint_auth_and_page_size(self):
        self.assertIn("const PAGE_SIZE = 10;", JAVASCRIPT)
        self.assertIn("https://api.hevyapp.com/v1/workouts?", JAVASCRIPT)
        self.assertIn("new URLSearchParams({ page: String(requestedPage), pageSize: String(PAGE_SIZE) })", JAVASCRIPT)
        self.assertIn('headers: { "api-key": key }', JAVASCRIPT)

    def test_page_response_shape_is_validated_and_displayed(self):
        self.assertIn("Array.isArray(data.workouts)", JAVASCRIPT)
        self.assertIn("Number.isInteger(data.page)", JAVASCRIPT)
        self.assertIn("Number.isInteger(data.page_count)", JAVASCRIPT)
        self.assertIn("Page ${currentPage} of ${pageCount}", JAVASCRIPT)

    def test_api_feed_uses_source_id_as_external_id_without_setting_intervals_id(self):
        convert = JAVASCRIPT.split("function convertWorkout", 1)[1].split(
            "async function fetchJson", 1
        )[0]
        self.assertIn("external_id: workout.id", convert)
        self.assertNotRegex(convert, re.compile(r"^\s*id\s*:", re.M))
        self.assertNotIn("sha256", JAVASCRIPT)

    def test_all_four_page_controls_have_boundary_logic(self):
        for element_id in ("firstPageButton", "previousPageButton", "nextPageButton", "lastPageButton"):
            self.assertIn(f'querySelector("#{element_id}")', JAVASCRIPT)
        self.assertIn("const firstPage = currentPage <= 1;", JAVASCRIPT)
        self.assertIn("const lastPage = currentPage <= 0 || currentPage >= pageCount;", JAVASCRIPT)
        self.assertIn("firstPageButton.disabled = busy || firstPage;", JAVASCRIPT)
        self.assertIn("previousPageButton.disabled = busy || firstPage;", JAVASCRIPT)
        self.assertIn("nextPageButton.disabled = busy || lastPage;", JAVASCRIPT)
        self.assertIn("lastPageButton.disabled = busy || lastPage;", JAVASCRIPT)

    def test_selection_and_upload_are_limited_to_current_page(self):
        self.assertIn("let selectedWorkoutIds = new Set();", JAVASCRIPT)
        self.assertRegex(
            JAVASCRIPT,
            re.compile(r"function selectedActivities\(\)\s*\{\s*return currentWorkouts\s*\.filter", re.S),
        )
        self.assertIn("selectedWorkoutIds = new Set();", JAVASCRIPT)
        self.assertIn("selectAllCheckbox.indeterminate", JAVASCRIPT)
        self.assertIn("body: JSON.stringify(activities)", JAVASCRIPT)
        self.assertIn("uploadButton.disabled = selectedCount === 0 || busy;", JAVASCRIPT)

    def test_action_menu_updates_button_and_offers_upload_or_delete(self):
        self.assertIn('<select id="actionSelect">', HTML)
        self.assertIn('<option value="upload">Upload</option>', HTML)
        self.assertIn('<option value="delete">Delete</option>', HTML)
        self.assertIn('actionSelect.addEventListener("change", updateControls);', JAVASCRIPT)
        self.assertIn('"Delete selected from intervals.icu"', JAVASCRIPT)
        self.assertIn('"Upload selected to intervals.icu"', JAVASCRIPT)

    def test_upload_reports_count_or_actionable_failure_without_response_json(self):
        upload = JAVASCRIPT.split("async function uploadSelectedActivities()", 1)[1].split(
            'fetchButton.addEventListener("click"', 1
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

    def test_delete_uses_current_page_selection_and_safe_external_id_lookup(self):
        delete = JAVASCRIPT.split("async function deleteSelectedActivities", 1)[1].split(
            "async function uploadSelectedActivities()", 1
        )[0]
        self.assertIn("window.confirm(", delete)
        self.assertIn("currentActivities.get(workout.id).activity", delete)
        self.assertIn("findMatchingIntervalsActivities(activities, key)", delete)
        self.assertIn('fields: "id,external_id"', JAVASCRIPT)
        self.assertIn("selectedByExternalId.has(candidate.external_id)", JAVASCRIPT)
        self.assertIn("found.length > 1", JAVASCRIPT)
        self.assertIn('{ method: "DELETE" }', delete)
        self.assertIn("selectedWorkoutIds = new Set([...selectedWorkoutIds].filter((id) => !selectedIds.has(id)));", delete)
        self.assertIn('showActionError("delete"', delete)
        self.assertNotIn("currentWorkouts = currentWorkouts.filter", delete)
        no_match = delete.split("if (matches.length === 0)", 1)[1].split("const failures", 1)[0]
        self.assertIn('setStatus("Delete complete", "success")', no_match)
        self.assertIn('showWarning("Delete complete. Deleted 0 workouts', no_match)
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

    def test_external_requests_have_a_finite_timeout(self):
        self.assertIn("const REQUEST_TIMEOUT_MS = 15000;", JAVASCRIPT)
        self.assertIn("new AbortController()", JAVASCRIPT)
        self.assertIn("controller.abort()", JAVASCRIPT)
        self.assertIn("window.clearTimeout(timeoutId)", JAVASCRIPT)

    def test_api_app_has_selection_and_pagination_styles(self):
        self.assertIn(".pagination", CSS)
        self.assertIn(".workout-header", CSS)
        self.assertIn(".workout-selection", CSS)
        self.assertIn("grid-template-columns:", CSS)

    def test_wwwroot_landing_page_links_to_both_app_versions(self):
        parser = AppMarkup()
        parser.feed(LANDING_HTML)
        links = re.findall(r'<a\b[^>]*href="([^"]+)"', LANDING_HTML)
        self.assertIn("csvfeed/index.html", links)
        self.assertIn("apifeed/index.html", links)
        self.assertIn('aria-label="Choose app version"', LANDING_HTML)
        self.assertIn("border-radius: 6px", LANDING_HTML)
        self.assertIn('"Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif', LANDING_HTML)
        self.assertNotIn("Georgia, serif", LANDING_HTML)

    def test_both_app_pages_have_back_links_to_landing_page(self):
        for app_html in (HTML, CSV_HTML):
            self.assertRegex(app_html, r'<a\b[^>]*class="back-link"[^>]*href="\.\./index\.html"[^>]*>Back</a>')

    def test_api_app_help_link_opens_separate_tab(self):
        links = markup().links
        help_link = next(link for link in links if link.get("href") == "help.html")
        self.assertEqual("_blank", help_link.get("target"))
        self.assertIn("noopener", help_link.get("rel", ""))
        self.assertTrue((APP_DIR / help_link["href"]).is_file())

    def test_help_page_explains_keys_and_app_workflow(self):
        parser = AppMarkup()
        parser.feed(HELP_HTML)
        self.assertTrue((APP_DIR / "styles.css").is_file())
        self.assertIn("https://developers.hevy.com/docs", HELP_HTML)
        self.assertIn("does not document a self-service key-generation location", HELP_HTML)
        self.assertIn("Intervals.icu API key", HELP_HTML)
        self.assertIn("Select all", HELP_HTML)
        self.assertIn("current page", HELP_HTML)
        self.assertIn("cross-origin", HELP_HTML)
        self.assertIn("cannot be undone", HELP_HTML)


if __name__ == "__main__":
    unittest.main(verbosity=2)
