import { requireAppRole, signInForRole, signOut } from "./auth.js";
import {
  calculateMonthlyExecutionSummary,
  calculateStudentStats,
  getMonthBounds,
  getTaipeiIsoDate,
  getTaipeiYearMonth,
  getWeekdayLabel,
  getStudentDisplayNumber,
  isWeekend,
  resolveSchoolDay,
  STUDENT_NUMBERS,
} from "./common.js";
import { isSupabaseConfigured, teacherClient } from "./supabase.js";

const loginPanel = document.querySelector("#teacher-login");
const loginForm = document.querySelector("#teacher-login-form");
const loginMessage = document.querySelector("#teacher-login-message");
const reportApp = document.querySelector("#report-app");
const reportMonth = document.querySelector("#report-month");
const reportMessage = document.querySelector("#report-message");
const reportSchool = document.querySelector("#report-school");
const reportTitle = document.querySelector("#report-title");
const reportMeta = document.querySelector("#report-meta");
const reportTable = document.querySelector("#report-table");
const summaryStudentCount = document.querySelector("#summary-student-count");
const summaryNotExecuted = document.querySelector("#summary-not-executed");
const summaryExecuted = document.querySelector("#summary-executed");
const summaryExecutionRate = document.querySelector("#summary-execution-rate");

let reportLoadSequence = 0;

function setLoginState(showLogin, message = "") {
  loginPanel.hidden = !showLogin;
  reportApp.hidden = showLogin;
  loginMessage.textContent = message;
  loginMessage.classList.toggle("is-error", Boolean(message));
}

function setReportMessage(message = "", isError = false) {
  reportMessage.hidden = !message;
  reportMessage.textContent = message;
  reportMessage.classList.toggle("is-error", isError);
}

function createCell(tag, text, classNames = []) {
  const cell = document.createElement(tag);
  cell.textContent = text;
  if (classNames.length) cell.classList.add(...classNames);
  return cell;
}

function getDateClasses(isoDate, schoolInfo, isFuture) {
  const classes = [];
  if (isWeekend(isoDate)) classes.push("weekend");
  if (!schoolInfo.isSchoolDay) classes.push("not-school-day");
  if (schoolInfo.isSchoolDay && isWeekend(isoDate)) classes.push("override-school-day");
  if (isFuture) classes.push("future-day");
  return classes;
}

function renderReport({ yearMonth, dates, calendarRows, recordRows, profileRows, settings, usageDayMode }) {
  const today = getTaipeiIsoDate();
  const calendarByDate = new Map(calendarRows.map((row) => [row.date, row]));
  const recordsByKey = new Map(recordRows.map((row) => [`${row.student_no}:${row.record_date}`, row]));
  const profilesByStudent = new Map(profileRows.map((row) => [row.student_no, row]));
  const [year, month] = yearMonth.split("-").map(Number);

  reportSchool.textContent = settings?.school_name || "尚未設定學校名稱";
  reportTitle.textContent = settings
    ? `${settings.academic_year}學年度第${settings.semester}學期　${settings.form_title || "學生潔牙紀錄表"}`
    : "學生潔牙紀錄表";
  reportMeta.textContent = settings
    ? `${settings.class_name}　（${month}）月份`
    : `${year}年${month}月（尚未設定學年度、學期及班級）`;

  const thead = reportTable.tHead;
  const tbody = reportTable.tBodies[0];
  const tfoot = reportTable.tFoot || reportTable.createTFoot();
  thead.replaceChildren();
  tbody.replaceChildren();
  tfoot.replaceChildren();

  const dateRow = document.createElement("tr");
  const seatHeading = createCell("th", "座號", ["seat-heading"]);
  seatHeading.rowSpan = 3;
  seatHeading.scope = "col";
  dateRow.append(seatHeading);
  const nameHeading = createCell("th", "姓名", ["name-heading"]);
  nameHeading.rowSpan = 3;
  nameHeading.scope = "col";
  dateRow.append(nameHeading);
  for (const isoDate of dates) {
    const info = resolveSchoolDay(isoDate, calendarByDate, usageDayMode);
    const cell = createCell("th", String(Number(isoDate.slice(-2))), getDateClasses(isoDate, info, isoDate > today));
    cell.scope = "col";
    dateRow.append(cell);
  }

  const totalHeading = createCell("th", "合計", ["total-heading"]);
  totalHeading.scope = "col";
  totalHeading.rowSpan = 3;
  dateRow.append(totalHeading);
  thead.append(dateRow);

  const weekdayRow = document.createElement("tr");
  for (const isoDate of dates) {
    const info = resolveSchoolDay(isoDate, calendarByDate, usageDayMode);
    weekdayRow.append(createCell("td", getWeekdayLabel(isoDate), getDateClasses(isoDate, info, isoDate > today)));
  }
  thead.append(weekdayRow);

  const holidayRow = document.createElement("tr");
  for (const isoDate of dates) {
    const info = resolveSchoolDay(isoDate, calendarByDate, usageDayMode);
    const cell = createCell("td", "", getDateClasses(isoDate, info, isoDate > today));
    const label = document.createElement("span");
    label.className = "holiday-label";
    label.textContent = info.label;
    label.title = info.label;
    cell.append(label);
    holidayRow.append(cell);
  }
  thead.append(holidayRow);

  for (const studentNo of STUDENT_NUMBERS) {
    const profile = profilesByStudent.get(studentNo);
    const displayNo = getStudentDisplayNumber(studentNo, profile?.display_no);
    const row = document.createElement("tr");
    const seatCell = createCell("th", String(displayNo), ["seat-cell"]);
    seatCell.scope = "row";
    row.append(seatCell);
    row.append(createCell("td", profile?.display_name?.trim() || `${displayNo}號同學`, ["name-cell"]));

    for (const isoDate of dates) {
      const info = resolveSchoolDay(isoDate, calendarByDate, usageDayMode);
      const record = recordsByKey.get(`${studentNo}:${isoDate}`);
      let mark = "";
      const classes = getDateClasses(isoDate, info, isoDate > today);

      if (!info.isSchoolDay) {
        mark = "／";
      } else if (record?.status === "completed") {
        mark = "✓";
        classes.push("completed-mark");
      } else if (record?.status === "leave") {
        mark = "假";
        classes.push("leave-mark");
      }

      row.append(createCell("td", mark, classes));
    }

    const stats = calculateStudentStats({ studentNo, dates, calendarByDate, recordsByKey, today, usageDayMode });
    row.append(createCell("td", String(stats.completed), ["total-cell"]));
    tbody.append(row);
  }

  const totalRow = document.createElement("tr");
  const totalLabel = createCell("th", "合計", ["total-label"]);
  totalLabel.colSpan = 2;
  totalLabel.scope = "row";
  totalRow.append(totalLabel);
  let monthlyCompleted = 0;
  for (const isoDate of dates) {
    const info = resolveSchoolDay(isoDate, calendarByDate, usageDayMode);
    const isFuture = isoDate > today;
    const classes = getDateClasses(isoDate, info, isFuture);
    let value = "";
    if (!info.isSchoolDay) {
      value = "／";
    } else if (!isFuture) {
      const completed = STUDENT_NUMBERS.filter(
        (studentNo) => recordsByKey.get(`${studentNo}:${isoDate}`)?.status === "completed",
      ).length;
      monthlyCompleted += completed;
      value = String(completed);
    }
    totalRow.append(createCell("td", value, classes));
  }
  totalRow.append(createCell("td", String(monthlyCompleted), ["total-cell"]));
  tfoot.append(totalRow);

  const summary = calculateMonthlyExecutionSummary({
    dates,
    calendarByDate,
    recordsByKey,
    today,
    usageDayMode,
  });
  summaryStudentCount.textContent = String(summary.studentCount);
  summaryNotExecuted.textContent = String(summary.notExecuted);
  summaryExecuted.textContent = String(summary.executed);
  summaryExecutionRate.textContent = summary.rate;
}

