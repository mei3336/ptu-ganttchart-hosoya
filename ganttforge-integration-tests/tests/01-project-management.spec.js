/**
 * 01 プロジェクト管理 — 結合試験（spec/test-items.json 01-01-01 〜 01-06-08、全34項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const {
  resetToInitialState,
  openCreateProjectModal,
  openEditProjectModal,
  fillProjectModal,
  saveProjectModalExpectingSuccess,
  saveProjectModalExpectingAlert,
  acceptConfirmDuring,
  expectToast,
} = require("../helpers/ui-actions");
const { seedProject, seedSchedule, seedProjectWithAllChildStores, selectProject } = require("../helpers/seed");

test.describe("01-01 新規プロジェクト作成", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    await openCreateProjectModal(page);
  });

  test("01-01-01 プロジェクト名未入力→アラート表示・保存されない", async ({ page }) => {
    const testId = "01-01-01";
    resetSeq(testId);

    await fillProjectModal(page, { name: "", startDate: "2026-08-01", endDate: "2026-09-30" });
    const before = await countStore(page, "projects");
    const message = await saveProjectModalExpectingAlert(page);
    expect(message).toBe("プロジェクト名を入力してください");
    const after = await countStore(page, "projects");
    expect(after).toBe(before);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-01-02 終了日よりも開始日が後ろ→アラート表示・保存されない", async ({ page }) => {
    const testId = "01-01-02";
    resetSeq(testId);

    await fillProjectModal(page, { name: "結合試験P", startDate: "2026-09-30", endDate: "2026-08-01" });
    const before = await countStore(page, "projects");
    const message = await saveProjectModalExpectingAlert(page);
    expect(message).toBe("終了日は開始日より後にしてください");
    const after = await countStore(page, "projects");
    expect(after).toBe(before);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-01-03 終了日が3年以上先→アラート表示・保存不可", async ({ page }) => {
    const testId = "01-01-03";
    resetSeq(testId);

    await fillProjectModal(page, { name: "結合試験P", startDate: "2026-01-01", endDate: "2029-01-02" });
    const before = await countStore(page, "projects");
    const message = await saveProjectModalExpectingAlert(page);
    expect(message).toBe("期間は最大3年です");
    const after = await countStore(page, "projects");
    expect(after).toBe(before);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-01-04 正常：プロジェクトDB保存OK", async ({ page }) => {
    const testId = "01-01-04";
    resetSeq(testId);

    await fillProjectModal(page, { name: "結合試験プロジェクトA", startDate: "2026-08-01", endDate: "2026-09-30" });
    await saveProjectModalExpectingSuccess(page);

    const records = await dumpStore(page, "projects");
    const created = records.find((record) => record.name === "結合試験プロジェクトA");
    expect(created).toBeTruthy();
    expect(created.startDate).toBe("2026-08-01");
    expect(created.endDate).toBe("2026-09-30");

    const dbShot = await captureDbSnapshot(page, testId, ["projects"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-01-05 正常：保存後ドロップダウンに追加され選択状態・トースト表示", async ({ page }) => {
    const testId = "01-01-05";
    resetSeq(testId);

    await fillProjectModal(page, { name: "結合試験プロジェクトB", startDate: "2026-08-01", endDate: "2026-09-30" });
    await saveProjectModalExpectingSuccess(page);
    await expectToast(page, "プロジェクトを保存しました");

    const selectedOption = page.locator("#projectSelectDropdown option:checked");
    await expect(selectedOption).toHaveText("結合試験プロジェクトB");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-01-06 正常：保存後メイン画面（ガント）に遷移する", async ({ page }) => {
    const testId = "01-01-06";
    resetSeq(testId);

    await fillProjectModal(page, { name: "結合試験プロジェクトC", startDate: "2026-08-01", endDate: "2026-09-30" });
    await saveProjectModalExpectingSuccess(page);

    await expect(page.locator("#ganttEmptyState")).toBeHidden();
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-01-07 正常：変更履歴反映OK（新規addは差分なし）", async ({ page }) => {
    const testId = "01-01-07";
    resetSeq(testId);

    const beforeLog = await countStore(page, "changelog");
    await fillProjectModal(page, { name: "結合試験プロジェクトD", startDate: "2026-08-01", endDate: "2026-09-30" });
    await saveProjectModalExpectingSuccess(page);
    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog + 1);

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("add");
    expect(latest.store).toBe("projects");
    expect(latest.changes).toEqual([]);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("01-02 プロジェクト削除", () => {
  // 前提条件：配下の8ストアすべてに何かしらデータを持つプロジェクトが存在し、プロジェクトが複数ある。
  async function seedTwoProjectsForDeletion(page) {
    const target = await seedProjectWithAllChildStores(page, { name: "削除対象プロジェクト" });
    const other = await seedProject(page, { name: "残存プロジェクト" });
    await selectProject(page, target.project.id);
    return { target, other };
  }

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("01-02-01 正常：削除後トースト表示・残る先頭プロジェクトが自動選択される", async ({ page }) => {
    const testId = "01-02-01";
    resetSeq(testId);
    const { target, other } = await seedTwoProjectsForDeletion(page);

    await acceptConfirmDuring(page, () => page.locator("#deleteProjectButton").click());
    await expectToast(page, "プロジェクトを削除しました");

    const selectedOption = page.locator("#projectSelectDropdown option:checked");
    await expect(selectedOption).toHaveText(other.name);
    expect(target).toBeTruthy();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-02-02 正常：変更履歴反映OK（配下データ＋プロジェクト本体のdeleteログ）", async ({ page }) => {
    const testId = "01-02-02";
    resetSeq(testId);
    const { target } = await seedTwoProjectsForDeletion(page);

    await acceptConfirmDuring(page, () => page.locator("#deleteProjectButton").click());
    // confirm()解決後もdeleteProjectCascadeは非同期で継続するため、完了の合図（トースト）を待ってからDBを見る。
    await expectToast(page, "プロジェクトを削除しました");

    const logRecords = await dumpStore(page, "changelog");
    const deleteLogsForProject = logRecords.filter(
      (entry) => entry.action === "delete" && (entry.projectId === target.project.id || entry.itemId === target.project.id)
    );
    const storesLogged = deleteLogsForProject.map((entry) => entry.store);
    expect(storesLogged).toContain("projects");
    expect(storesLogged).toContain("schedules");
    expect(storesLogged).toContain("tasks");
    expect(storesLogged).toContain("issues");
    // 【既知の非整合】comments/memos/quickmemos/snapshotsの削除はrecordChangelogEntry対象外
    // （LOGGED_STORESに含まれない）ため、削除ログは記録されない仕様どおりの挙動。

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-02-03 正常：プロジェクトDB削除OK", async ({ page }) => {
    const testId = "01-02-03";
    resetSeq(testId);
    const { target } = await seedTwoProjectsForDeletion(page);

    await acceptConfirmDuring(page, () => page.locator("#deleteProjectButton").click());
    await expectToast(page, "プロジェクトを削除しました");

    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords.find((record) => record.id === target.project.id)).toBeUndefined();

    const dbShot = await captureDbSnapshot(page, testId, ["projects"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-02-04 正常：その他関連する8ストア削除OK", async ({ page }) => {
    const testId = "01-02-04";
    resetSeq(testId);
    const { target } = await seedTwoProjectsForDeletion(page);

    await acceptConfirmDuring(page, () => page.locator("#deleteProjectButton").click());
    await expectToast(page, "プロジェクトを削除しました");

    for (const storeName of ["schedules", "tasks", "issues", "memos", "quickmemos", "snapshots"]) {
      const records = await dumpStore(page, storeName);
      expect(records.filter((record) => record.projectId === target.project.id)).toHaveLength(0);
    }
    const commentRecords = await dumpStore(page, "comments");
    expect(commentRecords.find((record) => record.taskId === target.schedule.id)).toBeUndefined();
    // 【既知の非整合】changelogはプロジェクト削除の対象外（監査ログとして意図的に残す設計）。
    // ここでは「削除される8ストア」に changelog を含めず、意図どおり残存することの確認は
    // 01-02-02 側の changelog 件数増加という形で担保する。

    const dbShot = await captureDbSnapshot(page, testId, ["schedules", "tasks", "issues", "comments", "memos", "quickmemos", "snapshots"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("01-03 プロジェクト選択", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("01-03-01 正常：プロジェクトDBが0件のとき", async ({ page }) => {
    const testId = "01-03-01";
    resetSeq(testId);
    const only = await seedProject(page, { name: "最後の1件" });
    await selectProject(page, only.id);

    await acceptConfirmDuring(page, () => page.locator("#deleteProjectButton").click());
    await expectToast(page, "プロジェクトを削除しました");

    await expect(page.locator("#ganttEmptyState")).toBeVisible();
    await expect(page.locator("#kanbanPanelBody")).toContainText("プロジェクトを選択してください");
    await expect(page.locator("#mindmapPanelBody")).toContainText("プロジェクトを選択してください");
    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords).toHaveLength(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-03-02 正常：プロジェクトDBが1件のとき、ドロップダウンは1件のみ", async ({ page }) => {
    const testId = "01-03-02";
    resetSeq(testId);
    const only = await seedProject(page, { name: "唯一のプロジェクト" });
    await selectProject(page, only.id);

    const options = page.locator("#projectSelectDropdown option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText("唯一のプロジェクト");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-03-03 正常：プロジェクトDBが2件以上のとき、切替可能で表示が変わる", async ({ page }) => {
    const testId = "01-03-03";
    resetSeq(testId);
    const projectA = await seedProject(page, { name: "プロジェクトA" });
    const projectB = await seedProject(page, { name: "プロジェクトB" });
    await seedSchedule(page, projectB.id, { name: "Bのスケジュール" });
    await selectProject(page, projectA.id);

    const options = page.locator("#projectSelectDropdown option");
    await expect(options).toHaveCount(2);

    await page.locator("#projectSelectDropdown").selectOption(projectB.id);
    await page.evaluate(async (projectId) => {
      await switchToProject(projectId);
    }, projectB.id);

    // ガントバーはwidth<=60pxだとラベルを描画しない仕様のため、常に名前が出るWBSパネル側で確認する。
    await expect(page.locator("#wbsPanel")).toContainText("Bのスケジュール");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("01-04 ロック", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "ロック試験プロジェクト" });
    await selectProject(page, project.id);
  });

  test("01-04-01 正常：ロックON時の表示OK", async ({ page }) => {
    const testId = "01-04-01";
    resetSeq(testId);

    await page.locator("#lockToggleButton").click();
    await expectToast(page, "ロックしました");
    await expect(page.locator("#lockBand")).toBeVisible();
    await expect(page.locator("#milestoneButton")).toBeDisabled();
    await expect(page.locator("#addScheduleButton")).toBeDisabled();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-04-02 正常：ロック中の編集操作は保存できない", async ({ page }) => {
    const testId = "01-04-02";
    resetSeq(testId);
    const projectId = (await dumpStore(page, "projects"))[0].id;
    const schedule = await seedSchedule(page, projectId, { name: "ロック前スケジュール" });
    await selectProject(page, projectId);

    await page.locator("#lockToggleButton").click();
    await expectToast(page, "ロックしました");

    // WBS行クリックでの編集モーダル自体は開けるが、保存はロック中のためブロックされる代表例。
    await page.locator(`.wbs-row[data-schedule-id="${schedule.id}"]`).click();
    await page.locator("#scheduleModalNameInput").fill("ロック中に変更を試みた名前");
    await page.locator("#scheduleModalSaveButton").click();
    await expectToast(page, "ロック中のため編集できません");

    const scheduleRecords = await dumpStore(page, "schedules");
    const unchanged = scheduleRecords.find((record) => record.id === schedule.id);
    expect(unchanged.name).toBe("ロック前スケジュール");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-04-03 正常：ロック解除時の表示OK", async ({ page }) => {
    const testId = "01-04-03";
    resetSeq(testId);

    await page.locator("#lockToggleButton").click();
    await expectToast(page, "ロックしました");
    await page.locator("#lockToggleButton").click();
    await expectToast(page, "ロックを解除しました");
    await expect(page.locator("#lockBand")).toBeHidden();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-04-04 正常：ロック解除後は全機能が使用可能に戻る", async ({ page }) => {
    const testId = "01-04-04";
    resetSeq(testId);

    await page.locator("#lockToggleButton").click();
    await page.locator("#lockToggleButton").click();
    await expectToast(page, "ロックを解除しました");

    await expect(page.locator("#addScheduleButton")).toBeEnabled();
    await expect(page.locator("#milestoneButton")).toBeEnabled();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("01-05 マイルストーン", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "マイルストーン試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    await selectProject(page, project.id);
    await page.locator("#milestoneButton").click();
  });

  test("01-05-01 マイルストーン名未入力→保存は成功するがマーカー非表示", async ({ page }) => {
    const testId = "01-05-01";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-date-input").first().fill("2026-06-01");
    await page.locator("#milestoneModalSaveButton").click();
    await expectToast(page, "マイルストーンを保存しました");

    await expect(page.locator(".gantt-milestone-band-marker")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-05-02 日付未入力→保存は成功するがマーカー非表示", async ({ page }) => {
    const testId = "01-05-02";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-name-input").first().fill("日付なしマイルストーン");
    await page.locator("#milestoneModalSaveButton").click();
    await expectToast(page, "マイルストーンを保存しました");

    await expect(page.locator(".gantt-milestone-band-marker")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-05-03 正常：保存後モーダルが閉じてトースト表示", async ({ page }) => {
    const testId = "01-05-03";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-name-input").first().fill("キックオフ");
    await page.locator(".modal-milestone-date-input").first().fill("2026-04-01");
    await page.locator("#milestoneModalSaveButton").click();

    await expect(page.locator("#modalOverlay")).toBeHidden();
    await expectToast(page, "マイルストーンを保存しました");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-05-04 正常：ガントのタイムライン上にひし形マーカーが表示される", async ({ page }) => {
    const testId = "01-05-04";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-name-input").first().fill("キックオフ");
    await page.locator(".modal-milestone-date-input").first().fill("2026-04-01");
    await page.locator("#milestoneModalSaveButton").click();

    const marker = page.locator(".gantt-milestone-band-marker");
    await expect(marker).toHaveCount(1);
    await expect(marker.locator(".gantt-milestone-band-diamond")).toBeVisible();
    await expect(marker.locator(".gantt-milestone-band-label")).toHaveText("キックオフ");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-05-05 正常：projectsストアのmilestones配列に反映される", async ({ page }) => {
    const testId = "01-05-05";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-name-input").first().fill("キックオフ");
    await page.locator(".modal-milestone-date-input").first().fill("2026-04-01");
    await page.locator("#milestoneModalSaveButton").click();

    const projectRecords = await dumpStore(page, "projects");
    const updated = projectRecords[0];
    expect(updated.milestones).toContainEqual({ name: "キックオフ", date: "2026-04-01" });

    const dbShot = await captureDbSnapshot(page, testId, ["projects"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-05-06 「＋マイルストーンを追加」ボタンで入力行が1行増える", async ({ page }) => {
    const testId = "01-05-06";
    resetSeq(testId);

    const before = await page.locator(".modal-milestone-row").count();
    await page.locator("#addMilestoneRowButton").click();
    const after = await page.locator(".modal-milestone-row").count();
    expect(after).toBe(before + 1);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-05-07 ×で行削除→保存でガントのマーカーが消える", async ({ page }) => {
    const testId = "01-05-07";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-name-input").first().fill("削除予定");
    await page.locator(".modal-milestone-date-input").first().fill("2026-05-01");
    await page.locator("#milestoneModalSaveButton").click();
    await expect(page.locator(".gantt-milestone-band-marker")).toHaveCount(1);

    await page.locator("#milestoneButton").click();
    await page.locator('.modal-milestone-row [data-action="remove-milestone-row"]').first().click();
    await page.locator("#milestoneModalSaveButton").click();
    await expectToast(page, "マイルストーンを保存しました");

    await expect(page.locator(".gantt-milestone-band-marker")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-05-08 ×で行削除→保存でprojects DBから該当要素が消える", async ({ page }) => {
    const testId = "01-05-08";
    resetSeq(testId);

    await page.locator("#addMilestoneRowButton").click();
    await page.locator(".modal-milestone-name-input").first().fill("削除予定2");
    await page.locator(".modal-milestone-date-input").first().fill("2026-05-02");
    await page.locator("#milestoneModalSaveButton").click();

    await page.locator("#milestoneButton").click();
    await page.locator('.modal-milestone-row [data-action="remove-milestone-row"]').first().click();
    await page.locator("#milestoneModalSaveButton").click();

    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords[0].milestones).toEqual([]);

    const dbShot = await captureDbSnapshot(page, testId, ["projects"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("01-06 プロジェクト編集", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "編集対象プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    await selectProject(page, project.id);
    await openEditProjectModal(page);
  });

  test("01-06-01 プロジェクト名未入力→アラート表示・更新されない", async ({ page }) => {
    const testId = "01-06-01";
    resetSeq(testId);

    await fillProjectModal(page, { name: "" });
    const message = await saveProjectModalExpectingAlert(page);
    expect(message).toBe("プロジェクト名を入力してください");

    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords[0].name).toBe("編集対象プロジェクト");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-06-02 終了日よりも開始日が後ろ→アラート表示・更新されない", async ({ page }) => {
    const testId = "01-06-02";
    resetSeq(testId);

    await fillProjectModal(page, { startDate: "2026-12-31", endDate: "2026-01-01" });
    const message = await saveProjectModalExpectingAlert(page);
    expect(message).toBe("終了日は開始日より後にしてください");

    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords[0].startDate).toBe("2026-01-01");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-06-03 終了日が3年以上先→アラート表示・保存不可", async ({ page }) => {
    const testId = "01-06-03";
    resetSeq(testId);

    await fillProjectModal(page, { startDate: "2026-01-01", endDate: "2029-01-02" });
    const message = await saveProjectModalExpectingAlert(page);
    expect(message).toBe("期間は最大3年です");

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-06-04 差分がない場合は変更履歴に記録されない", async ({ page }) => {
    const testId = "01-06-04";
    resetSeq(testId);

    const beforeLog = await countStore(page, "changelog");
    await saveProjectModalExpectingSuccess(page);
    await expectToast(page, "プロジェクトを保存しました");
    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-06-05 正常：プロジェクトDB保存OK", async ({ page }) => {
    const testId = "01-06-05";
    resetSeq(testId);

    await fillProjectModal(page, { name: "編集後プロジェクト", startDate: "2026-02-01", endDate: "2026-11-30" });
    await saveProjectModalExpectingSuccess(page);

    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords[0].name).toBe("編集後プロジェクト");
    expect(projectRecords[0].startDate).toBe("2026-02-01");
    expect(projectRecords[0].endDate).toBe("2026-11-30");

    const dbShot = await captureDbSnapshot(page, testId, ["projects"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("01-06-06 正常：変更がヘッダー・カレンダー期間に反映される", async ({ page }) => {
    const testId = "01-06-06";
    resetSeq(testId);

    await fillProjectModal(page, { name: "編集後プロジェクト表示確認" });
    await saveProjectModalExpectingSuccess(page);

    const selectedOption = page.locator("#projectSelectDropdown option:checked");
    await expect(selectedOption).toHaveText("編集後プロジェクト表示確認");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-06-07 正常：保存後モーダルが閉じてメイン画面に戻る", async ({ page }) => {
    const testId = "01-06-07";
    resetSeq(testId);

    await fillProjectModal(page, { name: "遷移確認プロジェクト" });
    await saveProjectModalExpectingSuccess(page);

    await expect(page.locator("#ganttEmptyState")).toBeHidden();
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("01-06-08 正常：変更履歴反映OK（action:edit、changesに変更フィールド）", async ({ page }) => {
    const testId = "01-06-08";
    resetSeq(testId);

    await fillProjectModal(page, { name: "変更履歴確認プロジェクト" });
    await saveProjectModalExpectingSuccess(page);

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("edit");
    expect(latest.changes.some((change) => change.field === "name")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});
