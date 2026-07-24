/**
 * 11 タスク管理 — 結合試験（spec/test-items.json 11-01-01 〜 11-01-17、全17項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel, closeSidePanel, acceptConfirmDuring, expectToast } = require("../helpers/ui-actions");
const { seedProject, seedTask, selectProject } = require("../helpers/seed");

async function openAddFormForColumn(page, columnStatus) {
  await page.locator(`.kanban-add-toggle-button[data-column-status="${columnStatus}"]`).click();
}

async function fillAndSubmitAddForm(page, columnStatus, { title, priority, dueDate }) {
  const form = page.locator(`.kanban-add-form[data-column-status="${columnStatus}"]`);
  if (title !== undefined) await form.locator(".kanban-add-title-input").fill(title);
  if (priority !== undefined) await form.locator(".kanban-add-priority-select").selectOption(String(priority));
  if (dueDate !== undefined) await form.locator(".kanban-add-duedate-input").fill(dueDate);
  await form.locator(".kanban-add-submit-button").click();
}

test.describe("11-01 タスク管理", () => {
  let project;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "タスク管理試験プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "kanban");
  });

  test("11-01-01 タスク名未入力→アラート表示・追加できない", async ({ page }) => {
    const testId = "11-01-01";
    resetSeq(testId);

    await openAddFormForColumn(page, "backlog");
    const before = await countStore(page, "tasks");
    const dialogPromise = new Promise((resolve) => page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    }));
    await fillAndSubmitAddForm(page, "backlog", { title: "" });
    const message = await dialogPromise;
    expect(message).toBe("タスク名を入力してください");
    expect(await countStore(page, "tasks")).toBe(before);

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-02 追加フォームの×ボタンで非表示になる", async ({ page }) => {
    const testId = "11-01-02";
    resetSeq(testId);

    await openAddFormForColumn(page, "backlog");
    await expect(page.locator('.kanban-add-form[data-column-status="backlog"]')).toBeVisible();

    await page.locator('.kanban-add-form[data-column-status="backlog"] .kanban-add-cancel-button').click();

    await expect(page.locator('.kanban-add-form[data-column-status="backlog"]')).toHaveCount(0);
    await expect(page.locator('.kanban-add-toggle-button[data-column-status="backlog"]')).toBeVisible();

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-03 タスク追加：画面表示OK（タスク管理に反映されガントには出ない）", async ({ page }) => {
    const testId = "11-01-03";
    resetSeq(testId);

    await openAddFormForColumn(page, "backlog");
    await fillAndSubmitAddForm(page, "backlog", { title: "画面確認用タスク" });

    await expect(page.locator("#kanbanPanelBody")).toContainText("画面確認用タスク");
    await closeSidePanel(page, "kanban");
    await expect(page.locator("#ganttPanelBody")).not.toContainText("画面確認用タスク");
    await expect(page.locator(".gantt-bar")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-04 タスク追加：DB反映OK（tasksのみ・schedulesには現れない）", async ({ page }) => {
    const testId = "11-01-04";
    resetSeq(testId);

    await openAddFormForColumn(page, "backlog");
    await fillAndSubmitAddForm(page, "backlog", { title: "DB確認用タスク" });

    const taskRecords = await dumpStore(page, "tasks");
    expect(taskRecords.find((record) => record.title === "DB確認用タスク")).toBeTruthy();
    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.name === "DB確認用タスク")).toBeUndefined();

    const dbShot = await captureDbSnapshot(page, testId, ["tasks", "schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("11-01-05 タスク追加：変更履歴パネルにエントリが表示される", async ({ page }) => {
    const testId = "11-01-05";
    resetSeq(testId);

    await openAddFormForColumn(page, "backlog");
    await fillAndSubmitAddForm(page, "backlog", { title: "変更履歴確認用タスク" });

    await closeSidePanel(page, "kanban");
    await openSidePanel(page, "changelog");
    await expect(page.locator("#changelogPanelBody")).toContainText("変更履歴確認用タスク");
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-add").first()).toBeVisible();

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-06 タスクのドラッグでステータス移動：画面表示OK（ガントには出ない）", async ({ page }) => {
    const testId = "11-01-06";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "ドラッグ確認用タスク", status: "backlog" });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await page.locator(`.kanban-card[data-task-id="${task.id}"]`).dragTo(page.locator('.kanban-column[data-column-status="doing"]'));

    await expect(page.locator('.kanban-column[data-column-status="doing"]')).toContainText("ドラッグ確認用タスク");
    await expect(page.locator(".gantt-bar")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-07 タスクのドラッグでステータス移動：DB反映OK（tasksのみ）", async ({ page }) => {
    const testId = "11-01-07";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "DB確認用ドラッグタスク", status: "backlog" });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await page.locator(`.kanban-card[data-task-id="${task.id}"]`).dragTo(page.locator('.kanban-column[data-column-status="done"]'));
    await expect(page.locator('.kanban-column[data-column-status="done"]')).toContainText("DB確認用ドラッグタスク");

    const taskRecords = await dumpStore(page, "tasks");
    const updated = taskRecords.find((record) => record.id === task.id);
    expect(updated.status).toBe("done");
    expect(updated.done).toBe(true);
    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords).toHaveLength(0);

    const dbShot = await captureDbSnapshot(page, testId, ["tasks", "schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("11-01-08 タスクのドラッグでステータス移動：変更履歴パネルに表示される", async ({ page }) => {
    const testId = "11-01-08";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "履歴確認用ドラッグタスク", status: "backlog" });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    // 【前提】handleTaskDragDropはrecordChangelogEntryを呼ばない実装のため、通常のドラッグでは
    //   変更履歴に記録されない。ここでは実際の挙動を確認したうえで判定する。
    await page.locator(`.kanban-card[data-task-id="${task.id}"]`).dragTo(page.locator('.kanban-column[data-column-status="doing"]'));
    await expect(page.locator('.kanban-column[data-column-status="doing"]')).toContainText("履歴確認用ドラッグタスク");

    await closeSidePanel(page, "kanban");
    await openSidePanel(page, "changelog");
    const panelText = await page.locator("#changelogPanelBody").innerText();
    const shot = await captureScreen(page, testId, "changelog-panel");

    if (panelText.includes("履歴確認用ドラッグタスク")) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: "期待値結果「変更履歴パネルにステータス変更のエントリが表示される」に対し、handleTaskDragDrop（index.html）はaddTaskのみでrecordChangelogEntryを呼んでおらず、ドラッグによるステータス変更は変更履歴に記録されない。",
      });
    }
  });

  test("11-01-09 タスク編集：タスク名未入力→アラート表示・保存できない", async ({ page }) => {
    const testId = "11-01-09";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "編集対象タスク" });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await page.locator(`.kanban-card[data-task-id="${task.id}"] [data-action="edit-task"]`).click();
    await page.locator("#taskModalTitleInput").fill("");
    const dialogPromise = new Promise((resolve) => page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    }));
    await page.locator("#taskModalSaveButton").click();
    const message = await dialogPromise;
    expect(message).toBe("タスク名を入力してください");

    const taskRecords = await dumpStore(page, "tasks");
    expect(taskRecords.find((record) => record.id === task.id).title).toBe("編集対象タスク");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-10 タスク編集：保存で画面表示OK（ガントには出ない）", async ({ page }) => {
    const testId = "11-01-10";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "編集前タスク" });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await page.locator(`.kanban-card[data-task-id="${task.id}"] [data-action="edit-task"]`).click();
    await page.locator("#taskModalTitleInput").fill("編集後タスク");
    await page.locator("#taskModalSaveButton").click();

    await expect(page.locator("#modalOverlay")).toBeHidden();
    await expect(page.locator("#kanbanPanelBody")).toContainText("編集後タスク");
    await expect(page.locator(".gantt-bar")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-11 タスク編集：DB反映OK", async ({ page }) => {
    const testId = "11-01-11";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "DB確認用編集前タスク" });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await page.locator(`.kanban-card[data-task-id="${task.id}"] [data-action="edit-task"]`).click();
    await page.locator("#taskModalTitleInput").fill("DB確認用編集後タスク");
    await page.locator("#taskModalSaveButton").click();
    await expect(page.locator("#modalOverlay")).toBeHidden();

    const taskRecords = await dumpStore(page, "tasks");
    expect(taskRecords.find((record) => record.id === task.id).title).toBe("DB確認用編集後タスク");

    const dbShot = await captureDbSnapshot(page, testId, ["tasks"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("11-01-12 タスク編集：変更履歴に action:edit, store:tasks, changesが表示される", async ({ page }) => {
    const testId = "11-01-12";
    resetSeq(testId);
    const task = await seedTask(page, project.id, { title: "履歴確認用編集タスク", priority: 2 });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await page.locator(`.kanban-card[data-task-id="${task.id}"] [data-action="edit-task"]`).click();
    await page.locator("#taskModalPrioritySelect").selectOption("1");
    await page.locator("#taskModalSaveButton").click();
    await expect(page.locator("#modalOverlay")).toBeHidden();

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("edit");
    expect(latest.store).toBe("tasks");
    expect(latest.changes.some((change) => change.field === "priority")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("11-01-13 完了済み一括削除（0件時）：「完了タスクがありません」トースト", async ({ page }) => {
    const testId = "11-01-13";
    resetSeq(testId);

    await page.locator("#clearDoneTasksButton").click();
    await expectToast(page, "完了タスクがありません");

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-14 完了済み一括削除：画面表示OK（完了列からまとめて消える）", async ({ page }) => {
    const testId = "11-01-14";
    resetSeq(testId);
    await seedTask(page, project.id, { title: "完了済みタスク1", status: "done", done: true, doneAt: new Date().toISOString() });
    await seedTask(page, project.id, { title: "完了済みタスク2", status: "done", done: true, doneAt: new Date().toISOString() });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));
    await expect(page.locator('.kanban-column[data-column-status="done"] .kanban-card')).toHaveCount(2);

    await acceptConfirmDuring(page, () => page.locator("#clearDoneTasksButton").click());

    await expect(page.locator('.kanban-column[data-column-status="done"] .kanban-card')).toHaveCount(0);

    const shot = await captureScreen(page, testId, "kanban-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("11-01-15 完了済み一括削除：DB反映OK", async ({ page }) => {
    const testId = "11-01-15";
    resetSeq(testId);
    await seedTask(page, project.id, { title: "DB確認用完了タスク1", status: "done", done: true, doneAt: new Date().toISOString() });
    await seedTask(page, project.id, { title: "DB確認用完了タスク2", status: "done", done: true, doneAt: new Date().toISOString() });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    await acceptConfirmDuring(page, () => page.locator("#clearDoneTasksButton").click());
    await expect(page.locator('.kanban-column[data-column-status="done"] .kanban-card')).toHaveCount(0);

    const taskRecords = await dumpStore(page, "tasks");
    expect(taskRecords.filter((record) => record.status === "done")).toHaveLength(0);

    const dbShot = await captureDbSnapshot(page, testId, ["tasks"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("11-01-16 完了済み一括削除：変更履歴に反映される", async ({ page }) => {
    const testId = "11-01-16";
    resetSeq(testId);
    await seedTask(page, project.id, { title: "履歴確認用完了タスク1", status: "done", done: true, doneAt: new Date().toISOString() });
    await seedTask(page, project.id, { title: "履歴確認用完了タスク2", status: "done", done: true, doneAt: new Date().toISOString() });
    await page.evaluate(() => refreshKanbanPanel(currentSelectedProjectId));

    const beforeLog = await countStore(page, "changelog");
    await acceptConfirmDuring(page, () => page.locator("#clearDoneTasksButton").click());
    await expect(page.locator('.kanban-column[data-column-status="done"] .kanban-card')).toHaveCount(0);

    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog + 2);
    const logRecords = await dumpStore(page, "changelog");
    const newEntries = logRecords.slice(-2);
    expect(newEntries.every((entry) => entry.action === "delete" && entry.store === "tasks")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("11-01-17 閉じるボタンでタスク管理パネルが閉じる", async ({ page }) => {
    const testId = "11-01-17";
    resetSeq(testId);

    await closeSidePanel(page, "kanban");
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
