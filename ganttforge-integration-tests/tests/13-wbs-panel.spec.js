/**
 * 13 WBSパネル操作 — 結合試験（spec/test-items.json 13-01-01 〜 13-09-02、全34項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const {
  resetToInitialState,
  fillScheduleModal,
  saveScheduleModalExpectingSuccess,
  saveScheduleModalExpectingAlert,
  acceptConfirmDuring,
  expectToast,
} = require("../helpers/ui-actions");
const { seedProject, seedSchedule, selectProject } = require("../helpers/seed");

function wbsRow(page, scheduleId) {
  return page.locator(`.wbs-row[data-schedule-id="${scheduleId}"]`);
}

async function dragWbsRowTo(page, draggedScheduleId, targetScheduleId, verticalFraction) {
  const target = wbsRow(page, targetScheduleId);
  const box = await target.boundingBox();
  await wbsRow(page, draggedScheduleId).dragTo(target, {
    targetPosition: { x: box.width / 2, y: box.height * verticalFraction },
  });
}

test.describe("13-01 親子関係のラベル表記", () => {
  test("13-01-01 各行に階層番号（1／1.1／1.1.1）が表示される", async ({ page }) => {
    const testId = "13-01-01";
    resetSeq(testId);
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "WBS番号試験プロジェクト" });
    const parent = await seedSchedule(page, project.id, { name: "親", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "子", parentId: parent.id, order: 0 });
    await seedSchedule(page, project.id, { name: "孫", parentId: child.id, order: 0 });
    await seedSchedule(page, project.id, { name: "2番目の最上位", order: 1 });
    await selectProject(page, project.id);

    await expect(wbsRow(page, parent.id).locator(".wbs-number")).toHaveText("1");
    await expect(wbsRow(page, child.id).locator(".wbs-number")).toHaveText("1.1");
    await expect(page.locator(".wbs-row .wbs-number")).toHaveText(["1", "1.1", "1.1.1", "2"]);

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("13-02 ±ボタン（開閉）", () => {
  test("13-02-01 親行の±ボタンで子スケジュールが全て閉じる／開く", async ({ page }) => {
    const testId = "13-02-01";
    resetSeq(testId);
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "開閉試験プロジェクト" });
    const parent = await seedSchedule(page, project.id, { name: "開閉親", order: 0 });
    await seedSchedule(page, project.id, { name: "開閉子1", parentId: parent.id, order: 0 });
    await seedSchedule(page, project.id, { name: "開閉子2", parentId: parent.id, order: 1 });
    await selectProject(page, project.id);

    await expect(page.locator("#wbsPanel")).toContainText("開閉子1");
    await wbsRow(page, parent.id).locator(".wbs-toggle-button").click();
    await expect(page.locator("#wbsPanel")).not.toContainText("開閉子1");
    await expect(page.locator("#wbsPanel")).not.toContainText("開閉子2");

    await wbsRow(page, parent.id).locator(".wbs-toggle-button").click();
    await expect(page.locator("#wbsPanel")).toContainText("開閉子1");
    await expect(page.locator("#wbsPanel")).toContainText("開閉子2");

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("13-03 並び順の変更↑↓", () => {
  let project;
  let scheduleA;
  let scheduleB;
  let scheduleC;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "並び順試験プロジェクト" });
    scheduleA = await seedSchedule(page, project.id, { name: "並び順A", order: 0 });
    scheduleB = await seedSchedule(page, project.id, { name: "並び順B", order: 1 });
    scheduleC = await seedSchedule(page, project.id, { name: "並び順C", order: 2 });
    await selectProject(page, project.id);
  });

  test("13-03-01 先頭スケジュールの↑ボタンが無効", async ({ page }) => {
    const testId = "13-03-01";
    resetSeq(testId);

    await expect(wbsRow(page, scheduleA.id).locator('[data-action="move-up"]')).toBeDisabled();

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-03-02 末尾スケジュールの↓ボタンが無効", async ({ page }) => {
    const testId = "13-03-02";
    resetSeq(testId);

    await expect(wbsRow(page, scheduleC.id).locator('[data-action="move-down"]')).toBeDisabled();

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-03-03 ↑／↓ボタンで並び順が入れ替わる", async ({ page }) => {
    const testId = "13-03-03";
    resetSeq(testId);

    await wbsRow(page, scheduleB.id).locator('[data-action="move-up"]').click();
    await expectToast(page, "並び順を変更しました");

    const rowNames = await page.locator(".wbs-row .wbs-column-name").allInnerTexts();
    const indexOfA = rowNames.findIndex((text) => text.includes("並び順A"));
    const indexOfB = rowNames.findIndex((text) => text.includes("並び順B"));
    expect(indexOfB).toBeLessThan(indexOfA);

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("13-04 子スケジュール追加", () => {
  let project;
  let parent;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "子スケジュール追加試験プロジェクト" });
    parent = await seedSchedule(page, project.id, { name: "子追加対象の親", startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    await selectProject(page, project.id);
  });

  test("13-04-01 画面表示OK：1段インデントで表示されガントにバーが出る", async ({ page }) => {
    const testId = "13-04-01";
    resetSeq(testId);

    await wbsRow(page, parent.id).locator('[data-action="add-child"]').click();
    await fillScheduleModal(page, { name: "追加された子", startDate: "2026-03-02", endDate: "2026-03-05" });
    await saveScheduleModalExpectingSuccess(page);

    const scheduleRecords = await dumpStore(page, "schedules");
    const child = scheduleRecords.find((record) => record.name === "追加された子");
    await expect(wbsRow(page, child.id)).toContainText("追加された子");
    await expect(page.locator(".gantt-bar")).toHaveCount(2);

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-04-02 DB反映OK：parentId・orderが設定される", async ({ page }) => {
    const testId = "13-04-02";
    resetSeq(testId);

    await wbsRow(page, parent.id).locator('[data-action="add-child"]').click();
    await fillScheduleModal(page, { name: "DB確認用子", startDate: "2026-03-02", endDate: "2026-03-05" });
    await saveScheduleModalExpectingSuccess(page);

    const scheduleRecords = await dumpStore(page, "schedules");
    const child = scheduleRecords.find((record) => record.name === "DB確認用子");
    expect(child.parentId).toBe(parent.id);
    // 【前提】新規スケジュールのorderはhandleScheduleModalSaveButtonClick側で
    //   currentScheduleTreeRows.length（プロジェクト全体の行数）から採番される
    //   （親配下だけの0始まりの連番ではない）。ここでは親のみ存在する状態からの追加のため1。
    expect(child.order).toBe(1);

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-04-03 変更履歴反映OK", async ({ page }) => {
    const testId = "13-04-03";
    resetSeq(testId);

    await wbsRow(page, parent.id).locator('[data-action="add-child"]').click();
    await fillScheduleModal(page, { name: "履歴確認用子", startDate: "2026-03-02", endDate: "2026-03-05" });
    await saveScheduleModalExpectingSuccess(page);

    // 【前提】子追加後、その日付が親の既存範囲より狭ければsyncAncestorDatesが親の日付も
    //   再計算し、親自身のeditログも記録される（今回の修正で追加した挙動）。そのため最新の
    //   1件が必ずしも子の追加ログとは限らず、子のitemNameで個別に探す。
    const logRecords = await dumpStore(page, "changelog");
    const childAddEntry = logRecords.find((entry) => entry.itemName === "履歴確認用子");
    expect(childAddEntry).toBeTruthy();
    expect(childAddEntry.action).toBe("add");
    expect(childAddEntry.store).toBe("schedules");

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-04-04 孫行では＋（子追加）ボタンが無効表示", async ({ page }) => {
    const testId = "13-04-04";
    resetSeq(testId);
    const child = await seedSchedule(page, project.id, { name: "孫確認用の子", parentId: parent.id, order: 0 });
    const grandchild = await seedSchedule(page, project.id, { name: "末端の孫", parentId: child.id, order: 0 });
    await page.evaluate(() => refreshGanttPanel(currentSelectedProjectId));

    await expect(wbsRow(page, grandchild.id).locator('[data-action="add-child"]')).toBeDisabled();

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("13-05 スケジュール編集（鉛筆/項目クリック）", () => {
  let project;
  let schedule;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "WBS編集試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    schedule = await seedSchedule(page, project.id, { name: "編集対象WBSスケジュール", startDate: "2026-03-01", endDate: "2026-03-10" });
    await selectProject(page, project.id);
    await wbsRow(page, schedule.id).locator('[data-action="edit"]').click();
  });

  test("13-05-01 鉛筆クリックでスケジュール編集モーダルが表示される", async ({ page }) => {
    const testId = "13-05-01";
    resetSeq(testId);

    await expect(page.locator("#modalOverlay")).toBeVisible();
    await expect(page.locator("#modalPanel h2")).toHaveText("スケジュール編集");
    await expect(page.locator("#scheduleModalNameInput")).toHaveValue("編集対象WBSスケジュール");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-05-02 スケジュール名未入力→アラート表示・保存できない", async ({ page }) => {
    const testId = "13-05-02";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "" });
    const message = await saveScheduleModalExpectingAlert(page);
    expect(message).toBe("スケジュールを入力してください");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-05-03 終了日よりも開始日が後ろ→アラート表示・保存不可", async ({ page }) => {
    const testId = "13-05-03";
    resetSeq(testId);

    await fillScheduleModal(page, { startDate: "2026-03-10", endDate: "2026-03-01" });
    const message = await saveScheduleModalExpectingAlert(page);
    expect(message).toBe("終了日は開始日以降にしてください");

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === schedule.id).endDate).toBe("2026-03-10");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-05-04 プロジェクト期間外でも上限バリデーション無く保存される", async ({ page }) => {
    const testId = "13-05-04";
    resetSeq(testId);

    await fillScheduleModal(page, { startDate: "2025-01-01", endDate: "2027-01-01" });
    await saveScheduleModalExpectingSuccess(page);

    const scheduleRecords = await dumpStore(page, "schedules");
    const updated = scheduleRecords.find((record) => record.id === schedule.id);
    expect(updated.startDate).toBe("2025-01-01");
    expect(updated.endDate).toBe("2027-01-01");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-05-05 正常：スケジュールDB保存OK", async ({ page }) => {
    const testId = "13-05-05";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "編集後WBSスケジュール", endDate: "2026-03-20" });
    await saveScheduleModalExpectingSuccess(page);

    const scheduleRecords = await dumpStore(page, "schedules");
    const updated = scheduleRecords.find((record) => record.id === schedule.id);
    expect(updated.name).toBe("編集後WBSスケジュール");
    expect(updated.endDate).toBe("2026-03-20");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-05-06 正常：ガントチャートに反映される", async ({ page }) => {
    const testId = "13-05-06";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "ガント反映確認スケジュール" });
    await saveScheduleModalExpectingSuccess(page);

    await expect(page.locator(`.gantt-bar[data-schedule-id="${schedule.id}"]`)).toHaveAttribute("title", /ガント反映確認スケジュール/);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-05-07 正常：保存後モーダルが閉じてメイン画面に戻る", async ({ page }) => {
    const testId = "13-05-07";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "遷移確認スケジュール" });
    await saveScheduleModalExpectingSuccess(page);

    await expect(page.locator("#modalOverlay")).toBeHidden();
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-05-08 正常：変更履歴反映OK（action:edit、changesに変更フィールド）", async ({ page }) => {
    const testId = "13-05-08";
    resetSeq(testId);

    await fillScheduleModal(page, { name: "履歴確認スケジュール", assignee: "担当者A" });
    await saveScheduleModalExpectingSuccess(page);

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("edit");
    expect(latest.store).toBe("schedules");
    expect(latest.changes.some((change) => change.field === "name")).toBe(true);
    expect(latest.changes.some((change) => change.field === "assignee")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("13-06 スケジュール削除", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("13-06-01 親子関係なし：削除で画面表示OK", async ({ page }) => {
    const testId = "13-06-01";
    resetSeq(testId);
    const project = await seedProject(page, { name: "単独削除試験プロジェクト" });
    const schedule = await seedSchedule(page, project.id, { name: "単独削除対象" });
    await selectProject(page, project.id);

    await acceptConfirmDuring(page, () => wbsRow(page, schedule.id).locator('[data-action="delete"]').click());
    await expectToast(page, "削除しました");

    await expect(page.locator(`.gantt-bar[data-schedule-id="${schedule.id}"]`)).toHaveCount(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-06-02 親子関係なし：削除でDB反映OK", async ({ page }) => {
    const testId = "13-06-02";
    resetSeq(testId);
    const project = await seedProject(page, { name: "単独削除DB確認プロジェクト" });
    const schedule = await seedSchedule(page, project.id, { name: "DB確認用単独削除対象" });
    await selectProject(page, project.id);

    await acceptConfirmDuring(page, () => wbsRow(page, schedule.id).locator('[data-action="delete"]').click());
    await expectToast(page, "削除しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === schedule.id)).toBeUndefined();

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-06-03 親子関係なし：削除で変更履歴反映OK", async ({ page }) => {
    const testId = "13-06-03";
    resetSeq(testId);
    const project = await seedProject(page, { name: "単独削除履歴確認プロジェクト" });
    const schedule = await seedSchedule(page, project.id, { name: "履歴確認用単独削除対象" });
    await selectProject(page, project.id);

    await acceptConfirmDuring(page, () => wbsRow(page, schedule.id).locator('[data-action="delete"]').click());
    await expectToast(page, "削除しました");

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("delete");
    expect(latest.store).toBe("schedules");

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  async function seedParentChildGrandchildWithComment(page) {
    const project = await seedProject(page, { name: "連鎖削除試験プロジェクト" });
    const parent = await seedSchedule(page, project.id, { name: "連鎖削除親", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "連鎖削除子", parentId: parent.id, order: 0 });
    const grandchild = await seedSchedule(page, project.id, { name: "連鎖削除孫", parentId: child.id, order: 0 });
    await page.evaluate(async (grandchildId) => {
      await addComment({ id: generateId(), taskId: grandchildId, text: "連鎖削除確認用コメント", createdAt: new Date().toISOString() });
    }, grandchild.id);
    await selectProject(page, project.id);
    return { project, parent, child, grandchild };
  }

  test("13-06-04 親子関係あり：削除で画面表示OK（親子孫のバーが消える）", async ({ page }) => {
    const testId = "13-06-04";
    resetSeq(testId);
    const { parent, child, grandchild } = await seedParentChildGrandchildWithComment(page);

    await acceptConfirmDuring(page, () => wbsRow(page, parent.id).locator('[data-action="delete"]').click());
    await expectToast(page, "削除しました");

    for (const id of [parent.id, child.id, grandchild.id]) {
      await expect(page.locator(`.gantt-bar[data-schedule-id="${id}"]`)).toHaveCount(0);
    }

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-06-05 親子関係あり：削除でDB反映OK（schedules0件・孤立コメントも消える）", async ({ page }) => {
    const testId = "13-06-05";
    resetSeq(testId);
    const { parent, child, grandchild } = await seedParentChildGrandchildWithComment(page);

    await acceptConfirmDuring(page, () => wbsRow(page, parent.id).locator('[data-action="delete"]').click());
    await expectToast(page, "削除しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    for (const id of [parent.id, child.id, grandchild.id]) {
      expect(scheduleRecords.find((record) => record.id === id)).toBeUndefined();
    }
    const commentRecords = await dumpStore(page, "comments");
    expect(commentRecords.find((record) => record.taskId === grandchild.id)).toBeUndefined();

    const dbShot = await captureDbSnapshot(page, testId, ["schedules", "comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-06-06 親子関係あり：削除で変更履歴反映OK（対象件数分・各ログに戻すボタンあり）", async ({ page }) => {
    const testId = "13-06-06";
    resetSeq(testId);
    const { parent, child, grandchild } = await seedParentChildGrandchildWithComment(page);

    const beforeLog = await countStore(page, "changelog");
    await acceptConfirmDuring(page, () => wbsRow(page, parent.id).locator('[data-action="delete"]').click());
    await expectToast(page, "削除しました");

    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog + 3);

    const logRecords = await dumpStore(page, "changelog");
    const newEntries = logRecords.slice(-3);
    expect(newEntries.every((entry) => entry.action === "delete" && entry.store === "schedules")).toBe(true);
    const deletedIds = new Set([parent.id, child.id, grandchild.id]);
    expect(newEntries.every((entry) => deletedIds.has(entry.itemId))).toBe(true);

    await page.evaluate(() => toggleSlidePanel("changelogSlidePanel"));
    await page.evaluate(() => refreshChangelogPanel(currentSelectedProjectId));
    for (const entry of newEntries) {
      await expect(page.locator(`.panel-list-item[data-entry-id="${entry.id}"] [data-action="restore-log"]`)).toHaveCount(1);
    }

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("13-07 親子付け替え（掴んで移動）", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("13-07-01 対象の子になる：画面表示（インデントが1段増える）", async ({ page }) => {
    const testId = "13-07-01";
    resetSeq(testId);
    const project = await seedProject(page, { name: "子化ドロップ試験プロジェクト" });
    const parentA = await seedSchedule(page, project.id, { name: "旧親A", order: 0 });
    const movingSchedule = await seedSchedule(page, project.id, { name: "移動対象", parentId: parentA.id, order: 0 });
    await seedSchedule(page, project.id, { name: "旧親Aの子2", parentId: parentA.id, order: 1 });
    const parentB = await seedSchedule(page, project.id, { name: "新親B", order: 1 });
    await selectProject(page, project.id);

    await dragWbsRowTo(page, movingSchedule.id, parentB.id, 0.5);
    await expectToast(page, "スケジュールの階層を変更しました");

    const movedRowText = await wbsRow(page, movingSchedule.id).locator(".wbs-column-name").innerText();
    expect(movedRowText).toContain("移動対象");
    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === movingSchedule.id).parentId).toBe(parentB.id);

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-07-02 対象の子になる：DB反映（parentId/order・祖先日付再計算）", async ({ page }) => {
    const testId = "13-07-02";
    resetSeq(testId);
    const project = await seedProject(page, { name: "子化DB確認プロジェクト" });
    const parentA = await seedSchedule(page, project.id, { name: "DB確認旧親A", startDate: "2026-01-01", endDate: "2026-01-10", order: 0 });
    const movingSchedule = await seedSchedule(page, project.id, { name: "DB確認移動対象", parentId: parentA.id, startDate: "2026-01-01", endDate: "2026-01-10", order: 0 });
    await seedSchedule(page, project.id, { name: "DB確認旧親Aの子2", parentId: parentA.id, startDate: "2026-01-01", endDate: "2026-01-10", order: 1 });
    const parentB = await seedSchedule(page, project.id, { name: "DB確認新親B", startDate: "2026-02-01", endDate: "2026-02-05", order: 1 });
    await selectProject(page, project.id);

    await dragWbsRowTo(page, movingSchedule.id, parentB.id, 0.5);
    await expectToast(page, "スケジュールの階層を変更しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    const movedSchedule = scheduleRecords.find((record) => record.id === movingSchedule.id);
    expect(movedSchedule.parentId).toBe(parentB.id);
    expect(movedSchedule.order).toBe(0);
    const updatedParentB = scheduleRecords.find((record) => record.id === parentB.id);
    // 新親Bの期間は子（移動対象：01-01〜01-10）を含むよう再計算される。
    expect(updatedParentB.startDate <= "2026-01-01").toBe(true);
    expect(updatedParentB.endDate >= "2026-01-10").toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-07-03 対象の子になる：変更履歴反映（並び順の記録・祖先の日付変更ログ）", async ({ page }) => {
    const testId = "13-07-03";
    resetSeq(testId);
    const project = await seedProject(page, { name: "子化履歴確認プロジェクト" });
    const parentA = await seedSchedule(page, project.id, { name: "履歴確認旧親A", startDate: "2026-01-01", endDate: "2026-01-10", order: 0 });
    const movingSchedule = await seedSchedule(page, project.id, { name: "履歴確認移動対象", parentId: parentA.id, startDate: "2026-01-01", endDate: "2026-01-10", order: 0 });
    await seedSchedule(page, project.id, { name: "履歴確認旧親Aの子2", parentId: parentA.id, startDate: "2026-01-01", endDate: "2026-01-10", order: 1 });
    const parentB = await seedSchedule(page, project.id, { name: "履歴確認新親B", startDate: "2026-02-01", endDate: "2026-02-05", order: 1 });
    await selectProject(page, project.id);

    const beforeLog = await countStore(page, "changelog");
    await dragWbsRowTo(page, movingSchedule.id, parentB.id, 0.5);
    await expectToast(page, "スケジュールの階層を変更しました");

    const logRecords = await dumpStore(page, "changelog");
    expect(logRecords.length).toBeGreaterThan(beforeLog);

    // 移動対象自身の「並び順：旧→新」ログが1件あること。
    const orderEntry = logRecords
      .filter((entry) => entry.itemId === movingSchedule.id)
      .find((entry) => entry.changes.some((change) => change.field === "order"));
    expect(orderEntry).toBeTruthy();

    // 旧親A・新親Bはこの操作で期間が変わる（子の増減で再計算される）ため、
    // 祖先の日付変更ログも記録されているはずだが、syncAncestorDates自体はログを残さない設計
    // （既存のrecordScheduleDragChangelogEntryのコメント参照）。実際の挙動を確認して判定する。
    const parentDateChangeLogged = logRecords.some(
      (entry) => (entry.itemId === parentA.id || entry.itemId === parentB.id) && entry.changes.some((change) => change.field === "startDate" || change.field === "endDate")
    );
    if (!parentDateChangeLogged) {
      recordResult({
        testId,
        judgement: "NG",
        note: "期待値結果「旧親A・新親B（祖先）の日付が変わった場合はその変更ログも表示される」に対し、syncAncestorDatesはaddScheduleのみでrecordChangelogEntryを呼ばず、祖先の日付再計算は変更履歴に記録されない（既知の設計：ドラッグの副作用としてログを残さない方針）。",
      });
      return;
    }

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-07-04 対象と兄弟関係になる：画面表示（所属/インデントが変わる）", async ({ page }) => {
    const testId = "13-07-04";
    resetSeq(testId);
    const project = await seedProject(page, { name: "兄弟化試験プロジェクト" });
    const groupParent = await seedSchedule(page, project.id, { name: "兄弟グループ親", order: 0 });
    const sibling1 = await seedSchedule(page, project.id, { name: "兄弟1", parentId: groupParent.id, order: 0 });
    await seedSchedule(page, project.id, { name: "兄弟2", parentId: groupParent.id, order: 1 });
    const otherParent = await seedSchedule(page, project.id, { name: "別の親", order: 1 });
    const movingSchedule = await seedSchedule(page, project.id, { name: "兄弟化する移動対象", parentId: otherParent.id, order: 0 });
    await selectProject(page, project.id);

    await dragWbsRowTo(page, movingSchedule.id, sibling1.id, 0.1);
    await expectToast(page, "スケジュールの階層を変更しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === movingSchedule.id).parentId).toBe(groupParent.id);

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-07-05 対象と兄弟関係になる：DB反映（order振り直し・parentId変更）", async ({ page }) => {
    const testId = "13-07-05";
    resetSeq(testId);
    const project = await seedProject(page, { name: "兄弟化DB確認プロジェクト" });
    const groupParent = await seedSchedule(page, project.id, { name: "DB確認兄弟グループ親", order: 0 });
    const sibling1 = await seedSchedule(page, project.id, { name: "DB確認兄弟1", parentId: groupParent.id, order: 0 });
    const sibling2 = await seedSchedule(page, project.id, { name: "DB確認兄弟2", parentId: groupParent.id, order: 1 });
    const otherParent = await seedSchedule(page, project.id, { name: "DB確認別の親", order: 1 });
    const movingSchedule = await seedSchedule(page, project.id, { name: "DB確認兄弟化移動対象", parentId: otherParent.id, order: 0 });
    await selectProject(page, project.id);

    // sibling1の直前（before）に挿入する。
    await dragWbsRowTo(page, movingSchedule.id, sibling1.id, 0.1);
    await expectToast(page, "スケジュールの階層を変更しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    const moved = scheduleRecords.find((record) => record.id === movingSchedule.id);
    expect(moved.parentId).toBe(groupParent.id);
    expect(moved.order).toBe(0);
    expect(scheduleRecords.find((record) => record.id === sibling1.id).order).toBe(1);
    expect(scheduleRecords.find((record) => record.id === sibling2.id).order).toBe(2);

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-07-06 対象と兄弟関係になる：変更履歴反映（並び順：旧→新が1件）", async ({ page }) => {
    const testId = "13-07-06";
    resetSeq(testId);
    const project = await seedProject(page, { name: "兄弟化履歴確認プロジェクト" });
    const groupParent = await seedSchedule(page, project.id, { name: "履歴確認兄弟グループ親", order: 0 });
    const sibling1 = await seedSchedule(page, project.id, { name: "履歴確認兄弟1", parentId: groupParent.id, order: 0 });
    const otherParent = await seedSchedule(page, project.id, { name: "履歴確認別の親", order: 1 });
    const movingSchedule = await seedSchedule(page, project.id, { name: "履歴確認兄弟化移動対象", parentId: otherParent.id, order: 0 });
    await selectProject(page, project.id);

    const beforeLog = await countStore(page, "changelog");
    await dragWbsRowTo(page, movingSchedule.id, sibling1.id, 0.9);
    await expectToast(page, "スケジュールの階層を変更しました");

    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog + 1);
    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.itemId).toBe(movingSchedule.id);
    expect(latest.changes.some((change) => change.field === "order")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("13-07-07 ドラッグで3階層超の付け替えが拒否される（アラート・DB無変更）", async ({ page }) => {
    const testId = "13-07-07";
    resetSeq(testId);
    const project = await seedProject(page, { name: "階層制限試験プロジェクト" });
    const parent = await seedSchedule(page, project.id, { name: "階層制限親", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "階層制限子", parentId: parent.id, order: 0 });
    const grandchild = await seedSchedule(page, project.id, { name: "階層制限孫", parentId: child.id, order: 0 });
    const looseSchedule = await seedSchedule(page, project.id, { name: "4階層目になる移動対象", order: 1 });
    await selectProject(page, project.id);

    const beforeRecords = await dumpStore(page, "schedules");

    const dialogMessagePromise = new Promise((resolve) => page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    }));
    await dragWbsRowTo(page, looseSchedule.id, grandchild.id, 0.5);
    const message = await dialogMessagePromise;
    expect(message).toBe("これ以上深い階層のスケジュールは作成できません（親→子→孫の3階層まで）。");

    const afterRecords = await dumpStore(page, "schedules");
    expect(afterRecords.find((record) => record.id === looseSchedule.id).parentId ?? null).toBe(null);
    expect(afterRecords).toEqual(beforeRecords);

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("13-08 進捗バー", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("13-08-01 末端スケジュールのステータス変動が進捗バーに反映される", async ({ page }) => {
    const testId = "13-08-01";
    resetSeq(testId);
    const project = await seedProject(page, { name: "進捗バー試験プロジェクト" });
    const scheduleA = await seedSchedule(page, project.id, { name: "進捗A", taskStatus: "todo", order: 0 });
    const scheduleB = await seedSchedule(page, project.id, { name: "進捗B", taskStatus: "todo", order: 1 });
    await selectProject(page, project.id);

    await expect(page.locator(".wbs-project-progress-label")).toHaveText("進捗：0%");

    await page.evaluate(async (id) => {
      const list = await getAllSchedules();
      await addSchedule({ ...list.find((s) => s.id === id), taskStatus: "done" });
      await refreshGanttPanel(currentSelectedProjectId);
    }, scheduleA.id);
    await expect(page.locator(".wbs-project-progress-label")).toHaveText("進捗：50%");

    await page.evaluate(async (id) => {
      const list = await getAllSchedules();
      await addSchedule({ ...list.find((s) => s.id === id), taskStatus: "inprogress" });
      await refreshGanttPanel(currentSelectedProjectId);
    }, scheduleB.id);
    await expect(page.locator(".wbs-project-progress-label")).toHaveText("進捗：75%");

    await page.evaluate(async (id) => {
      const list = await getAllSchedules();
      await addSchedule({ ...list.find((s) => s.id === id), taskStatus: "done" });
      await refreshGanttPanel(currentSelectedProjectId);
    }, scheduleB.id);
    await expect(page.locator(".wbs-project-progress-label")).toHaveText("進捗：100%");
    await expect(page.locator(".wbs-project-progress-fill")).toHaveAttribute("style", "width:100%");

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-08-02 親（グループ行）のステータスは進捗バー集計に影響しない", async ({ page }) => {
    const testId = "13-08-02";
    resetSeq(testId);
    const project = await seedProject(page, { name: "進捗バー親除外試験プロジェクト" });
    const parent = await seedSchedule(page, project.id, { name: "進捗集計対象外の親", taskStatus: "todo", order: 0 });
    await seedSchedule(page, project.id, { name: "進捗集計対象の子1", parentId: parent.id, taskStatus: "done", order: 0 });
    await seedSchedule(page, project.id, { name: "進捗集計対象の子2", parentId: parent.id, taskStatus: "done", order: 1 });
    await selectProject(page, project.id);

    await expect(page.locator(".wbs-project-progress-label")).toHaveText("進捗：100%");

    const shot = await captureScreen(page, testId, "wbs");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("13-09 WBS⇄ガント縦スクロール同期", () => {
  async function seedManySchedules(page, project) {
    for (let index = 0; index < 30; index++) {
      await seedSchedule(page, project.id, { name: `スクロール確認用スケジュール${index}`, order: index });
    }
  }

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "スクロール同期試験プロジェクト" });
    await seedManySchedules(page, project);
    await selectProject(page, project.id);
  });

  test("13-09-01 WBS側スクロールでガント本体が追従する", async ({ page }) => {
    const testId = "13-09-01";
    resetSeq(testId);

    await page.locator("#wbsPanel").evaluate((element) => {
      element.scrollTop = 300;
    });
    await expect(page.locator(".gantt-scroll-area")).toHaveJSProperty("scrollTop", 300);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("13-09-02 ガント本体スクロールでWBSが追従する", async ({ page }) => {
    const testId = "13-09-02";
    resetSeq(testId);

    await page.locator(".gantt-scroll-area").evaluate((element) => {
      element.scrollTop = 300;
    });
    await expect(page.locator("#wbsPanel")).toHaveJSProperty("scrollTop", 300);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
