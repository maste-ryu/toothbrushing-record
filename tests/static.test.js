import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "index.html",
  "report.html",
  "settings.html",
  "css/style.css",
  "css/print.css",
  "js/config.js",
  "js/supabase.js",
  "js/auth.js",
  "js/common.js",
  "js/app.js",
  "js/report.js",
  "js/settings.js",
  "supabase/schema.sql",
  "supabase/migrations/20260915_teacher_delete_today_records.sql",
  "SPEC.md",
  "README.md",
];

for (const file of requiredFiles) {
  assert.equal(statSync(resolve(root, file)).isFile(), true, `missing ${file}`);
}

const read = (file) => readFileSync(resolve(root, file), "utf8");
const indexHtml = read("index.html");
const reportHtml = read("report.html");
const settingsHtml = read("settings.html");
const printCss = read("css/print.css");
const schema = read("supabase/schema.sql");
const allClientSource = [indexHtml, reportHtml, settingsHtml, read("js/config.js"), read("js/supabase.js"), read("js/auth.js"), read("js/app.js"), read("js/report.js"), read("js/settings.js")].join("\n");

function assertReferencedIdsExist(scriptFile, html, htmlFile) {
  const source = read(scriptFile);
  const ids = [...source.matchAll(/querySelector\(["']#([a-zA-Z0-9_-]+)["']\)/g)].map((match) => match[1]);
  for (const id of ids) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${scriptFile} references missing #${id} in ${htmlFile}`);
  }
}

assertReferencedIdsExist("js/app.js", indexHtml, "index.html");
assertReferencedIdsExist("js/report.js", reportHtml, "report.html");
assertReferencedIdsExist("js/settings.js", settingsHtml, "settings.html");

for (const studentNo of [1, 2]) {
  assert.match(indexHtml, new RegExp(`data-student="${studentNo}"`));
}
assert.match(indexHtml, /id="leave-dialog"/);
assert.match(indexHtml, /class="leave-button"[^>]*aria-label="1號今日請假"[^>]*>請假<\/button>/);
assert.match(indexHtml, /class="leave-button"[^>]*aria-label="2號今日請假"[^>]*>請假<\/button>/);
assert.match(indexHtml, /name="username"/);
assert.match(indexHtml, /id="device-username-display"[\s\S]*?>user<\/output>/);
assert.match(indexHtml, /id="device-username"[^>]*type="hidden"[^>]*value="user"/);
assert.doesNotMatch(indexHtml, /id="device-email"/);
assert.match(reportHtml, /id="teacher-login-form"/);
assert.match(reportHtml, /id="summary-student-count"/);
assert.match(reportHtml, /id="summary-not-executed"/);
assert.match(reportHtml, /id="summary-executed"/);
assert.match(reportHtml, /id="summary-execution-rate"/);
for (const approval of ["班級導師", "製表人", "學務組長", "輔導主任", "校長"]) {
  assert.match(reportHtml, new RegExp(approval));
}
assert.match(settingsHtml, /id="report-settings-form"/);
assert.match(settingsHtml, /id="usage-days-form"/);
assert.match(settingsHtml, /id="usage-day-mode"/);
assert.match(settingsHtml, /id="calendar-form"/);
assert.match(settingsHtml, /id="student-profiles-form"/);
assert.match(settingsHtml, /id="today-records-list"/);
assert.match(settingsHtml, /id="correct-record-dialog"/);
assert.match(settingsHtml, /id="confirm-correct-record"/);
assert.match(settingsHtml, /id="student-profile-term"/);
assert.match(settingsHtml, /id="student-number-1"[^>]*min="1"[^>]*max="99"/);
assert.match(settingsHtml, /id="student-number-2"[^>]*min="1"[^>]*max="99"/);
assert.match(settingsHtml, /accept="image\/jpeg,image\/png,image\/webp"/);
const htmlIds = [...settingsHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(htmlIds).size, htmlIds.length, "settings.html contains duplicate ids");
assert.match(printCss, /@page\s*{[^}]*size:\s*A4 landscape/s);
assert.match(printCss, /@media print/);

for (const table of ["app_users", "app_settings", "brushing_records", "school_calendar", "report_settings", "student_profiles"]) {
  assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(schema, /unique \(student_no, record_date\)/);
assert.match(schema, /record_date = private\.taipei_today\(\)/);
assert.match(schema, /private\.is_school_day\(record_date\)/);
assert.match(schema, /usage_day_mode in \('weekdays', 'everyday'\)/);
assert.match(schema, /app_settings_teacher_update/);
assert.match(schema, /grant delete on table public\.brushing_records to authenticated/);
assert.match(schema, /brushing_records_teacher_delete[\s\S]*for delete[\s\S]*private\.has_role\('teacher'\)/);
assert.match(schema, /private\.has_role\('kiosk'\)/);
assert.match(schema, /private\.has_role\('teacher'\)/);
assert.match(schema, /'student-photos',[\s\S]*false,[\s\S]*2097152/);
assert.match(schema, /student_profiles_kiosk_select_current/);
assert.match(schema, /student_photos_kiosk_select_current/);
assert.match(schema, /student_photos_teacher_insert/);
assert.match(schema, /student_profiles_setting_student_key unique \(report_setting_id, student_no\)/);
assert.match(schema, /student_profiles_display_no_check check \(display_no between 1 and 99\)/);

assert.doesNotMatch(allClientSource, /service_role\s*[:=]\s*["']/i);
assert.doesNotMatch(allClientSource, /sb_secret_[a-z0-9_-]{10,}/i);
assert.doesNotMatch(allClientSource, /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}/);
assert.doesNotMatch(allClientSource, /\.innerHTML\s*=/);
assert.match(read("js/config.js"), /KIOSK_LOGIN_USERNAME\s*=\s*"user"/);
assert.match(read("js/config.js"), /KIOSK_AUTH_EMAIL\s*=\s*"user@toothbrushing-record\.invalid"/);
assert.match(read("js/auth.js"), /signInKiosk/);

console.log("static.test.js: all assertions passed");
