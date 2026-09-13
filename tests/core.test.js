import assert from "node:assert/strict";
import {
  calculateDailyProgress,
  calculateStudentStats,
  formatRate,
  getMonthDates,
  getTaipeiIsoDate,
  getWeekdayLabel,
  isDefaultSchoolDay,
  resolveSchoolDay,
} from "../js/common.js";

assert.equal(getTaipeiIsoDate(new Date("2026-09-13T15:59:59Z")), "2026-09-13");
assert.equal(getTaipeiIsoDate(new Date("2026-09-13T16:00:00Z")), "2026-09-14");
assert.equal(getWeekdayLabel("2026-09-13"), "日");
assert.equal(getWeekdayLabel("2026-09-14"), "一");
assert.equal(isDefaultSchoolDay("2026-09-12"), false);
assert.equal(isDefaultSchoolDay("2026-09-14"), true);
assert.equal(isDefaultSchoolDay("2026-09-12", "everyday"), true);
assert.equal(getMonthDates("2026-09").length, 30);
assert.equal(getMonthDates("2028-02").length, 29);

const calendarByDate = new Map([
  ["2026-09-14", { date: "2026-09-14", is_school_day: false, label: "特殊假日" }],
  ["2026-09-19", { date: "2026-09-19", is_school_day: true, label: "補行上課" }],
]);

assert.deepEqual(resolveSchoolDay("2026-09-14", calendarByDate), { isSchoolDay: false, label: "特殊假日" });
assert.deepEqual(resolveSchoolDay("2026-09-19", calendarByDate), { isSchoolDay: true, label: "補行上課" });
assert.deepEqual(resolveSchoolDay("2026-09-20", calendarByDate), { isSchoolDay: false, label: "休" });
assert.deepEqual(resolveSchoolDay("2026-09-20", calendarByDate, "everyday"), { isSchoolDay: true, label: "" });
assert.deepEqual(resolveSchoolDay("2026-09-14", calendarByDate, "everyday"), {
  isSchoolDay: false,
  label: "特殊假日",
});

const dates = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-19", "2026-09-21"];
const recordsByKey = new Map([
  ["1:2026-09-14", { status: "completed" }], // 非上課日，必須忽略。
  ["1:2026-09-15", { status: "completed" }],
  ["1:2026-09-16", { status: "leave" }],
  ["1:2026-09-19", { status: "completed" }], // 週末補行上課。
]);

assert.deepEqual(
  calculateStudentStats({ studentNo: 1, dates, calendarByDate, recordsByKey, today: "2026-09-19" }),
  { completed: 2, leave: 1, expected: 2, rate: "100%" },
);
assert.deepEqual(
  calculateStudentStats({
    studentNo: 1,
    dates: ["2026-09-20"],
    calendarByDate: new Map(),
    recordsByKey: new Map([["1:2026-09-20", { status: "completed" }]]),
    today: "2026-09-20",
    usageDayMode: "everyday",
  }),
  { completed: 1, leave: 0, expected: 1, rate: "100%" },
);
assert.equal(formatRate(17, 18), "94.4%");
assert.equal(formatRate(0, 0), "—");

assert.deepEqual(calculateDailyProgress(new Map([[1, null], [2, null]])), {
  completed: 0,
  leave: 0,
  expected: 2,
  mode: "progress",
  allComplete: false,
});
assert.deepEqual(calculateDailyProgress(new Map([[1, { status: "completed" }], [2, { status: "completed" }]])), {
  completed: 2,
  leave: 0,
  expected: 2,
  mode: "progress",
  allComplete: true,
});
assert.deepEqual(calculateDailyProgress(new Map([[1, { status: "completed" }], [2, { status: "leave" }]])), {
  completed: 1,
  leave: 1,
  expected: 1,
  mode: "progress",
  allComplete: true,
});
assert.deepEqual(calculateDailyProgress(new Map([[1, { status: "leave" }], [2, { status: "leave" }]])), {
  completed: 0,
  leave: 2,
  expected: 0,
  mode: "no-expected",
  allComplete: false,
});
assert.equal(calculateDailyProgress(new Map(), false).mode, "offday");

console.log("core.test.js: all assertions passed");
