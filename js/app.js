import { requireAppRole, signInKiosk } from "./auth.js";
import { KIOSK_LOGIN_USERNAME } from "./config.js";
import {
  calculateDailyProgress,
  formatTaipeiDisplayDate,
  getStudentDisplayName,
  getStudentDisplayNumber,
  getTaipeiIsoDate,
  resolveSchoolDay,
  STUDENT_NUMBERS,
} from "./common.js";
import { isSupabaseConfigured, kioskClient } from "./supabase.js";

const loginPanel = document.querySelector("#device-login");
const loginForm = document.querySelector("#device-login-form");
const loginMessage = document.querySelector("#device-login-message");
const usernameInput = document.querySelector("#device-username");
const studentApp = document.querySelector("#student-app");
const dateElement = document.querySelector("#today-date");
const banner = document.querySelector("#connection-message");
const progressTitle = document.querySelector("#progress-title");
const progressCount = document.querySelector("#progress-count");
const progressDetail = document.querySelector("#progress-detail");
const progressTrack = document.querySelector("#progress-track");
const progressFill = document.querySelector("#progress-fill");
const leaveDialog = document.querySelector("#leave-dialog");
const leaveStudentName = document.querySelector("#leave-student-name");
const leaveStudentNumber = document.querySelector("#leave-student-number");
const confirmLeaveButton = document.querySelector("#confirm-leave");
const toast = document.querySelector("#toast");

const records = new Map(STUDENT_NUMBERS.map((studentNo) => [studentNo, null]));
const studentProfiles = new Map(
  STUDENT_NUMBERS.map((studentNo) => [studentNo, { student_no: studentNo, display_no: studentNo, display_name: "", photo_path: null, photoUrl: null }]),
);
const busyStudents = new Set();
let activeDate = getTaipeiIsoDate();
let todaySchoolInfo = { isSchoolDay: true, label: "" };
let usageDayMode = "weekdays";
let pendingLeaveStudent = null;
let toastTimer = null;
let reloadPromise = null;

function showLogin(message = "") {
  usernameInput.value = KIOSK_LOGIN_USERNAME;
  studentApp.hidden = true;
  loginPanel.hidden = false;
  loginMessage.textContent = message;
  loginMessage.classList.toggle("is-error", Boolean(message));
}

function showStudentApp() {
  loginPanel.hidden = true;
  studentApp.hidden = false;
}

