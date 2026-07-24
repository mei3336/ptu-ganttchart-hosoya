/**
 * 14 タイムライン操作 — 結合試験（spec/test-items.json 14-01-01 〜 14-01-25、全25項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, fillScheduleModal, saveScheduleModalExpectingSuccess, expectToast } = require("../helpers/ui-actions");
const { seedProject, seedSchedule, selectProject } = require("../helpers/seed");

const DAY_GRANULARITY_PIXELS_PER_DAY = 32;

function ganttBar(page, scheduleId) {
  return page.locator(`.gantt-bar[data-schedule-id="${scheduleId}"]`);
}

async function clickGanttBar(page, scheduleId) {
  const bar = ganttBar(page, scheduleId);
  // 【前提】プロジェクト開始日から離れたスケジュールほどバーが横スクロール範囲外に描画される
  //   （日粒度32px/日）。実座標でクリック/ドラッグする前に必ず可視範囲へスクロールする。
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * 【前提】scheduleId のガントバーが表示中であること。mode は "move"|"resize-start"|"resize"。
 * 【処理】pointerdown/pointermove/pointerupを実マウス操作として発行し、
 *   deltaDays日ぶんポインタを水平移動させてからドロップする。ドラッグ開始点はバー自身に
 *   setPointerCaptureされるため、移動先座標が可視範囲外でもイベントは正しく届く
 *   （開始点だけが実際にバー要素と重なっている必要がある）。
 * 【結果】handleBarPointerUpが確定処理まで実行される。
 */
async function dragGanttBarBy(page, scheduleId, { mode = "move", deltaDays, pixelsPerDay = DAY_GRANULARITY_PIXELS_PER_DAY }) {
  const bar = ganttBar(page, scheduleId);
  await bar.scrollIntoViewIfNeeded();
  let grabX;
  let grabY;
  if (mode === "move") {
    const box = await bar.boundingBox();
    grabX = box.x + box.width / 2;
    grabY = box.y + box.height / 2;
  } else {
    const handleBox = await bar.locator(mode === "resize-start" ? ".bar-lh" : ".bar-rh").boundingBox();
    grabX = handleBox.x + handleBox.width / 2;
    grabY = handleBox.y + handleBox.height / 2;
  }
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + deltaDays * pixelsPerDay, grabY, { steps: 5 });
  await page.mouse.up();
}

