import { requireAppRole, signInForRole, signOut } from "./auth.js";
import { getMonthBounds, getTaipeiYearMonth, getWeekdayLabel } from "./common.js";
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

let reportSettingsRows = [];
let calendarRows = [];
let usageDayMode = "weekdays";

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
  setFormMessage(calendarMessage, "資料讀取失敗，請檢查網路後重新整理。", true);
}

async function loadAllSettings() {
  await loadUsageDays();
  await Promise.all([loadReportSettings(), loadCalendar()]);
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
    setLoginState(true);
  }
});

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
