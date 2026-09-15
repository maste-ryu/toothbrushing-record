import { requireAppRole, signInForRole, signOut } from "./auth.js";
import {
  getMonthBounds,
  getStudentDisplayName,
  getStudentDisplayNumber,
  getTaipeiIsoDate,
  getTaipeiYearMonth,
  getWeekdayLabel,
  parseStudentNumber,
  STUDENT_NUMBERS,
  STUDENT_PHOTO_TYPES,
  validateStudentPhoto,
} from "./common.js";
import { isSupabaseConfigured, teacherClient } from "./supabase.js";

const loginPanel = document.querySelector("#teacher-login");
const loginForm = document.querySelector("#teacher-login-form");
const loginMessage = document.querySelector("#teacher-login-message");
const settingsApp = document.querySelector("#settings-app");
const reportSettingsForm = document.querySelector("#report-settings-form");
const reportSettingsMessage = document.querySelector("#report-settings-message");
const reportSettingsList = document.querySelector("#report-settings-list");
const usageDaysForm = document.querySelector("#usage-days-form");
const usageDaysMessage = document.querySelector("#usage-days-message");
const usageDayModeSelect = document.querySelector("#usage-day-mode");
const calendarForm = document.querySelector("#calendar-form");
const calendarMessage = document.querySelector("#calendar-message");
const calendarList = document.querySelector("#calendar-list");
const calendarMonth = document.querySelector("#calendar-month");
const studentProfileTerm = document.querySelector("#student-profile-term");
const studentProfilesEmpty = document.querySelector("#student-profiles-empty");
const studentProfilesForm = document.querySelector("#student-profiles-form");
const studentProfilesMessage = document.querySelector("#student-profiles-message");
const todayRecordsList = document.querySelector("#today-records-list");
const todayRecordsMessage = document.querySelector("#today-records-message");
const correctRecordDialog = document.querySelector("#correct-record-dialog");
const correctRecordStudent = document.querySelector("#correct-record-student");
const correctRecordStatus = document.querySelector("#correct-record-status");
const correctRecordDate = document.querySelector("#correct-record-date");
const confirmCorrectRecordButton = document.querySelector("#confirm-correct-record");

let reportSettingsRows = [];
let calendarRows = [];
let usageDayMode = "weekdays";
let studentProfileRows = new Map();
let studentProfileLoadSequence = 0;
let todayRecords = new Map();
let todayRecordProfiles = new Map();
let pendingRecordCorrection = null;
const selectedStudentPhotos = new Map();
const removedStudentPhotos = new Set();
const studentPhotoPreviewUrls = new Map();
const STUDENT_PHOTO_BUCKET = "student-photos";

function setLoginState(showLogin, message = "") {
  loginPanel.hidden = !showLogin;
  settingsApp.hidden = showLogin;
  loginMessage.textContent = message;
  loginMessage.classList.toggle("is-error", Boolean(message));
}