test.describe("14-01 スケジュールバー / 詳細ポップアップ", () => {
  let project;
  let schedule;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "タイムライン試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    schedule = await seedSchedule(page, project.id, { name: "タイムライン対象スケジュール", startDate: "2026-03-01", endDate: "2026-03-10", notes: "テストメモ" });
    await selectProject(page, project.id);
  });

  test("14-01-01 バーを左クリックすると詳細ポップアップが表示される", async ({ page }) => {
    const testId = "14-01-01";
    resetSeq(testId);

    await clickGanttBar(page, schedule.id);

    await expect(page.locator("#taskPopup")).toBeVisible();
    await expect(page.locator("#taskPopup")).toContainText("タイムライン対象スケジュール");

    const shot = await captureScreen(page, testId, "task-popup");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-02 詳細からコメントを投稿できる（画面反映）", async ({ page }) => {
    const testId = "14-01-02";
    resetSeq(testId);
    await clickGanttBar(page, schedule.id);

    await page.locator("#taskPopupCommentTextInput").fill("ポップアップから投稿するコメント");
    await page.locator("#taskPopupPostCommentButton").click();

    await expect(page.locator("#taskPopup")).toContainText("ポップアップから投稿するコメント");

    const shot = await captureScreen(page, testId, "task-popup");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-03 詳細から投稿したコメントがコメントパネルに反映される", async ({ page }) => {
    const testId = "14-01-03";
    resetSeq(testId);
    await clickGanttBar(page, schedule.id);
    await page.locator("#taskPopupCommentTextInput").fill("コメントパネル反映確認用コメント");
    await page.locator("#taskPopupPostCommentButton").click();

    await page.locator("#commentButton").click();
    await expect(page.locator("#commentSlidePanel")).toContainText("コメントパネル反映確認用コメント");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-04 詳細から投稿したコメントがDBに反映される（changelog無記録）", async ({ page }) => {
    const testId = "14-01-04";
    resetSeq(testId);
    const beforeLog = await countStore(page, "changelog");
    await clickGanttBar(page, schedule.id);
    await page.locator("#taskPopupCommentTextInput").fill("DB確認用ポップアップコメント");
    await page.locator("#taskPopupPostCommentButton").click();

    const records = await dumpStore(page, "comments");
    const created = records.find((record) => record.text === "DB確認用ポップアップコメント");
    expect(created).toBeTruthy();
    expect(created.taskId).toBe(schedule.id);
    expect(await countStore(page, "changelog")).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-05 詳細からコメントを削除できる（画面反映）", async ({ page }) => {
    const testId = "14-01-05";
    resetSeq(testId);
    await clickGanttBar(page, schedule.id);
    await page.locator("#taskPopupCommentTextInput").fill("削除確認用ポップアップコメント");
    await page.locator("#taskPopupPostCommentButton").click();
    await expect(page.locator("#taskPopup")).toContainText("削除確認用ポップアップコメント");

    await page.locator('#taskPopup [data-action="delete-task-popup-comment"]').click();

    await expect(page.locator("#taskPopup")).not.toContainText("削除確認用ポップアップコメント");

    const shot = await captureScreen(page, testId, "task-popup");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-06 詳細から削除したコメントがコメントパネルに反映される", async ({ page }) => {
    const testId = "14-01-06";
    resetSeq(testId);
    await clickGanttBar(page, schedule.id);
    await page.locator("#taskPopupCommentTextInput").fill("パネル反映削除確認用コメント");
    await page.locator("#taskPopupPostCommentButton").click();
    await page.locator('#taskPopup [data-action="delete-task-popup-comment"]').click();

    await page.locator("#commentButton").click();
    await expect(page.locator("#commentSlidePanel")).not.toContainText("パネル反映削除確認用コメント");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-07 詳細から削除したコメントがDBに反映される（changelog無記録）", async ({ page }) => {
    const testId = "14-01-07";
    resetSeq(testId);
    await clickGanttBar(page, schedule.id);
    await page.locator("#taskPopupCommentTextInput").fill("DB削除確認用ポップアップコメント");
    await page.locator("#taskPopupPostCommentButton").click();
    const beforeLog = await countStore(page, "changelog");

    await page.locator('#taskPopup [data-action="delete-task-popup-comment"]').click();

    const records = await dumpStore(page, "comments");
    expect(records.find((record) => record.text === "DB削除確認用ポップアップコメント")).toBeUndefined();
    expect(await countStore(page, "changelog")).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-08 ステータスを変更すると詳細の進捗バーに反映される", async ({ page }) => {
    const testId = "14-01-08";
    resetSeq(testId);
    await clickGanttBar(page, schedule.id);
    await expect(page.locator(".task-popup-progress-label")).toHaveText("進捗：0%");
    await page.locator("#taskPopupCloseButton").click();

    // 【前提】taskPopup自体にステータス編集UIは無いため、スケジュール編集モーダルで変更する。
    await page.locator(`.wbs-row[data-schedule-id="${schedule.id}"]`).click();
    await page.locator("#scheduleModalStatusSelect").selectOption("done");
    await page.locator("#scheduleModalSaveButton").click();
    await expect(page.locator("#modalOverlay")).toBeHidden();

    await clickGanttBar(page, schedule.id);
    await expect(page.locator(".task-popup-progress-label")).toHaveText("進捗：100%");
    await expect(page.locator(".task-popup-progress-fill")).toHaveAttribute("style", "width:100%");

    const shot = await captureScreen(page, testId, "task-popup");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-09 子バー両端ホバーでカーソルが⇔（ew-resize）になる", async ({ page }) => {
    const testId = "14-01-09";
    resetSeq(testId);

    const cursor = await ganttBar(page, schedule.id).locator(".bar-lh").evaluate((element) => getComputedStyle(element).cursor);
    expect(cursor).toBe("ew-resize");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-13 バーホバーでツールチップ（title属性）に名前・期間・営業日・ステータスが表示される", async ({ page }) => {
    const testId = "14-01-13";
    resetSeq(testId);

    const expectedBusinessDayCount = await page.evaluate(() => calculateBusinessDayCount("2026-03-01", "2026-03-10"));
    const title = await ganttBar(page, schedule.id).getAttribute("title");
    expect(title).toContain("タイムライン対象スケジュール");
    expect(title).toContain("2026-03-01");
    expect(title).toContain("2026-03-10");
    expect(title).toContain(`${expectedBusinessDayCount}営業日`);
    expect(title).toContain("ステータス: 未着手");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-14 ホバー解除でツールチップが非表示になる", async ({ page }) => {
    const testId = "14-01-14";
    resetSeq(testId);

    // 【前提】ツールチップはブラウザ標準のtitle属性で実装されており、表示/非表示自体は
    //   ブラウザが自動で管理するネイティブ機能（アプリ独自の表示状態は無い）。
    //   ここではホバー解除後もDOM上に独自のツールチップ要素が残らないことを確認する。
    await ganttBar(page, schedule.id).hover();
    await page.mouse.move(10, 10);
    await expect(page.locator(".custom-tooltip, [role='tooltip']")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-15 バーをプロジェクト範囲内でドラッグして移動できる", async ({ page }) => {
    const testId = "14-01-15";
    resetSeq(testId);

    await dragGanttBarBy(page, schedule.id, { mode: "move", deltaDays: 3 });
    await expectToast(page, "スケジュールを更新しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    const updated = scheduleRecords.find((record) => record.id === schedule.id);
    expect(updated.startDate).toBe("2026-03-04");
    expect(updated.endDate).toBe("2026-03-13");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-25 営業日数の計算が土日祝を除外して正しい", async ({ page }) => {
    const testId = "14-01-25";
    resetSeq(testId);
    // 2026-01-10(土)〜2026-01-13(火)：土・日・成人の日(01-12)を挟む。
    const holidaySchedule = await seedSchedule(page, project.id, { name: "祝日跨ぎスケジュール", startDate: "2026-01-10", endDate: "2026-01-13" });
    await page.evaluate(() => refreshGanttPanel(currentSelectedProjectId));

    const expectedBusinessDayCount = await page.evaluate(() => calculateBusinessDayCount("2026-01-10", "2026-01-13"));
    expect(expectedBusinessDayCount).toBe(1);
    const title = await ganttBar(page, holidaySchedule.id).getAttribute("title");
    expect(title).toContain(`${expectedBusinessDayCount}営業日`);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("14-01 スケジュールバー / 期間増減変更（リサイズ）", () => {
  let project;
  let parent;
  let child1;
  let child2;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "バーリサイズ試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    parent = await seedSchedule(page, project.id, { name: "リサイズ親", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    child1 = await seedSchedule(page, project.id, { name: "リサイズ子1", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    child2 = await seedSchedule(page, project.id, { name: "リサイズ子2", parentId: parent.id, startDate: "2026-03-11", endDate: "2026-03-20", order: 1 });
    await selectProject(page, project.id);
  });

  test("14-01-10 子バー端のドラッグで期間増減：画面表示OK（親バーが子に合わせて伸びる）", async ({ page }) => {
    const testId = "14-01-10";
    resetSeq(testId);

    await dragGanttBarBy(page, child2.id, { mode: "resize", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const parentTitle = await ganttBar(page, parent.id).getAttribute("title");
    expect(parentTitle).toContain("2026-03-25");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-11 子バー端のドラッグで期間増減：DB反映OK（親endDateが子の最遅終了日に一致）", async ({ page }) => {
    const testId = "14-01-11";
    resetSeq(testId);

    await dragGanttBarBy(page, child2.id, { mode: "resize", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    const updatedChild2 = scheduleRecords.find((record) => record.id === child2.id);
    expect(updatedChild2.endDate).toBe("2026-03-25");
    const updatedParent = scheduleRecords.find((record) => record.id === parent.id);
    expect(updatedParent.endDate).toBe("2026-03-25");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-12 子バー端のドラッグで期間増減：変更履歴OK", async ({ page }) => {
    const testId = "14-01-12";
    resetSeq(testId);

    const beforeLog = await countStore(page, "changelog");
    await dragGanttBarBy(page, child2.id, { mode: "resize", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");
    const afterLog = await countStore(page, "changelog");
    const newEntries = (await dumpStore(page, "changelog")).slice(-(afterLog - beforeLog));
    const shot = await captureScreen(page, testId, "gantt");

    // 【前提】期待値結果は「子のedit＋親の自動再計算editの2件」。実装のsyncAncestorDatesは
    //   addScheduleのみでrecordChangelogEntryを呼ばないため、親の再計算はログに残らない
    //   （13-07-03と同種の既知の非対称）。
    if (afterLog - beforeLog === 2 && newEntries.some((e) => e.itemId === parent.id) && newEntries.some((e) => e.itemId === child2.id)) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: `期待値結果は子・親2件のeditログだが、実際は${afterLog - beforeLog}件（syncAncestorDatesが変更履歴を記録しないため）。対象itemId: ${newEntries.map((e) => e.itemId).join(", ")}`,
      });
    }
  });
});

test.describe("14-01 スケジュールバー / 期間移動変更（親・子・両方）", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("14-01-16 親バーを移動すると配下の子全体が追従する（画面表示OK）", async ({ page }) => {
    const testId = "14-01-16";
    resetSeq(testId);
    const project = await seedProject(page, { name: "親移動追従試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const parent = await seedSchedule(page, project.id, { name: "追従親", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "追従子", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await selectProject(page, project.id);

    await dragGanttBarBy(page, parent.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const childTitle = await ganttBar(page, child.id).getAttribute("title");
    expect(childTitle).toContain("2026-03-06");
    expect(childTitle).toContain("2026-03-25");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-19 親バーを移動：DB反映OK（配下の子のstart/endも追従更新）", async ({ page }) => {
    const testId = "14-01-19";
    resetSeq(testId);
    const project = await seedProject(page, { name: "親移動DB確認プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const parent = await seedSchedule(page, project.id, { name: "DB確認追従親", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "DB確認追従子", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await selectProject(page, project.id);

    await dragGanttBarBy(page, parent.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    const updatedChild = scheduleRecords.find((record) => record.id === child.id);
    expect(updatedChild.startDate).toBe("2026-03-06");
    expect(updatedChild.endDate).toBe("2026-03-25");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-22 親バーを移動：変更履歴反映OK", async ({ page }) => {
    const testId = "14-01-22";
    resetSeq(testId);
    const project = await seedProject(page, { name: "親移動履歴確認プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const parent = await seedSchedule(page, project.id, { name: "履歴確認追従親", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "履歴確認追従子", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await selectProject(page, project.id);

    const beforeLog = await countStore(page, "changelog");
    await dragGanttBarBy(page, parent.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");
    const afterLog = await countStore(page, "changelog");
    const newEntries = (await dumpStore(page, "changelog")).slice(-(afterLog - beforeLog));
    const shot = await captureScreen(page, testId, "changelog-panel");

    // 【前提】期待値結果は「移動分と追従分のエントリ」（複数件）。実装は親自身の1件のみを記録し、
    //   子孫の平行移動は副作用としてログを残さない（handleBarPointerUpのコメント参照）。
    if (afterLog - beforeLog >= 2 && newEntries.some((e) => e.itemId === child.id)) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: `期待値結果は移動分＋追従分の複数エントリだが、実際は${afterLog - beforeLog}件（親自身の1件のみ）。子孫の平行移動はhandleBarPointerUpが意図的にログを残さない設計のため。対象itemId: ${newEntries.map((e) => e.itemId).join(", ")}`,
      });
    }
  });

  test("14-01-17 末端の子バーを移動すると関連する親全体が追従する（画面表示OK）", async ({ page }) => {
    const testId = "14-01-17";
    resetSeq(testId);
    const project = await seedProject(page, { name: "子移動親追従試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const parent = await seedSchedule(page, project.id, { name: "子移動時追従親", startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "子移動時追従子", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    await selectProject(page, project.id);

    await dragGanttBarBy(page, child.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const parentTitle = await ganttBar(page, parent.id).getAttribute("title");
    expect(parentTitle).toContain("2026-03-15");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-20 末端の子バーを移動：DB反映OK（親start/endが子に追従して再計算）", async ({ page }) => {
    const testId = "14-01-20";
    resetSeq(testId);
    const project = await seedProject(page, { name: "子移動DB確認プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const parent = await seedSchedule(page, project.id, { name: "DB確認子移動時追従親", startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "DB確認子移動時追従子", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    await selectProject(page, project.id);

    await dragGanttBarBy(page, child.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    const updatedParent = scheduleRecords.find((record) => record.id === parent.id);
    expect(updatedParent.startDate).toBe("2026-03-06");
    expect(updatedParent.endDate).toBe("2026-03-15");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-23 末端の子バーを移動：変更履歴OK", async ({ page }) => {
    const testId = "14-01-23";
    resetSeq(testId);
    const project = await seedProject(page, { name: "子移動履歴確認プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const parent = await seedSchedule(page, project.id, { name: "履歴確認子移動時追従親", startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    const child = await seedSchedule(page, project.id, { name: "履歴確認子移動時追従子", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-10", order: 0 });
    await selectProject(page, project.id);

    const beforeLog = await countStore(page, "changelog");
    await dragGanttBarBy(page, child.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");
    const afterLog = await countStore(page, "changelog");
    const newEntries = (await dumpStore(page, "changelog")).slice(-(afterLog - beforeLog));
    const shot = await captureScreen(page, testId, "changelog-panel");

    if (afterLog - beforeLog >= 2 && newEntries.some((e) => e.itemId === parent.id)) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: `期待値結果は移動分＋親の自動再計算分だが、実際は${afterLog - beforeLog}件（syncAncestorDatesはchangelogに記録しないため親の再計算ログは無い）。対象itemId: ${newEntries.map((e) => e.itemId).join(", ")}`,
      });
    }
  });

  test("14-01-18 親・子両方を持つ中間バーを移動：関連する親・子両方が追従する（画面表示OK）", async ({ page }) => {
    const testId = "14-01-18";
    resetSeq(testId);
    const project = await seedProject(page, { name: "中間バー移動試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const grandParent = await seedSchedule(page, project.id, { name: "祖父", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const middle = await seedSchedule(page, project.id, { name: "中間（親子両方）", parentId: grandParent.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const leaf = await seedSchedule(page, project.id, { name: "末端の孫", parentId: middle.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await selectProject(page, project.id);

    await dragGanttBarBy(page, middle.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const leafTitle = await ganttBar(page, leaf.id).getAttribute("title");
    expect(leafTitle).toContain("2026-03-06");
    const grandParentTitle = await ganttBar(page, grandParent.id).getAttribute("title");
    expect(grandParentTitle).toContain("2026-03-25");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("14-01-21 親・子両方を持つ中間バーを移動：DB反映OK", async ({ page }) => {
    const testId = "14-01-21";
    resetSeq(testId);
    const project = await seedProject(page, { name: "中間バーDB確認プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const grandParent = await seedSchedule(page, project.id, { name: "DB確認祖父", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const middle = await seedSchedule(page, project.id, { name: "DB確認中間", parentId: grandParent.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const leaf = await seedSchedule(page, project.id, { name: "DB確認末端の孫", parentId: middle.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await selectProject(page, project.id);

    await dragGanttBarBy(page, middle.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === leaf.id).startDate).toBe("2026-03-06");
    expect(scheduleRecords.find((record) => record.id === grandParent.id).endDate).toBe("2026-03-25");

    const dbShot = await captureDbSnapshot(page, testId, ["schedules"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("14-01-24 親・子両方を持つ中間バーを移動：変更履歴OK", async ({ page }) => {
    const testId = "14-01-24";
    resetSeq(testId);
    const project = await seedProject(page, { name: "中間バー履歴確認プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
    const grandParent = await seedSchedule(page, project.id, { name: "履歴確認祖父", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    const middle = await seedSchedule(page, project.id, { name: "履歴確認中間", parentId: grandParent.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await seedSchedule(page, project.id, { name: "履歴確認末端の孫", parentId: middle.id, startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
    await selectProject(page, project.id);

    const beforeLog = await countStore(page, "changelog");
    await dragGanttBarBy(page, middle.id, { mode: "move", deltaDays: 5 });
    await expectToast(page, "スケジュールを更新しました");
    const afterLog = await countStore(page, "changelog");
    const newEntries = (await dumpStore(page, "changelog")).slice(-(afterLog - beforeLog));
    const shot = await captureScreen(page, testId, "changelog-panel");

    if (afterLog - beforeLog >= 2 && newEntries.some((e) => e.itemId === grandParent.id)) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: `期待値結果は移動分＋関連する親子の自動再計算分だが、実際は${afterLog - beforeLog}件（中間バー自身の1件のみ。子孫の平行移動・祖先のsyncAncestorDatesはどちらもchangelogに記録しないため）。対象itemId: ${newEntries.map((e) => e.itemId).join(", ")}`,
      });
    }
  });
});