async function loadReport() {
  const yearMonth = reportMonth.value;
  if (!yearMonth) {
    setReportMessage("請先選擇報表月份。", true);
    return;
  }

  const sequence = ++reportLoadSequence;
  const loadButton = document.querySelector("#load-report");
  loadButton.disabled = true;
  setReportMessage("正在載入月報…");

  try {
    const { firstDate, lastDate, dates } = getMonthBounds(yearMonth);
    const [recordsResult, calendarResult, settingsResult, appSettingsResult] = await Promise.all([
      teacherClient
        .from("brushing_records")
        .select("student_no, record_date, status, recorded_at")
        .gte("record_date", firstDate)
        .lte("record_date", lastDate)
        .order("record_date"),
      teacherClient.from("school_calendar").select("date, is_school_day, label").gte("date", firstDate).lte("date", lastDate).order("date"),
      teacherClient
        .from("report_settings")
        .select("id, school_name, class_name, academic_year, semester, effective_start, effective_end, form_title")
        .lte("effective_start", firstDate)
        .gte("effective_end", firstDate)
        .order("effective_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      teacherClient.from("app_settings").select("usage_day_mode").eq("id", 1).single(),
    ]);

    if (recordsResult.error) throw recordsResult.error;
    if (calendarResult.error) throw calendarResult.error;
    if (settingsResult.error) throw settingsResult.error;
    if (appSettingsResult.error) throw appSettingsResult.error;
    if (sequence !== reportLoadSequence) return;

    let profileRows = [];
    if (settingsResult.data) {
      const profilesResult = await teacherClient
        .from("student_profiles")
        .select("student_no, display_no, display_name")
        .eq("report_setting_id", settingsResult.data.id)
        .order("student_no");
      if (profilesResult.error) throw profilesResult.error;
      profileRows = profilesResult.data || [];
    }
    if (sequence !== reportLoadSequence) return;

    renderReport({
      yearMonth,
      dates,
      calendarRows: calendarResult.data || [],
      recordRows: recordsResult.data || [],
      profileRows,
      settings: settingsResult.data,
      usageDayMode: appSettingsResult.data.usage_day_mode,
    });

    setReportMessage(
      settingsResult.data ? "月報已載入。" : "月報已載入，但尚未設定此月份的報表行政資料。",
      !settingsResult.data,
    );
  } catch (error) {
    console.error("載入月報失敗", error);
    setReportMessage("月報載入失敗，請檢查網路後再試一次。", true);
  } finally {
    if (sequence === reportLoadSequence) loadButton.disabled = false;
  }
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
    await loadReport();
  } catch (error) {
    console.error("教師登入失敗", error);
    loginMessage.textContent = "帳號或密碼錯誤。";
    loginMessage.classList.add("is-error");
  } finally {
    submitButton.disabled = false;
  }
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

document.querySelector("#load-report").addEventListener("click", loadReport);
document.querySelector("#print-report").addEventListener("click", () => window.print());
reportMonth.addEventListener("change", loadReport);

async function initialize() {
  reportMonth.value = getTaipeiYearMonth();
  reportMessage.hidden = true;

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
    await loadReport();
  } catch (error) {
    console.error("驗證教師帳號失敗", error);
    setLoginState(true, "暫時無法驗證帳號，請檢查網路後重新整理。 ");
  }
}

initialize();

if (isSupabaseConfigured) {
  teacherClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") setLoginState(true, "登入已失效，請重新登入。");
  });
}