function setFormMessage(element, message = "", isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function makeButton(label, action, id, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `table-button${danger ? " danger" : ""}`;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function makeEmptyRow(columnCount, text) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.className = "empty-row";
  cell.textContent = text;
  row.append(cell);
  return row;
}

function getTodayRecordProfile(studentNo) {
  return todayRecordProfiles.get(studentNo) || { student_no: studentNo, display_no: studentNo, display_name: "" };
}

function renderTodayRecords() {
  todayRecordsList.replaceChildren();
  for (const studentNo of STUDENT_NUMBERS) {
    const profile = getTodayRecordProfile(studentNo);
    const displayNo = getStudentDisplayNumber(studentNo, profile.display_no);
    const displayName = getStudentDisplayName(displayNo, profile.display_name);
    const record = todayRecords.get(studentNo) || null;
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = String(displayNo);
    const name = document.createElement("td");
    name.textContent = displayName;
    const status = document.createElement("td");
    const statusLabel = record?.status === "completed" ? "完成潔牙" : record?.status === "leave" ? "請假" : "未完成";
    status.textContent = statusLabel;
    status.className = `record-status ${record?.status || "incomplete"}`;
    const actions = document.createElement("td");
    actions.className = "table-actions";
    if (record) {
      const button = makeButton("清除紀錄", "correct-today-record", String(studentNo), true);
      button.setAttribute("aria-label", `清除${displayName}，${displayNo}號，今日${statusLabel}紀錄`);
      actions.append(button);
    } else {
      actions.textContent = "—";
    }
    row.append(number, name, status, actions);
    todayRecordsList.append(row);
  }
}

async function loadTodayRecords() {
  const today = getTaipeiIsoDate();
  setFormMessage(todayRecordsMessage, "正在讀取今日紀錄…");
  const currentSetting = reportSettingsRows.find(
    (setting) => setting.effective_start <= today && setting.effective_end >= today,
  );
  const recordsQuery = teacherClient
    .from("brushing_records")
    .select("student_no, status, record_date, recorded_at")
    .eq("record_date", today)
    .order("student_no");
  const profilesQuery = currentSetting
    ? teacherClient
        .from("student_profiles")
        .select("student_no, display_no, display_name")
        .eq("report_setting_id", currentSetting.id)
        .order("student_no")
    : Promise.resolve({ data: [], error: null });
  const [{ data: recordRows, error: recordsError }, { data: profileRows, error: profilesError }] = await Promise.all([
    recordsQuery,
    profilesQuery,
  ]);
  if (recordsError) throw recordsError;
  if (profilesError) throw profilesError;
  todayRecords = new Map((recordRows || []).map((record) => [record.student_no, record]));
  todayRecordProfiles = new Map((profileRows || []).map((profile) => [profile.student_no, profile]));
  renderTodayRecords();
  setFormMessage(todayRecordsMessage, currentSetting ? "" : "今日沒有對應的學期設定，暫以系統座號顯示。", !currentSetting);
}

function openRecordCorrection(studentNo) {
  const record = todayRecords.get(studentNo);
  if (!record) return;
  const profile = getTodayRecordProfile(studentNo);
  const displayNo = getStudentDisplayNumber(studentNo, profile.display_no);
  const displayName = getStudentDisplayName(displayNo, profile.display_name);
  pendingRecordCorrection = { studentNo, recordDate: record.record_date };
  correctRecordStudent.textContent = `${displayName}（${displayNo}號）`;
  correctRecordStatus.textContent = record.status === "completed" ? "完成潔牙" : "請假";
  correctRecordDate.textContent = record.record_date;
  correctRecordDialog.showModal();
}

async function clearTodayRecord(correction) {
  confirmCorrectRecordButton.disabled = true;
  setFormMessage(todayRecordsMessage, "正在清除今日紀錄…");
  try {
    const { error } = await teacherClient
      .from("brushing_records")
      .delete()
      .eq("student_no", correction.studentNo)
      .eq("record_date", correction.recordDate);
    if (error) throw error;
    await loadTodayRecords();
    setFormMessage(todayRecordsMessage, "今日紀錄已清除，學生狀態已恢復為未完成。 ");
  } catch (error) {
    console.error("清除今日紀錄失敗", error);
    setFormMessage(todayRecordsMessage, "清除失敗，請確認教師權限及資料庫設定後再試一次。", true);
  } finally {
    confirmCorrectRecordButton.disabled = false;
  }
}

todayRecordsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='correct-today-record']");
  if (button) openRecordCorrection(Number(button.dataset.id));
});

document.querySelector("#refresh-today-records").addEventListener("click", () =>
  loadTodayRecords().catch(handleInitialLoadError),
);

confirmCorrectRecordButton.addEventListener("click", () => {
  if (!pendingRecordCorrection) return;
  const correction = pendingRecordCorrection;
  pendingRecordCorrection = null;
  window.setTimeout(() => clearTodayRecord(correction), 0);
});

correctRecordDialog.addEventListener("close", () => {
  if (correctRecordDialog.returnValue !== "confirm") pendingRecordCorrection = null;
});

function revokeStudentPhotoPreview(studentNo) {
  const url = studentPhotoPreviewUrls.get(studentNo);
  if (url) URL.revokeObjectURL(url);
  studentPhotoPreviewUrls.delete(studentNo);
}

