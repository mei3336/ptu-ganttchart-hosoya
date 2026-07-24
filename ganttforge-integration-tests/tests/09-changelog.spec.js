/**
 * 09 変更履歴 — 結合試験（spec/test-items.json 09-01-01 〜 09-01-12、全12項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel, closeSidePanel, acceptConfirmDuring, expectToast } = require("../helpers/ui-actions");
const { seedProject, seedSchedule, selectProject } = require("../helpers/seed");

/**
 * 【前提】page はプロジェクト選択済みであること。
 * 【処理】addChangelogEntryを直接呼び、実際のUI操作を経由せず任意のaction/store/snapshotを
 *   持つ変更履歴エントリを1件作る（フィルタ・戻す機能の前提条件を機械的に満たすため）。
 * 【結果】作成したエントリのidを返す。
 */
async function seedChangelogEntry(page, { projectId, action, store, storeLabel, itemId, itemName, snapshot, changes = [] }) {
  return page.evaluate(
    async ({ projectId, action, store, storeLabel, itemId, itemName, snapshot, changes }) => {
      const entry = {
        id: generateId(),
        projectId,
        action,
        store,
        storeLabel,
        itemId,
        itemName,
        changes,
        snapshot,
        createdAt: new Date().toISOString(),
      };
      await addChangelogEntry(entry);
      return entry.id;
    },
    { projectId, action, store, storeLabel, itemId, itemName, snapshot, changes }
  );
}

async function seedProjectWithAddEditDeleteLogs(page) {
  const project = await seedProject(page, { name: "変更履歴試験プロジェクト" });
  await selectProject(page, project.id);
  await seedChangelogEntry(page, {
    projectId: project.id,
    action: "add",
    store: "projects",
    storeLabel: "プロジェクト",
    itemId: project.id,
    itemName: project.name,
    snapshot: project,
  });
  await seedChangelogEntry(page, {
    projectId: project.id,
    action: "edit",
    store: "projects",
    storeLabel: "プロジェクト",
    itemId: project.id,
    itemName: project.name,
    snapshot: project,
    changes: [{ field: "name", label: "名前", before: "旧名前", after: project.name }],
  });
  await seedChangelogEntry(page, {
    projectId: project.id,
    action: "delete",
    store: "schedules",
    storeLabel: "スケジュール",
    itemId: "deleted-schedule-1",
    itemName: "削除済みスケジュール",
    snapshot: { id: "deleted-schedule-1", projectId: project.id, parentId: null, name: "削除済みスケジュール", startDate: "2026-01-01", endDate: "2026-01-05", assignee: "", taskStatus: "todo", notes: "", color: "#2563EB", order: 0 },
  });
  return project;
}

