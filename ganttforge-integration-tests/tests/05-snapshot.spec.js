/**
 * 05 スナップショット — 結合試験（spec/test-items.json 05-01-01 〜 05-01-12、全12項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const {
  resetToInitialState,
  openSidePanel,
  closeSidePanel,
  acceptConfirmDuring,
  acceptPromptWithTextDuring,
  expectToast,
} = require("../helpers/ui-actions");
const { seedProject, seedSchedule, selectProject } = require("../helpers/seed");

async function seedProjectWithSchedule(page) {
  const project = await seedProject(page, { name: "スナップショット試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
  const schedule = await seedSchedule(page, project.id, { name: "元スケジュール", startDate: "2026-03-01", endDate: "2026-03-10" });
  await selectProject(page, project.id);
  return { project, schedule };
}

async function saveSnapshotNamed(page, name) {
  await acceptPromptWithTextDuring(page, name, () => page.locator("#saveSnapshotButton").click());
  await expectToast(page, "スナップショットを保存しました");
}

test.describe("05-01 スナップショット", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    await seedProjectWithSchedule(page);
    await openSidePanel(page, "snapshot");
  });

  test("05-01-01 保存画面OK：一覧に必要な情報が表示される", async ({ page }) => {
    const testId = "05-01-01";
    resetSeq(testId);

    await saveSnapshotNamed(page, "スナップショット試験プロジェクト - 2026-03-15");

    const listItem = page.locator("#snapshotSlidePanel .panel-list-item").first();
    const listItemText = await listItem.innerText();

    // 【前提】基本設計書7章「一覧表示｜プロジェクト名＋日付、作成日時、スケジュール件数、
    //   プロジェクト期間を表示」が仕様。実装（renderSnapshotListToHtml）はname（プロジェクト名＋
    //   日付を含む）とcreatedAtしか描画しておらず、スケジュール件数・プロジェクト期間は
    //   一覧上に表示されない。既知の非整合リスト（幽霊レコード等）には含まれない新規の
    //   仕様不一致のため、ここでは実際の表示内容を確認した上でOK/NGを判定し、
    //   Playwright自体は（誤検知でsuite全体を止めないよう）NGでも例外を投げない。
    const hasNameWithProjectAndDate = listItemText.includes("スナップショット試験プロジェクト - 2026-03-15");
    const hasCreatedAt = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(listItemText);
    const hasScheduleCount = /\d+件/.test(listItemText);
    const hasProjectPeriod = listItemText.includes("2026-01-01") && listItemText.includes("2026-12-31");

    const shot = await captureScreen(page, testId, "snapshot-panel");
    if (hasNameWithProjectAndDate && hasCreatedAt && hasScheduleCount && hasProjectPeriod) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      const missing = [
        !hasNameWithProjectAndDate && "プロジェクト名＋日付",
        !hasCreatedAt && "作成日時",
        !hasScheduleCount && "スケジュール件数",
        !hasProjectPeriod && "プロジェクト期間",
      ].filter(Boolean);
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: `基本設計書7章の仕様に対し一覧表示に不足あり: ${missing.join("・")}が表示されていない（実際の表示: "${listItemText.replace(/\n/g, " / ")}"）`,
      });
    }
  });

  test("05-01-02 保存DB OK：snapshotsストアに1件保存される", async ({ page }) => {
    const testId = "05-01-02";
    resetSeq(testId);

    await saveSnapshotNamed(page, "DB確認用スナップショット");

    const snapshotRecords = await dumpStore(page, "snapshots");
    expect(snapshotRecords).toHaveLength(1);
    expect(snapshotRecords[0].data.project).toBeTruthy();
    expect(snapshotRecords[0].data.schedules.length).toBeGreaterThan(0);

    const dbShot = await captureDbSnapshot(page, testId, ["snapshots"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("05-01-03 差分比較：差分がない場合は0件表示", async ({ page }) => {
    const testId = "05-01-03";
    resetSeq(testId);

    await saveSnapshotNamed(page, "差分なし確認用");
    await page.locator('[data-action="compare-snapshot"]').first().click();

    await expect(page.locator(".snapshot-compare-result")).toHaveCount(0);
    await expect(page.locator("#snapshotSlidePanel")).toContainText("差分なしです。");

    const shot = await captureScreen(page, testId, "snapshot-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-04 差分比較：差分がある場合は追加/変更/削除に分類される", async ({ page }) => {
    const testId = "05-01-04";
    resetSeq(testId);

    await saveSnapshotNamed(page, "差分あり確認用");
    // スナップショット後にスケジュール名を変更する（直接IndexedDBを書き換え、画面を再取得）。
    const scheduleRecords = await dumpStore(page, "schedules");
    const target = scheduleRecords[0];
    await page.evaluate(async (updated) => {
      await addSchedule(updated);
    }, { ...target, name: "変更後スケジュール名" });
    // スナップショットパネルは開いた瞬間にしか再取得しないため、直接refreshして最新データを反映させる。
    await page.evaluate(async () => {
      await refreshSnapshotPanel(currentSelectedProjectId);
    });

    await page.locator('[data-action="compare-snapshot"]').first().click();
    const compareResult = page.locator(".snapshot-compare-result");
    await expect(compareResult).toContainText("変更");
    await expect(compareResult).toContainText("スケジュール名");
    await expect(compareResult).toContainText("変更後スケジュール名");

    const shot = await captureScreen(page, testId, "snapshot-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-05 復元（差分あり）：トースト表示とガントの復元", async ({ page }) => {
    const testId = "05-01-05";
    resetSeq(testId);

    await saveSnapshotNamed(page, "復元確認用");
    const scheduleRecords = await dumpStore(page, "schedules");
    const target = scheduleRecords[0];
    await page.evaluate(async (updated) => {
      await addSchedule(updated);
      await refreshGanttPanel(currentSelectedProjectId);
      await refreshSnapshotPanel(currentSelectedProjectId);
    }, { ...target, name: "復元前に変更した名前" });
    await expect(page.locator("#wbsPanel")).toContainText("復元前に変更した名前");

    await acceptConfirmDuring(page, () => page.locator('[data-action="restore-snapshot"]').first().click());
    await expectToast(page, /に復元しました/);

    await expect(page.locator("#wbsPanel")).toContainText("元スケジュール");
    await expect(page.locator("#wbsPanel")).not.toContainText("復元前に変更した名前");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-06 復元（差分あり）：schedules/projectsがスナップショット時点に置換されchangelog無記録", async ({ page }) => {
    const testId = "05-01-06";
    resetSeq(testId);

    await saveSnapshotNamed(page, "DB復元確認用");
    const scheduleRecords = await dumpStore(page, "schedules");
    const target = scheduleRecords[0];
    await page.evaluate(async (updated) => {
      await addSchedule(updated);
    }, { ...target, name: "復元前に変更した名前" });

    const beforeLog = await countStore(page, "changelog");
    await acceptConfirmDuring(page, () => page.locator('[data-action="restore-snapshot"]').first().click());
    await expectToast(page, /に復元しました/);

    const restoredSchedules = await dumpStore(page, "schedules");
    expect(restoredSchedules.find((record) => record.id === target.id).name).toBe("元スケジュール");

    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["schedules", "projects", "changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("05-01-07 復元（差分なし）：エラー無く内容も変化しない", async ({ page }) => {
    const testId = "05-01-07";
    resetSeq(testId);

    await saveSnapshotNamed(page, "差分なし復元確認用");
    const beforeSchedules = await dumpStore(page, "schedules");

    await acceptConfirmDuring(page, () => page.locator('[data-action="restore-snapshot"]').first().click());
    await expectToast(page, /に復元しました/);

    const afterSchedules = await dumpStore(page, "schedules");
    expect(afterSchedules).toEqual(beforeSchedules);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-08 削除：画面表示OK（一覧から消える）", async ({ page }) => {
    const testId = "05-01-08";
    resetSeq(testId);

    await saveSnapshotNamed(page, "削除確認用");
    await expect(page.locator("#snapshotSlidePanel .panel-list-item")).toHaveCount(1);

    await acceptConfirmDuring(page, () => page.locator('[data-action="delete-snapshot"]').first().click());

    await expect(page.locator("#snapshotSlidePanel .panel-list-item")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "snapshot-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-09 削除：DB反映OK（snapshotsストアから消える）", async ({ page }) => {
    const testId = "05-01-09";
    resetSeq(testId);

    await saveSnapshotNamed(page, "DB削除確認用");
    const before = await dumpStore(page, "snapshots");
    expect(before).toHaveLength(1);

    await acceptConfirmDuring(page, () => page.locator('[data-action="delete-snapshot"]').first().click());

    const after = await dumpStore(page, "snapshots");
    expect(after).toHaveLength(0);

    const dbShot = await captureDbSnapshot(page, testId, ["snapshots"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("05-01-10 ヘッダー件数：保存で+1される", async ({ page }) => {
    const testId = "05-01-10";
    resetSeq(testId);

    await expect(page.locator("#snapshotCountBadge")).toHaveText("0件");
    await saveSnapshotNamed(page, "件数確認用A");
    await expect(page.locator("#snapshotCountBadge")).toHaveText("1件");

    const shot = await captureScreen(page, testId, "snapshot-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-11 ヘッダー件数：削除で-1される", async ({ page }) => {
    const testId = "05-01-11";
    resetSeq(testId);

    await saveSnapshotNamed(page, "件数確認用B");
    await expect(page.locator("#snapshotCountBadge")).toHaveText("1件");

    await acceptConfirmDuring(page, () => page.locator('[data-action="delete-snapshot"]').first().click());
    await expect(page.locator("#snapshotCountBadge")).toHaveText("0件");

    const shot = await captureScreen(page, testId, "snapshot-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("05-01-12 閉じるボタンでパネルが閉じてメイン画面に戻る", async ({ page }) => {
    const testId = "05-01-12";
    resetSeq(testId);

    await closeSidePanel(page, "snapshot");
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