function revokeAllStudentPhotoPreviews() {
  STUDENT_NUMBERS.forEach(revokeStudentPhotoPreview);
}

function showStudentPhotoPreview(studentNo, blob = null) {
  revokeStudentPhotoPreview(studentNo);
  const image = document.querySelector(`#student-photo-preview-${studentNo}`);
  const fallback = document.querySelector(`#student-photo-fallback-${studentNo}`);

  if (blob) {
    const url = URL.createObjectURL(blob);
    studentPhotoPreviewUrls.set(studentNo, url);
    image.src = url;
    image.hidden = false;
    fallback.hidden = true;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
    fallback.hidden = false;
  }
}

function setStudentPhotoStatus(studentNo, message) {
  document.querySelector(`#student-photo-status-${studentNo}`).textContent = message;
}

function getStudentNumber(studentSlot) {
  return parseStudentNumber(document.querySelector(`#student-number-${studentSlot}`).value) ?? studentSlot;
}

function updateStudentEditorLabel(studentSlot) {
  const displayNo = getStudentNumber(studentSlot);
  document.querySelector(`#student-profile-label-${studentSlot}`).textContent = `${displayNo}號學生`;
  document.querySelector(`#student-photo-fallback-${studentSlot}`).textContent = String(displayNo);
  const preview = document.querySelector(`[data-student-profile="${studentSlot}"] .profile-photo-preview`);
  const image = document.querySelector(`#student-photo-preview-${studentSlot}`);
  preview.setAttribute("aria-label", `${displayNo}號學生圖片預覽`);
  image.alt = `${displayNo}號學生圖片預覽`;
}

function getSelectedReportSetting() {
  return reportSettingsRows.find((row) => row.id === studentProfileTerm.value) || null;
}

function populateStudentProfileTermOptions() {
  const previousValue = studentProfileTerm.value;
  studentProfileTerm.replaceChildren();

  for (const setting of reportSettingsRows) {
    const option = document.createElement("option");
    option.value = setting.id;
    option.textContent = `${setting.academic_year}學年度／第${setting.semester}學期／${setting.class_name}`;
    studentProfileTerm.append(option);
  }

  const today = getTaipeiIsoDate();
  const currentSetting = reportSettingsRows.find(
    (setting) => setting.effective_start <= today && setting.effective_end >= today,
  );
  const nextValue = reportSettingsRows.some((setting) => setting.id === previousValue)
    ? previousValue
    : currentSetting?.id || reportSettingsRows[0]?.id || "";

  studentProfileTerm.value = nextValue;
  studentProfileTerm.disabled = reportSettingsRows.length === 0;
  studentProfilesEmpty.hidden = reportSettingsRows.length > 0;
  studentProfilesForm.hidden = reportSettingsRows.length === 0;
}

function resetStudentProfileEditor() {
  selectedStudentPhotos.clear();
  removedStudentPhotos.clear();
  revokeAllStudentPhotoPreviews();

  for (const studentNo of STUDENT_NUMBERS) {
    document.querySelector(`#student-number-${studentNo}`).value = String(studentNo);
    document.querySelector(`#student-name-${studentNo}`).value = "";
    document.querySelector(`#student-photo-${studentNo}`).value = "";
    showStudentPhotoPreview(studentNo);
    setStudentPhotoStatus(studentNo, "尚未上傳圖片");
    updateStudentEditorLabel(studentNo);
  }
  setFormMessage(studentProfilesMessage);
}