test.describe("09-01 変更履歴", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("09-01-01 「すべて」タグ：全種別が表示され件数内訳がDBと一致する", async ({ page }) => {
    const testId = "09-01-01";
    resetSeq(testId);
    await seedProjectWithAddEditDeleteLogs(page);
    await openSidePanel(page, "changelog");

    const actualCount = await countStore(page, "changelog");
    await expect(page.locator("#changelogPanelBody .panel-list-item")).toHaveCount(actualCount);
    await expect(page.locator("#changelogSummary")).toHaveText(`全${actualCount}件（追加1・変更1・削除1）`);

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-02 「追加」タグ：追加種別のみ表示され件数内訳がDBと一致する", async ({ page }) => {
    const testId = "09-01-02";
    resetSeq(testId);
    await seedProjectWithAddEditDeleteLogs(page);
    await openSidePanel(page, "changelog");

    await page.locator('[data-changelog-filter="add"]').click();
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-add")).toHaveCount(1);
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-edit")).toHaveCount(0);
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-delete")).toHaveCount(0);
    await expect(page.locator("#changelogSummary")).toHaveText("全3件（追加1・変更1・削除1）");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-03 「変更」タグ：変更種別のみ表示され件数内訳がDBと一致する", async ({ page }) => {
    const testId = "09-01-03";
    resetSeq(testId);
    await seedProjectWithAddEditDeleteLogs(page);
    await openSidePanel(page, "changelog");

    await page.locator('[data-changelog-filter="edit"]').click();
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-edit")).toHaveCount(1);
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-add")).toHaveCount(0);
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-delete")).toHaveCount(0);
    await expect(page.locator("#changelogSummary")).toHaveText("全3件（追加1・変更1・削除1）");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-04 「削除」タグ：削除種別のみ表示され件数内訳がDBと一致する", async ({ page }) => {
    const testId = "09-01-04";
    resetSeq(testId);
    await seedProjectWithAddEditDeleteLogs(page);
    await openSidePanel(page, "changelog");

    await page.locator('[data-changelog-filter="delete"]').click();
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-delete")).toHaveCount(1);
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-add")).toHaveCount(0);
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-edit")).toHaveCount(0);
    await expect(page.locator("#changelogSummary")).toHaveText("全3件（追加1・変更1・削除1）");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-05 全削除（0件時）：「履歴がありません」トースト", async ({ page }) => {
    const testId = "09-01-05";
    resetSeq(testId);
    const project = await seedProject(page, { name: "履歴0件プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "changelog");

    expect(await countStore(page, "changelog")).toBe(0);
    await page.locator("#clearChangelogButton").click();
    await expectToast(page, "履歴がありません");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-06 全削除（1件以上）：一覧が空になる", async ({ page }) => {
    const testId = "09-01-06";
    resetSeq(testId);
    await seedProjectWithAddEditDeleteLogs(page);
    await openSidePanel(page, "changelog");

    await acceptConfirmDuring(page, () => page.locator("#clearChangelogButton").click());
    await expectToast(page, "変更履歴を削除しました");

    await expect(page.locator("#changelogPanelBody")).toContainText("変更履歴がありません。");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-07 全削除：changelogストアが0件になる", async ({ page }) => {
    const testId = "09-01-07";
    resetSeq(testId);
    await seedProjectWithAddEditDeleteLogs(page);
    await openSidePanel(page, "changelog");

    await acceptConfirmDuring(page, () => page.locator("#clearChangelogButton").click());
    await expectToast(page, "変更履歴を削除しました");

    expect(await countStore(page, "changelog")).toBe(0);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("09-01-08 変更タブ「戻す」：画面反映OK（ボタン非表示・復元済みラベル表示）", async ({ page }) => {
    const testId = "09-01-08";
    resetSeq(testId);
    const project = await seedProject(page, { name: "編集戻す試験プロジェクト" });
    const schedule = await seedSchedule(page, project.id, { name: "編集後の名前" });
    await selectProject(page, project.id);
    const entryId = await seedChangelogEntry(page, {
      projectId: project.id,
      action: "edit",
      store: "schedules",
      storeLabel: "スケジュール",
      itemId: schedule.id,
      itemName: "編集前の名前",
      snapshot: { ...schedule, name: "編集前の名前" },
      changes: [{ field: "name", label: "名前", before: "編集前の名前", after: "編集後の名前" }],
    });
    await openSidePanel(page, "changelog");

    const entryRow = page.locator(`.panel-list-item[data-entry-id="${entryId}"]`);
    await acceptConfirmDuring(page, () => entryRow.locator('[data-action="restore-log"]').click());
    await expectToast(page, /を復元しました/);

    await expect(page.locator("#wbsPanel")).toContainText("編集前の名前");
    await expect(entryRow.locator('[data-action="restore-log"]')).toHaveCount(0);
    await expect(entryRow).toContainText("復元済み");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-09 変更タブ「戻す」：DB反映OK（restoredAt追記・復元先ストア更新）", async ({ page }) => {
    const testId = "09-01-09";
    resetSeq(testId);
    const project = await seedProject(page, { name: "編集戻すDB確認プロジェクト" });
    const schedule = await seedSchedule(page, project.id, { name: "編集後の名前2" });
    await selectProject(page, project.id);
    const entryId = await seedChangelogEntry(page, {
      projectId: project.id,
      action: "edit",
      store: "schedules",
      storeLabel: "スケジュール",
      itemId: schedule.id,
      itemName: "編集前の名前2",
      snapshot: { ...schedule, name: "編集前の名前2" },
      changes: [{ field: "name", label: "名前", before: "編集前の名前2", after: "編集後の名前2" }],
    });
    await openSidePanel(page, "changelog");

    const entryRow = page.locator(`.panel-list-item[data-entry-id="${entryId}"]`);
    await acceptConfirmDuring(page, () => entryRow.locator('[data-action="restore-log"]').click());
    await expectToast(page, /を復元しました/);

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === schedule.id).name).toBe("編集前の名前2");

    const changelogRecords = await dumpStore(page, "changelog");
    const restoredEntry = changelogRecords.find((record) => record.id === entryId);
    expect(restoredEntry.restoredAt).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["schedules", "changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("09-01-10 削除タブ「戻す」：画面反映OK（ボタン非表示・復元済みラベル表示）", async ({ page }) => {
    const testId = "09-01-10";
    resetSeq(testId);
    const project = await seedProject(page, { name: "削除戻す試験プロジェクト" });
    await selectProject(page, project.id);
    const deletedSchedule = { id: "deleted-schedule-restore-1", projectId: project.id, parentId: null, name: "復元されるスケジュール", startDate: "2026-02-01", endDate: "2026-02-10", assignee: "", taskStatus: "todo", notes: "", color: "#2563EB", order: 0 };
    const entryId = await seedChangelogEntry(page, {
      projectId: project.id,
      action: "delete",
      store: "schedules",
      storeLabel: "スケジュール",
      itemId: deletedSchedule.id,
      itemName: deletedSchedule.name,
      snapshot: deletedSchedule,
    });
    await openSidePanel(page, "changelog");
    await expect(page.locator("#wbsPanel")).not.toContainText("復元されるスケジュール");

    const entryRow = page.locator(`.panel-list-item[data-entry-id="${entryId}"]`);
    await acceptConfirmDuring(page, () => entryRow.locator('[data-action="restore-log"]').click());
    await expectToast(page, /を復元しました/);

    await expect(page.locator("#wbsPanel")).toContainText("復元されるスケジュール");
    await expect(entryRow.locator('[data-action="restore-log"]')).toHaveCount(0);
    await expect(entryRow).toContainText("復元済み");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("09-01-11 削除タブ「戻す」：DB反映OK（restoredAt追記・復元先ストア更新）", async ({ page }) => {
    const testId = "09-01-11";
    resetSeq(testId);
    const project = await seedProject(page, { name: "削除戻すDB確認プロジェクト" });
    await selectProject(page, project.id);
    const deletedSchedule = { id: "deleted-schedule-restore-2", projectId: project.id, parentId: null, name: "DB確認用の復元スケジュール", startDate: "2026-02-01", endDate: "2026-02-10", assignee: "", taskStatus: "todo", notes: "", color: "#2563EB", order: 0 };
    const entryId = await seedChangelogEntry(page, {
      projectId: project.id,
      action: "delete",
      store: "schedules",
      storeLabel: "スケジュール",
      itemId: deletedSchedule.id,
      itemName: deletedSchedule.name,
      snapshot: deletedSchedule,
    });
    await openSidePanel(page, "changelog");

    const entryRow = page.locator(`.panel-list-item[data-entry-id="${entryId}"]`);
    await acceptConfirmDuring(page, () => entryRow.locator('[data-action="restore-log"]').click());
    await expectToast(page, /を復元しました/);

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === deletedSchedule.id)).toBeTruthy();

    const changelogRecords = await dumpStore(page, "changelog");
    expect(changelogRecords.find((record) => record.id === entryId).restoredAt).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["schedules", "changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("09-01-12 閉じるボタンで変更履歴パネルが閉じる", async ({ page }) => {
    const testId = "09-01-12";
    resetSeq(testId);
    const project = await seedProject(page, { name: "閉じるボタン確認プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "changelog");

    await closeSidePanel(page, "changelog");
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