function setBanner(message = "", isError = false) {
  banner.hidden = !message;
  banner.textContent = message;
  banner.classList.toggle("is-error", isError);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function getCard(studentNo) {
  return document.querySelector(`.student-card[data-student="${studentNo}"]`);
}

function revokeProfilePhotoUrls() {
  for (const profile of studentProfiles.values()) {
    if (profile.photoUrl) URL.revokeObjectURL(profile.photoUrl);
    profile.photoUrl = null;
  }
}

async function setStudentProfiles(rows) {
  const previousProfiles = new Map(studentProfiles);
  const nextProfiles = new Map(
    STUDENT_NUMBERS.map((studentNo) => [studentNo, { student_no: studentNo, display_no: studentNo, display_name: "", photo_path: null, photoUrl: null }]),
  );

  for (const row of rows || []) {
    if (!STUDENT_NUMBERS.includes(row.student_no)) continue;
    const previous = previousProfiles.get(row.student_no);
    nextProfiles.set(row.student_no, {
      ...row,
      photoUrl: previous?.photo_path === row.photo_path ? previous.photoUrl : null,
    });
  }

  for (const previous of previousProfiles.values()) {
    const next = nextProfiles.get(previous.student_no);
    if (previous.photoUrl && previous.photoUrl !== next?.photoUrl) URL.revokeObjectURL(previous.photoUrl);
  }

  studentProfiles.clear();
  for (const [studentNo, profile] of nextProfiles) studentProfiles.set(studentNo, profile);

  await Promise.all(
    STUDENT_NUMBERS.map(async (studentNo) => {
      const profile = studentProfiles.get(studentNo);
      if (!profile.photo_path || profile.photoUrl) return;
      const { data, error } = await kioskClient.storage.from("student-photos").download(profile.photo_path);
      if (error) {
        console.warn(`讀取 ${studentNo} 號學生圖片失敗`, error);
        return;
      }
      profile.photoUrl = URL.createObjectURL(data);
    }),
  );
}

function renderCard(studentNo, animate = false) {
  const card = getCard(studentNo);
  const mainButton = card.querySelector("[data-action='complete']");
  const leaveButton = card.querySelector("[data-action='leave']");
  const visualTooth = card.querySelector(".tooth");
  const visualBrush = card.querySelector(".brush");
  const title = card.querySelector(".student-state-title");
  const subtitle = card.querySelector(".student-state-subtitle");
  const record = records.get(studentNo);
  const profile = studentProfiles.get(studentNo);
  const displayNo = getStudentDisplayNumber(studentNo, profile?.display_no);
  const displayName = getStudentDisplayName(displayNo, profile?.display_name);
  const nameElement = card.querySelector(`[data-profile-name="${studentNo}"]`);
  const photoElement = card.querySelector(`[data-profile-photo="${studentNo}"]`);
  const photoFallback = card.querySelector(`[data-profile-fallback="${studentNo}"]`);
  const numberElement = card.querySelector(".student-number");
  const isBusy = busyStudents.has(studentNo);

  nameElement.textContent = displayName;
  numberElement.firstChild.textContent = `${displayNo} `;
  photoFallback.textContent = String(displayNo);
  if (profile?.photoUrl) {
    photoElement.src = profile.photoUrl;
    photoElement.hidden = false;
    photoFallback.hidden = true;
  } else {
    photoElement.removeAttribute("src");
    photoElement.hidden = true;
    photoFallback.hidden = false;
  }

  card.classList.remove("just-completed");
  card.dataset.state = !todaySchoolInfo.isSchoolDay ? "offday" : isBusy ? "loading" : record?.status || "incomplete";
  mainButton.disabled = !todaySchoolInfo.isSchoolDay || isBusy;
  leaveButton.disabled = !todaySchoolInfo.isSchoolDay || isBusy;

  if (!todaySchoolInfo.isSchoolDay) {
    visualTooth.textContent = "☀️";
    visualBrush.textContent = "";
    title.textContent = "今日非上課日";
    subtitle.textContent = todaySchoolInfo.label || "今天好好休息";
    mainButton.setAttribute("aria-label", `${displayName}，${displayNo}號，今日非上課日`);
  } else if (record?.status === "completed") {
    visualTooth.textContent = "🦷";
    visualBrush.textContent = "✓";
    title.textContent = "今天完成！";
    subtitle.textContent = "好棒，繼續保持";
    mainButton.setAttribute("aria-label", `${displayName}，${displayNo}號，今天已完成潔牙`);
    if (animate) {
      requestAnimationFrame(() => card.classList.add("just-completed"));
    }
  } else if (record?.status === "leave") {
    visualTooth.textContent = "☀️";
    visualBrush.textContent = "";
    title.textContent = "今日請假";
    subtitle.textContent = "不列入潔牙統計";
    mainButton.setAttribute("aria-label", `${displayName}，${displayNo}號，今日請假`);
  } else {
    visualTooth.textContent = "🦷";
    visualBrush.textContent = "🪥";
    title.textContent = "點一下完成潔牙";
    subtitle.textContent = "刷乾淨了就按這裡";
    mainButton.setAttribute("aria-label", `${displayName}，${displayNo}號，點一下完成潔牙`);
  }
}

function renderProgress() {
  const progress = calculateDailyProgress(records, todaySchoolInfo.isSchoolDay);
  const { completed: completedCount, leave: leaveCount, expected: expectedCount } = progress;
  const isNeutral = progress.mode !== "progress";

  progressTrack.classList.toggle("is-neutral", isNeutral);

  if (progress.mode === "offday") {
    progressTitle.firstChild.textContent = "今日非上課日 ";
    progressCount.textContent = "";
    progressDetail.textContent = todaySchoolInfo.label || "今天好好休息，別忘了在家潔牙。";
    progressFill.style.width = "100%";
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "1");
    progressTrack.setAttribute("aria-valuenow", "0");
    progressTrack.setAttribute("aria-valuetext", "今日非上課日");
    return;
  }

  if (progress.mode === "no-expected") {
    progressTitle.firstChild.textContent = "今日學生皆請假 ";
    progressCount.textContent = "";
    progressDetail.textContent = "今日無需潔牙紀錄";
    progressFill.style.width = "100%";
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "1");
    progressTrack.setAttribute("aria-valuenow", "0");
    progressTrack.setAttribute("aria-valuetext", "今日學生皆請假，無需潔牙紀錄");
    return;
  }

  progressTitle.firstChild.textContent = "今日完成 ";
  progressCount.textContent = `${completedCount} / ${expectedCount}`;
  progressDetail.textContent = progress.allComplete
    ? "今天大家都完成潔牙了！"
    : leaveCount > 0
      ? `${leaveCount} 位請假，一起繼續加油！`
      : "一起把牙齒刷乾淨！";
  progressFill.style.width = `${(completedCount / expectedCount) * 100}%`;
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", String(expectedCount));
  progressTrack.setAttribute("aria-valuenow", String(completedCount));
  progressTrack.setAttribute("aria-valuetext", `今日完成 ${completedCount} 人，應完成 ${expectedCount} 人`);
}