async function loadStudentProfiles() {
  const setting = getSelectedReportSetting();
  const sequence = ++studentProfileLoadSequence;
  resetStudentProfileEditor();
  studentProfileRows = new Map();

  if (!setting) return;
  setFormMessage(studentProfilesMessage, "正在讀取學生資料…");

  const { data, error } = await teacherClient
    .from("student_profiles")
    .select("id, report_setting_id, student_no, display_no, display_name, photo_path")
    .eq("report_setting_id", setting.id)
    .order("student_no");
  if (error) throw error;
  if (sequence !== studentProfileLoadSequence) return;

  studentProfileRows = new Map((data || []).map((row) => [row.student_no, row]));
  for (const studentNo of STUDENT_NUMBERS) {
    const row = studentProfileRows.get(studentNo);
    document.querySelector(`#student-number-${studentNo}`).value = String(row?.display_no ?? studentNo);
    document.querySelector(`#student-name-${studentNo}`).value = row?.display_name || "";
    updateStudentEditorLabel(studentNo);
    setStudentPhotoStatus(studentNo, row?.photo_path ? "正在讀取目前圖片…" : "尚未上傳圖片");
  }

  await Promise.all(
    STUDENT_NUMBERS.map(async (studentNo) => {
      const row = studentProfileRows.get(studentNo);
      if (!row?.photo_path) return;
      const { data: blob, error: downloadError } = await teacherClient.storage
        .from(STUDENT_PHOTO_BUCKET)
        .download(row.photo_path);
      if (sequence !== studentProfileLoadSequence) return;
      if (downloadError) {
        console.warn(`讀取 ${getStudentNumber(studentNo)} 號學生圖片失敗`, downloadError);
        setStudentPhotoStatus(studentNo, "圖片暫時無法預覽，可重新選擇圖片覆蓋。 ");
        return;
      }
      showStudentPhotoPreview(studentNo, blob);
      setStudentPhotoStatus(studentNo, "目前已有圖片");
    }),
  );

  if (sequence === studentProfileLoadSequence) setFormMessage(studentProfilesMessage);
}

function handleStudentPhotoSelection(studentNo, input) {
  const file = input.files?.[0];
  if (!file) return;
  const validationMessage = validateStudentPhoto(file);
  if (validationMessage) {
    input.value = "";
    setFormMessage(studentProfilesMessage, `${getStudentNumber(studentNo)}號：${validationMessage}`, true);
    return;
  }

  selectedStudentPhotos.set(studentNo, file);
  removedStudentPhotos.delete(studentNo);
  showStudentPhotoPreview(studentNo, file);
  setStudentPhotoStatus(studentNo, `已選擇 ${file.name}，儲存後上傳。`);
  setFormMessage(studentProfilesMessage);
}

function removeStudentPhoto(studentNo) {
  selectedStudentPhotos.delete(studentNo);
  removedStudentPhotos.add(studentNo);
  document.querySelector(`#student-photo-${studentNo}`).value = "";
  showStudentPhotoPreview(studentNo);
  setStudentPhotoStatus(studentNo, "儲存後移除圖片");
  setFormMessage(studentProfilesMessage);
}

async function saveStudentProfile(setting, studentNo) {
  const existing = studentProfileRows.get(studentNo);
  const file = selectedStudentPhotos.get(studentNo);
  const oldPath = existing?.photo_path || null;
  let nextPath = removedStudentPhotos.has(studentNo) ? null : oldPath;
  let uploadedPath = null;

  if (file) {
    const extension = STUDENT_PHOTO_TYPES[file.type];
    nextPath = `${setting.id}/${studentNo}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await teacherClient.storage.from(STUDENT_PHOTO_BUCKET).upload(nextPath, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    uploadedPath = nextPath;
  }

  const payload = {
    report_setting_id: setting.id,
    student_no: studentNo,
    display_no: getStudentNumber(studentNo),
    display_name: document.querySelector(`#student-name-${studentNo}`).value.trim(),
    photo_path: nextPath,
  };

  const { error: saveError } = await teacherClient
    .from("student_profiles")
    .upsert(payload, { onConflict: "report_setting_id,student_no" });
  if (saveError) {
    if (uploadedPath) {
      const { error: cleanupError } = await teacherClient.storage.from(STUDENT_PHOTO_BUCKET).remove([uploadedPath]);
      if (cleanupError) console.warn("清除未採用的新圖片失敗", cleanupError);
    }
    throw saveError;
  }

  if (oldPath && oldPath !== nextPath) {
    const { error: removeError } = await teacherClient.storage.from(STUDENT_PHOTO_BUCKET).remove([oldPath]);
    if (removeError) console.warn("學生資料已儲存，但舊圖片清除失敗", removeError);
  }
}

