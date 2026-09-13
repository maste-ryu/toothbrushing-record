export const STUDENT_NUMBERS = Object.freeze([1, 2]);
export const TAIPEI_TIME_ZONE = "Asia/Taipei";
export const STUDENT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const STUDENT_PHOTO_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAIPEI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const taipeiDisplayFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: TAIPEI_TIME_ZONE,
  month: "long",
  day: "numeric",
  weekday: "long",
});

function partsToObject(parts) {
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function getTaipeiIsoDate(now = new Date()) {
  const { year, month, day } = partsToObject(taipeiDateFormatter.formatToParts(now));
  return `${year}-${month}-${day}`;
}

export function getTaipeiYearMonth(now = new Date()) {
  return getTaipeiIsoDate(now).slice(0, 7);
}

export function formatTaipeiDisplayDate(now = new Date()) {
  return taipeiDisplayFormatter.format(now);
}

export function getStudentDisplayName(studentNo, displayName) {
  const normalizedName = typeof displayName === "string" ? displayName.trim() : "";
  return normalizedName || `${studentNo}號同學`;
}

export function formatStudentReportLabel(studentNo, displayName) {
  const normalizedName = typeof displayName === "string" ? displayName.trim() : "";
  return normalizedName ? `${studentNo}號 ${normalizedName}` : `${studentNo}號`;
}

export function validateStudentPhoto(file) {
  if (!file) return "";
  if (!Object.hasOwn(STUDENT_PHOTO_TYPES, file.type)) return "圖片格式只接受 JPEG、PNG 或 WebP。";
  if (file.size > STUDENT_PHOTO_MAX_BYTES) return "圖片不可超過 2 MB。";
  return "";
}

export function parseIsoDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new TypeError(`無效的 ISO 日期：${isoDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function getWeekdayIndex(isoDate) {
  // 以 UTC 組合同一個曆日，避免執行裝置的本機時區改變星期。
  const { year, month, day } = parseIsoDate(isoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getWeekdayLabel(isoDate) {
  return ["日", "一", "二", "三", "四", "五", "六"][getWeekdayIndex(isoDate)];
}

export function isWeekend(isoDate) {
  const weekday = getWeekdayIndex(isoDate);
  return weekday === 0 || weekday === 6;
}

export function isDefaultSchoolDay(isoDate, usageDayMode = "weekdays") {
  return usageDayMode === "everyday" || !isWeekend(isoDate);
}

export function resolveSchoolDay(isoDate, calendarByDate, usageDayMode = "weekdays") {
  const override = calendarByDate instanceof Map ? calendarByDate.get(isoDate) : calendarByDate?.[isoDate];
  if (override && typeof override.is_school_day === "boolean") {
    return { isSchoolDay: override.is_school_day, label: override.label?.trim() || "" };
  }
  const isSchoolDay = isDefaultSchoolDay(isoDate, usageDayMode);
  return { isSchoolDay, label: !isSchoolDay && isWeekend(isoDate) ? "休" : "" };
}

export function getMonthDates(yearMonth) {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) throw new TypeError(`無效的月份：${yearMonth}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeError(`無效的月份：${yearMonth}`);

  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: dayCount }, (_, index) => `${match[1]}-${match[2]}-${String(index + 1).padStart(2, "0")}`);
}

export function getMonthBounds(yearMonth) {
  const dates = getMonthDates(yearMonth);
  return { firstDate: dates[0], lastDate: dates.at(-1), dates };
}

export function formatRate(completed, expected) {
  if (expected === 0) return "—";
  const rounded = Math.round((completed / expected) * 1000) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

export function calculateDailyProgress(recordsByStudent, isSchoolDay = true) {
  const values = STUDENT_NUMBERS.map((studentNo) =>
    recordsByStudent instanceof Map ? recordsByStudent.get(studentNo) : recordsByStudent?.[studentNo],
  );
  const completed = values.filter((record) => record?.status === "completed").length;
  const leave = values.filter((record) => record?.status === "leave").length;
  const expected = STUDENT_NUMBERS.length - leave;

  return {
    completed,
    leave,
    expected,
    mode: !isSchoolDay ? "offday" : expected === 0 ? "no-expected" : "progress",
    allComplete: isSchoolDay && expected > 0 && completed === expected,
  };
}

export function calculateStudentStats({ studentNo, dates, calendarByDate, recordsByKey, today, usageDayMode = "weekdays" }) {
  let completed = 0;
  let leave = 0;
  let expected = 0;

  for (const isoDate of dates) {
    if (isoDate > today) continue;
    const { isSchoolDay } = resolveSchoolDay(isoDate, calendarByDate, usageDayMode);
    if (!isSchoolDay) continue;

    const record = recordsByKey.get(`${studentNo}:${isoDate}`);
    if (record?.status === "leave") {
      leave += 1;
      continue;
    }

    expected += 1;
    if (record?.status === "completed") completed += 1;
  }

  return { completed, leave, expected, rate: formatRate(completed, expected) };
}