function renderAll(animateStudent = null) {
  dateElement.textContent = formatTaipeiDisplayDate();
  STUDENT_NUMBERS.forEach((studentNo) => renderCard(studentNo, studentNo === animateStudent));
  renderProgress();
}

async function fetchTodayState() {
  const today = getTaipeiIsoDate();
  const [
    { data: appSettings, error: appSettingsError },
    { data: calendarRow, error: calendarError },
    { data: rows, error: recordsError },
    { data: profileRows, error: profilesError },
  ] = await Promise.all([
    kioskClient.from("app_settings").select("usage_day_mode").eq("id", 1).single(),
    kioskClient.from("school_calendar").select("date, is_school_day, label").eq("date", today).maybeSingle(),
    kioskClient.from("brushing_records").select("student_no, status, recorded_at").eq("record_date", today),
    kioskClient.from("student_profiles").select("student_no, display_no, display_name, photo_path"),
  ]);

  if (appSettingsError) throw appSettingsError;
  if (calendarError) throw calendarError;
  if (recordsError) throw recordsError;
  if (profilesError) throw profilesError;

  activeDate = today;
  usageDayMode = appSettings.usage_day_mode;
  todaySchoolInfo = resolveSchoolDay(today, calendarRow ? new Map([[today, calendarRow]]) : new Map(), usageDayMode);
  STUDENT_NUMBERS.forEach((studentNo) => records.set(studentNo, null));
  for (const row of rows || []) {
    if (STUDENT_NUMBERS.includes(row.student_no)) records.set(row.student_no, row);
  }
  await setStudentProfiles(profileRows);
}

async function reloadTodayState({ quiet = false } = {}) {
  if (reloadPromise) return reloadPromise;

  reloadPromise = (async () => {
    if (!quiet) setBanner("正在讀取今天的紀錄…");
    try {
      await fetchTodayState();
      renderAll();
      setBanner(navigator.onLine ? "" : "網路目前中斷，畫面可能不是最新狀態。", !navigator.onLine);
      return true;
    } catch (error) {
      console.error("讀取今日資料失敗", error);
      setBanner("暫時無法讀取今天的紀錄，請檢查網路後再試一次。", true);
      return false;
    } finally {
      reloadPromise = null;
    }
  })();

  return reloadPromise;
}