function renderReportSettingsList() {
  reportSettingsList.replaceChildren();
  if (reportSettingsRows.length === 0) {
    reportSettingsList.append(makeEmptyRow(4, "尚未建立報表行政資料。"));
    return;
  }

  for (const setting of reportSettingsRows) {
    const row = document.createElement("tr");
    const term = document.createElement("td");
    term.textContent = `${setting.academic_year}學年度／第${setting.semester}學期`;
    const school = document.createElement("td");
    school.textContent = `${setting.school_name}／${setting.class_name}`;
    const period = document.createElement("td");
    period.textContent = `${setting.effective_start} ～ ${setting.effective_end}`;
    const actions = document.createElement("td");
    actions.className = "table-actions";
    actions.append(makeButton("編輯", "edit-report-setting", setting.id));
    row.append(term, school, period, actions);
    reportSettingsList.append(row);
  }
}

async function loadReportSettings() {
  setFormMessage(reportSettingsMessage, "正在讀取行政資料…");
  const { data, error } = await teacherClient
    .from("report_settings")
    .select("id, school_name, class_name, academic_year, semester, effective_start, effective_end, form_title")
    .order("effective_start", { ascending: false });

  if (error) throw error;
  reportSettingsRows = data || [];
  renderReportSettingsList();
  populateStudentProfileTermOptions();
  setFormMessage(reportSettingsMessage);
}

function resetReportSettingsForm() {
  reportSettingsForm.reset();
  document.querySelector("#report-setting-id").value = "";
  document.querySelector("#form-title").value = "學生潔牙紀錄表";
  setFormMessage(reportSettingsMessage);
}

function editReportSetting(id) {
  const setting = reportSettingsRows.find((row) => row.id === id);
  if (!setting) return;
  document.querySelector("#report-setting-id").value = setting.id;
  document.querySelector("#school-name").value = setting.school_name;
  document.querySelector("#class-name").value = setting.class_name;
  document.querySelector("#academic-year").value = setting.academic_year;
  document.querySelector("#semester").value = setting.semester;
  document.querySelector("#effective-start").value = setting.effective_start;
  document.querySelector("#effective-end").value = setting.effective_end;
  document.querySelector("#form-title").value = setting.form_title;
  reportSettingsForm.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#school-name").focus();
}

reportSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = reportSettingsForm.querySelector("button[type='submit']");
  const id = document.querySelector("#report-setting-id").value;
  const payload = {
    school_name: document.querySelector("#school-name").value.trim(),
    class_name: document.querySelector("#class-name").value.trim(),
    academic_year: Number(document.querySelector("#academic-year").value),
    semester: Number(document.querySelector("#semester").value),
    effective_start: document.querySelector("#effective-start").value,
    effective_end: document.querySelector("#effective-end").value,
    form_title: document.querySelector("#form-title").value.trim(),
  };

  if (payload.effective_end < payload.effective_start) {
    setFormMessage(reportSettingsMessage, "結束日期不可早於開始日期。", true);
    return;
  }

  submitButton.disabled = true;
  setFormMessage(reportSettingsMessage, "正在儲存…");
  try {
    const query = id
      ? teacherClient.from("report_settings").update(payload).eq("id", id)
      : teacherClient.from("report_settings").insert(payload);
    const { error } = await query;
    if (error) throw error;

    resetReportSettingsForm();
    await loadReportSettings();
    await loadStudentProfiles();
    setFormMessage(reportSettingsMessage, "行政資料已儲存。 ");
  } catch (error) {
    console.error("儲存行政資料失敗", error);
    const message =
      error?.code === "23P01"
        ? "有效日期不可和其他學期重疊。"
        : error?.code === "23505"
          ? "同一學年度及學期已經存在。"
          : "儲存失敗，請檢查資料與網路後再試一次。";
    setFormMessage(reportSettingsMessage, message, true);
  } finally {
    submitButton.disabled = false;
  }
});

reportSettingsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='edit-report-setting']");
  if (button) editReportSetting(button.dataset.id);
});

document.querySelector("#new-report-setting").addEventListener("click", () => {
  resetReportSettingsForm();
  document.querySelector("#school-name").focus();
});
document.querySelector("#cancel-report-setting").addEventListener("click", resetReportSettingsForm);

studentProfileTerm.addEventListener("change", () => loadStudentProfiles().catch(handleInitialLoadError));

for (const studentNo of STUDENT_NUMBERS) {
  document.querySelector(`#student-number-${studentNo}`).addEventListener("input", () => {
    updateStudentEditorLabel(studentNo);
  });
  document.querySelector(`#student-photo-${studentNo}`).addEventListener("change", (event) => {
    handleStudentPhotoSelection(studentNo, event.currentTarget);
  });
}

studentProfilesForm.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='remove-student-photo']");
  if (button) removeStudentPhoto(Number(button.dataset.student));
});

studentProfilesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const setting = getSelectedReportSetting();
  if (!setting) {
    setFormMessage(studentProfilesMessage, "請先建立並選擇適用學期。", true);
    return;
  }

  const displayNumbers = STUDENT_NUMBERS.map((studentNo) =>
    parseStudentNumber(document.querySelector(`#student-number-${studentNo}`).value),
  );
  const invalidStudent = displayNumbers.findIndex((studentNo) => studentNo === null);
  if (invalidStudent !== -1) {
    const studentSlot = STUDENT_NUMBERS[invalidStudent];
    setFormMessage(studentProfilesMessage, "座號請輸入 1～99 的整數。", true);
    document.querySelector(`#student-number-${studentSlot}`).focus();
    return;
  }
  if (new Set(displayNumbers).size !== displayNumbers.length) {
    setFormMessage(studentProfilesMessage, "兩位學生的座號不可重複。", true);
    document.querySelector("#student-number-2").focus();
    return;
  }

  const missingName = STUDENT_NUMBERS.find(
    (studentNo) => !document.querySelector(`#student-name-${studentNo}`).value.trim(),
  );
  if (missingName) {
    setFormMessage(studentProfilesMessage, `請輸入 ${getStudentNumber(missingName)} 號學生的顯示姓名。`, true);
    document.querySelector(`#student-name-${missingName}`).focus();
    return;
  }

  const submitButton = studentProfilesForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setFormMessage(studentProfilesMessage, "正在儲存座號、姓名與圖片…");

  try {
    const results = await Promise.allSettled(
      STUDENT_NUMBERS.map((studentNo) => saveStudentProfile(setting, studentNo)),
    );
    const failedStudents = STUDENT_NUMBERS.filter((_, index) => results[index].status === "rejected");
    for (const result of results) {
      if (result.status === "rejected") console.error("儲存學生資料失敗", result.reason);
    }

    await loadStudentProfiles();
    if (failedStudents.length) {
      setFormMessage(
        studentProfilesMessage,
        `${failedStudents.map(getStudentNumber).join("、")}號資料儲存失敗；其他已成功的資料已保留，請檢查圖片與網路後再試一次。`,
        true,
      );
    } else {
      setFormMessage(studentProfilesMessage, "兩位學生的座號、姓名與圖片設定已儲存。 ");
    }
  } catch (error) {
    console.error("重新讀取學生資料失敗", error);
    setFormMessage(studentProfilesMessage, "儲存後無法重新讀取資料，請重新整理確認。", true);
  } finally {
    submitButton.disabled = false;
  }
});

async function loadUsageDays() {
  setFormMessage(usageDaysMessage, "正在讀取每週使用日…");
  const { data, error } = await teacherClient.from("app_settings").select("usage_day_mode").eq("id", 1).single();
  if (error) throw error;

  usageDayMode = data.usage_day_mode;
  usageDayModeSelect.value = usageDayMode;
  setFormMessage(usageDaysMessage);
}

usageDaysForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = usageDaysForm.querySelector("button[type='submit']");
  const nextMode = usageDayModeSelect.value;
  submitButton.disabled = true;
  setFormMessage(usageDaysMessage, "正在儲存…");

  try {
    const { data, error } = await teacherClient
      .from("app_settings")
      .update({ usage_day_mode: nextMode })
      .eq("id", 1)
      .select("usage_day_mode")
      .single();
    if (error) throw error;

    usageDayMode = data.usage_day_mode;
    usageDayModeSelect.value = usageDayMode;
    renderCalendarList();
    setFormMessage(usageDaysMessage, "每週使用日已儲存，學生頁與月報會套用新設定。 ");
  } catch (error) {
    console.error("儲存每週使用日失敗", error);
    usageDayModeSelect.value = usageDayMode;
    setFormMessage(usageDaysMessage, "儲存失敗，請檢查資料與網路後再試一次。", true);
  } finally {
    submitButton.disabled = false;
  }
});

function renderCalendarList() {
  calendarList.replaceChildren();
  if (calendarRows.length === 0) {
    const defaultDescription = usageDayMode === "everyday" ? "星期一至星期日皆可使用" : "週一至週五可使用";
    calendarList.append(makeEmptyRow(5, `這個月份沒有特殊日期，將使用「${defaultDescription}」設定。`));
    return;
  }

  for (const item of calendarRows) {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = item.date;
    const weekday = document.createElement("td");
    weekday.textContent = `星期${getWeekdayLabel(item.date)}`;
    const type = document.createElement("td");
    type.textContent = item.is_school_day ? "上課／可使用日" : "非上課日";
    const label = document.createElement("td");
    label.textContent = item.label;
    const actions = document.createElement("td");
    actions.className = "table-actions";
    actions.append(makeButton("編輯", "edit-calendar", item.id), makeButton("刪除", "delete-calendar", item.id, true));
    row.append(date, weekday, type, label, actions);
    calendarList.append(row);
  }
}

async function loadCalendar() {
  const yearMonth = calendarMonth.value;
  if (!yearMonth) return;
  setFormMessage(calendarMessage, "正在讀取特殊日期…");
  const { firstDate, lastDate } = getMonthBounds(yearMonth);
  const { data, error } = await teacherClient
    .from("school_calendar")
    .select("id, date, is_school_day, label")
    .gte("date", firstDate)
    .lte("date", lastDate)
    .order("date");

  if (error) throw error;
  calendarRows = data || [];
  renderCalendarList();
  setFormMessage(calendarMessage);
}

function resetCalendarForm() {
  calendarForm.reset();
  document.querySelector("#calendar-setting-id").value = "";
  document.querySelector("#calendar-type").value = "false";
  setFormMessage(calendarMessage);
}

function editCalendar(id) {
  const item = calendarRows.find((row) => row.id === id);
  if (!item) return;
  document.querySelector("#calendar-setting-id").value = item.id;
  document.querySelector("#calendar-date").value = item.date;
  document.querySelector("#calendar-type").value = String(item.is_school_day);
  document.querySelector("#calendar-label").value = item.label;
  calendarForm.scrollIntoView({ behavior: "smooth", block: "center" });
  document.querySelector("#calendar-label").focus();
}

calendarForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = calendarForm.querySelector("button[type='submit']");
  const id = document.querySelector("#calendar-setting-id").value;
  const payload = {
    date: document.querySelector("#calendar-date").value,
    is_school_day: document.querySelector("#calendar-type").value === "true",
    label: document.querySelector("#calendar-label").value.trim(),
  };

  submitButton.disabled = true;
  setFormMessage(calendarMessage, "正在儲存…");
  try {
    const query = id
      ? teacherClient.from("school_calendar").update(payload).eq("id", id)
      : teacherClient.from("school_calendar").upsert(payload, { onConflict: "date" });
    const { error } = await query;
    if (error) throw error;

    calendarMonth.value = payload.date.slice(0, 7);
    resetCalendarForm();
    await loadCalendar();
    setFormMessage(calendarMessage, "特殊日期已儲存。 ");
  } catch (error) {
    console.error("儲存特殊日期失敗", error);
    setFormMessage(
      calendarMessage,
      error?.code === "23505" ? "這個日期已經有特殊設定。" : "儲存失敗，請檢查資料與網路後再試一次。",
      true,
    );
  } finally {
    submitButton.disabled = false;
  }
});

