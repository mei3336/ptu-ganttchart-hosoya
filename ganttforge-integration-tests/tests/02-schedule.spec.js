/**
 * 02 スケジュール追加 — 結合試験（spec/test-items.json 02-01-01 〜 02-01-07、全7項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const {
  resetToInitialState,
  openAddScheduleModal,
  fillScheduleModal,
  saveScheduleModalExpectingSuccess,
  saveScheduleModalExpectingAlert,
  openSidePanel,
  expectToast,
} = require("../helpers/ui-actions");
const { seedProject, selectProject } = require("../helpers/seed");

test.describe("02-01 スケジュール追加", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "スケジュール試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    await selectProject(page, project.id);
    await openAddScheduleModal(page);
  });

  test("02-01-01 スケジュール名未入力→アラート表示・保存されない", async ({ page }) => {
    const testId = "02-01-01";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "", startDate: "2026-03-01", endDate: "2026-03-10" });
    const before = await countStore(page, "schedules");
    const message = await saveScheduleModalExpectingAlert(page);
    expect(message).toBe("スケジュールを入力してください");
    const after = await countStore(page, "schedules");
    expect(after).toBe(before);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("02-01-02 終了日よりも開始日が後ろ→アラート表示・保存不可", async ({ page }) => {
    const testId = "02-01-02";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "結合試験スケジュール", startDate: "2026-03-10", endDate: "2026-03-01" });
    const before = await countStore(page, "schedules");
    const message = await saveScheduleModalExpectingAlert(page);
    expect(message).toBe("終了日は開始日以降にしてください");
    const after = await countStore(page, "schedules");
    expect(after).toBe(before);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("02-01-03 プロジェクト期間外の日付でも上限バリデーションは無く保存される", async ({ page }) => {
    const testId = "02-01-03";
    resetSeq(testId);

    // プロジェクト期間は2026-01-01〜2026-12-31。意図的にその外側の日付を入力する。
    await fillScheduleModal(page, { name: "期間外スケジュール", startDate: "2025-01-01", endDate: "2027-01-01" });
    await saveScheduleModalExpectingSuccess(page);

    const records = await dumpStore(page, "schedules");
    const created = records.find((record) => record.name === "期間外スケジュール");
    expect(created).toBeTruthy();
    expect(created.startDate).toBe("2025-01-01");
    expect(created.endDate).toBe("2027-01-01");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("02-01-04 正常：スケジュールDB保存OK", async ({ page }) => {
    const testId = "02-01-04";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "結合試験スケジュールA", startDate: "2026-03-01", endDate: "2026-03-10" });
    await saveScheduleModalExpectingSuccess(page);

    const records = await dumpStore(page, "schedules");
    const created = records.find((record) => record.name === "結合試験スケジュールA");
    expect(created).toBeTruthy();
    expect(created.startDate).toBe("2026-03-01");
    expect(created.endDate).toBe("2026-03-10");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("02-01-05 正常：ガントにバーが表示されトースト表示", async ({ page }) => {
    const testId = "02-01-05";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "結合試験スケジュールB", startDate: "2026-03-01", endDate: "2026-03-10" });
    await saveScheduleModalExpectingSuccess(page);
    await expectToast(page, "保存しました");

    await expect(page.locator(".gantt-bar")).toHaveCount(1);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("02-01-06 正常：保存後モーダルが閉じてメイン画面に戻る", async ({ page }) => {
    const testId = "02-01-06";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "結合試験スケジュールC", startDate: "2026-03-01", endDate: "2026-03-10" });
    await saveScheduleModalExpectingSuccess(page);

    await expect(page.locator("#modalOverlay")).toBeHidden();
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("02-01-07 正常：変更履歴反映OK（action:add、changes空、戻すボタン無し）", async ({ page }) => {
    const testId = "02-01-07";
    resetSeq(testId);

    const beforeLog = await countStore(page, "changelog");
    await fillScheduleModal(page, { name: "結合試験スケジュールD", startDate: "2026-03-01", endDate: "2026-03-10" });
    await saveScheduleModalExpectingSuccess(page);
    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog + 1);

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("add");
    expect(latest.store).toBe("schedules");
    expect(latest.changes).toEqual([]);

    await openSidePanel(page, "changelog");
    const latestEntryRow = page.locator(`.panel-list-item[data-entry-id="${latest.id}"]`);
    await expect(latestEntryRow).toBeVisible();
    await expect(latestEntryRow.locator('[data-action="restore-log"]')).toHaveCount(0);

    const shot = await captureScreen(page, testId, "changelog");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