async function createRecord(studentNo, status) {
  if (!todaySchoolInfo.isSchoolDay) {
    showToast("今天是非上課日，不需要登記。");
    return;
  }

  const existing = records.get(studentNo);
  if (existing?.status === "completed") {
    showToast("今天已經完成囉！");
    return;
  }
  if (existing?.status === "leave") {
    showToast("今天已登記請假；如需更正請找老師。");
    return;
  }
  if (busyStudents.has(studentNo)) return;

  const operationDate = getTaipeiIsoDate();
  if (operationDate !== activeDate) {
    await reloadTodayState();
    showToast("日期已更新，請再點一次。");
    return;
  }

  busyStudents.add(studentNo);
  renderCard(studentNo);

  try {
    const { data, error } = await kioskClient
      .from("brushing_records")
      .insert({ student_no: studentNo, record_date: operationDate, status })
      .select("student_no, status, recorded_at")
      .single();

    if (error) throw error;
    records.set(studentNo, data);
    busyStudents.delete(studentNo);
    renderAll(status === "completed" ? studentNo : null);
    const displayNo = getStudentDisplayNumber(studentNo, studentProfiles.get(studentNo)?.display_no);
    showToast(status === "completed" ? `${displayNo}號完成潔牙！` : `${displayNo}號已登記請假`);
  } catch (error) {
    busyStudents.delete(studentNo);
    console.error("寫入潔牙紀錄失敗", error);

    // 23505 代表另一個請求已先建立同日紀錄；重新讀取，絕不覆寫。
    if (error?.code === "23505") {
      await reloadTodayState({ quiet: true });
      const current = records.get(studentNo);
      showToast(current?.status === "completed" ? "今天已經完成囉！" : "今天已有紀錄；如需更正請找老師。");
    } else {
      const refreshed = await reloadTodayState({ quiet: true });
      const current = records.get(studentNo);
      if (refreshed && current?.status === status) {
        renderAll(status === "completed" ? studentNo : null);
        const displayNo = getStudentDisplayNumber(studentNo, studentProfiles.get(studentNo)?.display_no);
        showToast(status === "completed" ? `${displayNo}號完成潔牙！` : `${displayNo}號已登記請假`);
      } else if (refreshed && !todaySchoolInfo.isSchoolDay) {
        renderAll();
        showToast(todaySchoolInfo.label || "今天是非上課日，不需要登記。");
      } else {
        renderCard(studentNo);
        showToast("記錄沒有成功，請再試一次。");
        setBanner("記錄沒有成功，請確認網路後再試一次。", true);
      }
    }
  }
}

document.querySelector("#student-cards").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const studentNo = Number(button.dataset.student);

  if (button.dataset.action === "complete") {
    createRecord(studentNo, "completed");
    return;
  }

  const existing = records.get(studentNo);
  if (existing) {
    showToast(existing.status === "completed" ? "今天已經完成囉！" : "今天已登記請假。 ");
    return;
  }

  pendingLeaveStudent = studentNo;
  const profile = studentProfiles.get(studentNo);
  const displayNo = getStudentDisplayNumber(studentNo, profile?.display_no);
  leaveStudentName.textContent = getStudentDisplayName(displayNo, profile?.display_name);
  leaveStudentNumber.textContent = String(displayNo);
  leaveDialog.showModal();
});

confirmLeaveButton.addEventListener("click", () => {
  if (pendingLeaveStudent === null) return;
  const studentNo = pendingLeaveStudent;
  pendingLeaveStudent = null;
  window.setTimeout(() => createRecord(studentNo, "leave"), 0);
});

leaveDialog.addEventListener("close", () => {
  if (leaveDialog.returnValue !== "confirm") pendingLeaveStudent = null;
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  loginMessage.textContent = "登入中…";
  loginMessage.classList.remove("is-error");

  try {
    const formData = new FormData(loginForm);
    await signInKiosk(kioskClient, String(formData.get("username")), String(formData.get("password")));
    loginForm.reset();
    usernameInput.value = KIOSK_LOGIN_USERNAME;
    showStudentApp();
    await reloadTodayState();
  } catch (error) {
    console.error("裝置登入失敗", error);
    loginMessage.textContent = "帳號或密碼錯誤，或此帳號不是教室裝置帳號。";
    loginMessage.classList.add("is-error");
  } finally {
    submitButton.disabled = false;
  }
});

window.addEventListener("online", () => reloadTodayState());
window.addEventListener("offline", () => setBanner("網路目前中斷，恢復後將自動重新讀取。", true));
window.addEventListener("beforeunload", revokeProfilePhotoUrls);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && studentApp.hidden === false) reloadTodayState({ quiet: true });
});

window.setInterval(() => {
  if (studentApp.hidden) return;
  if (getTaipeiIsoDate() !== activeDate) reloadTodayState();
}, 30_000);

async function initialize() {
  if (!isSupabaseConfigured) {
    showLogin("系統尚未設定 Supabase，請老師依 README 完成設定。 ");
    loginForm.querySelectorAll("input, button").forEach((control) => {
      control.disabled = true;
    });
    return;
  }

  try {
    const appUser = await requireAppRole(kioskClient, "kiosk");
    if (!appUser) {
      showLogin();
      return;
    }
    showStudentApp();
    await reloadTodayState();
  } catch (error) {
    console.error("初始化教室裝置失敗", error);
    showLogin("暫時無法驗證裝置，請檢查網路後重新整理。 ");
  }
}

initialize();

if (isSupabaseConfigured) {
  kioskClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") showLogin("裝置登入已失效，請老師重新登入。");
  });
}