calendarList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit-calendar") {
    editCalendar(button.dataset.id);
    return;
  }
  if (button.dataset.action !== "delete-calendar") return;

  const item = calendarRows.find((row) => row.id === button.dataset.id);
  if (!item || !window.confirm(`確定刪除 ${item.date}「${item.label}」的特殊設定嗎？刪除後將恢復每週使用模式。`)) return;

  button.disabled = true;
  try {
    const { error } = await teacherClient.from("school_calendar").delete().eq("id", item.id);
    if (error) throw error;
    await loadCalendar();
    setFormMessage(calendarMessage, "特殊日期已刪除，該日已恢復每週使用模式。 ");
  } catch (error) {
    console.error("刪除特殊日期失敗", error);
    setFormMessage(calendarMessage, "刪除失敗，請稍後再試。", true);
    button.disabled = false;
  }
});

document.querySelector("#cancel-calendar-setting").addEventListener("click", resetCalendarForm);
calendarMonth.addEventListener("change", () => loadCalendar().catch(handleInitialLoadError));

function handleInitialLoadError(error) {
  console.error("讀取設定失敗", error);
  setFormMessage(usageDaysMessage, "資料讀取失敗，請檢查網路後重新整理。", true);
  setFormMessage(reportSettingsMessage, "資料讀取失敗，請檢查網路後重新整理。", true);
  setFormMessage(studentProfilesMessage, "學生資料讀取失敗，請檢查網路後重新整理。", true);
  setFormMessage(calendarMessage, "資料讀取失敗，請檢查網路後重新整理。", true);
  setFormMessage(todayRecordsMessage, "今日紀錄讀取失敗，請檢查網路後重新整理。", true);
}

async function loadAllSettings() {
  await loadReportSettings();
  await Promise.all([loadUsageDays(), loadCalendar(), loadStudentProfiles(), loadTodayRecords()]);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type='submit']");
  const formData = new FormData(loginForm);
  submitButton.disabled = true;
  loginMessage.textContent = "登入中…";
  loginMessage.classList.remove("is-error");
  try {
    await signInForRole(teacherClient, String(formData.get("email")), String(formData.get("password")), "teacher");
    loginForm.reset();
    setLoginState(false);
  } catch (error) {
    console.error("教師登入失敗", error);
    loginMessage.textContent = "帳號或密碼錯誤。";
    loginMessage.classList.add("is-error");
    return;
  } finally {
    submitButton.disabled = false;
  }

  loadAllSettings().catch(handleInitialLoadError);
});

document.querySelector("#teacher-logout").addEventListener("click", async () => {
  try {
    await signOut(teacherClient);
  } catch (error) {
    console.error("登出失敗", error);
  } finally {
    studentProfileLoadSequence += 1;
    revokeAllStudentPhotoPreviews();
    setLoginState(true);
  }
});

window.addEventListener("beforeunload", revokeAllStudentPhotoPreviews);

async function initialize() {
  calendarMonth.value = getTaipeiYearMonth();
  if (!isSupabaseConfigured) {
    setLoginState(true, "系統尚未設定 Supabase，請依 README 完成設定。 ");
    loginForm.querySelectorAll("input, button").forEach((control) => {
      control.disabled = true;
    });
    return;
  }

  try {
    const teacher = await requireAppRole(teacherClient, "teacher");
    if (!teacher) {
      setLoginState(true);
      return;
    }
    setLoginState(false);
  } catch (error) {
    console.error("驗證教師帳號失敗", error);
    setLoginState(true, "暫時無法驗證帳號，請檢查網路後重新整理。 ");
    return;
  }

  loadAllSettings().catch(handleInitialLoadError);
}

initialize();

if (isSupabaseConfigured) {
  teacherClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") setLoginState(true, "登入已失效，請重新登入。");
  });
}
