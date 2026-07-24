/**
 * 08 コメント — 結合試験（spec/test-items.json 08-01-01 〜 08-01-18、全18項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel } = require("../helpers/ui-actions");
const { seedProject, seedSchedule, selectProject } = require("../helpers/seed");

async function seedProjectWithOneSchedule(page) {
  const project = await seedProject(page, { name: "コメント試験プロジェクト" });
  const schedule = await seedSchedule(page, project.id, { name: "コメント対象スケジュール" });
  await selectProject(page, project.id);
  return { project, schedule };
}

async function postCommentViaPanel(page, scheduleId, text) {
  await page.locator("#commentTargetScheduleSelect").selectOption(scheduleId);
  await page.locator("#commentTextInput").fill(text);
  await page.locator("#postCommentButton").click();
}

test.describe("08-01 コメント", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
  });

  test("08-01-01 ヘッダー件数：コメント投稿で+1される", async ({ page }) => {
    const testId = "08-01-01";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    await expect(page.locator("#commentCountBadge")).toHaveText("0件");
    await postCommentViaPanel(page, schedule.id, "件数確認用コメント");
    await expect(page.locator("#commentCountBadge")).toHaveText("1件");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-02 ヘッダー件数：コメント削除で-1される", async ({ page }) => {
    const testId = "08-01-02";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await postCommentViaPanel(page, schedule.id, "削除確認用コメント");
    await expect(page.locator("#commentCountBadge")).toHaveText("1件");

    await page.locator('[data-action="delete-comment"]').first().click();

    await expect(page.locator("#commentCountBadge")).toHaveText("0件");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-03 サブヘッダー件数：コメント投稿で+1される", async ({ page }) => {
    const testId = "08-01-03";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    await expect(page.locator("#commentPanelSummary")).toHaveText("");
    await postCommentViaPanel(page, schedule.id, "サブヘッダー確認用コメント");
    await expect(page.locator("#commentPanelSummary")).toHaveText("1件のスケジュールに1件のコメント");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-04 サブヘッダー件数：コメント削除で-1される", async ({ page }) => {
    const testId = "08-01-04";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await postCommentViaPanel(page, schedule.id, "サブヘッダー削除確認用コメント");
    await expect(page.locator("#commentPanelSummary")).toHaveText("1件のスケジュールに1件のコメント");

    await page.locator('[data-action="delete-comment"]').first().click();

    await expect(page.locator("#commentPanelSummary")).toHaveText("");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-05 対象スケジュール0件時：コメント追加機能が表示されない", async ({ page }) => {
    const testId = "08-01-05";
    resetSeq(testId);
    const project = await seedProject(page, { name: "スケジュール0件プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "comment");

    await expect(page.locator("#commentTargetScheduleSelect")).toHaveCount(0);
    await expect(page.locator("#commentSlidePanel")).toContainText("コメントはまだありません");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-06 スケジュール1件以上：コメント追加機能が表示される", async ({ page }) => {
    const testId = "08-01-06";
    resetSeq(testId);
    await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    await expect(page.locator("#commentTargetScheduleSelect")).toBeVisible();
    await expect(page.locator("#commentTextInput")).toBeVisible();
    await expect(page.locator("#postCommentButton")).toBeVisible();

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-07 パネルから投稿：一覧に追加表示され成功トーストは無い", async ({ page }) => {
    const testId = "08-01-07";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    await postCommentViaPanel(page, schedule.id, "画面表示確認用コメント");

    await expect(page.locator("#commentSlidePanel")).toContainText("画面表示確認用コメント");
    await expect(page.locator("#toast")).not.toHaveClass(/show/);

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-08 パネルから投稿：commentsストアにtaskId/textを持つレコードが増える。changelog無記録", async ({ page }) => {
    const testId = "08-01-08";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    const beforeLog = await countStore(page, "changelog");
    await postCommentViaPanel(page, schedule.id, "DB確認用コメント");

    const records = await dumpStore(page, "comments");
    const created = records.find((record) => record.text === "DB確認用コメント");
    expect(created).toBeTruthy();
    expect(created.taskId).toBe(schedule.id);
    expect(await countStore(page, "changelog")).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("08-01-09 スケジュール編集画面から投稿：commentsストアに1件増える。changelog無記録", async ({ page }) => {
    const testId = "08-01-09";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    const beforeLog = await countStore(page, "changelog");
    await page.locator(`.wbs-row[data-schedule-id="${schedule.id}"]`).click();
    await page.locator("#scheduleModalCommentTextInput").fill("編集画面から投稿するコメント");
    await page.locator("#scheduleModalPostCommentButton").click();

    const records = await dumpStore(page, "comments");
    expect(records.find((record) => record.text === "編集画面から投稿するコメント")).toBeTruthy();
    expect(await countStore(page, "changelog")).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("08-01-10 スケジュール複数時：コメント対象を切り替えられる", async ({ page }) => {
    const testId = "08-01-10";
    resetSeq(testId);
    const project = await seedProject(page, { name: "複数スケジュールプロジェクト" });
    const scheduleA = await seedSchedule(page, project.id, { name: "スケジュールA", order: 0 });
    const scheduleB = await seedSchedule(page, project.id, { name: "スケジュールB", order: 1 });
    await selectProject(page, project.id);
    await openSidePanel(page, "comment");

    await postCommentViaPanel(page, scheduleB.id, "スケジュールB宛てのコメント");

    // コメントを付ける対象を選べたことの確認＝グループ見出しが選んだスケジュール（B）になっている。
    // <select>自体はA/B両方を選択肢として持つので、判定はグループ見出し側で行う。
    await expect(page.locator(".comment-group-heading")).toHaveCount(1);
    await expect(page.locator(".comment-group-heading")).toHaveText(/スケジュールB/);
    expect(scheduleA.id).toBeTruthy();

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-11 スケジュールごとまとまってコメント表示される", async ({ page }) => {
    const testId = "08-01-11";
    resetSeq(testId);
    const project = await seedProject(page, { name: "グループ表示プロジェクト" });
    const scheduleA = await seedSchedule(page, project.id, { name: "グループA", order: 0 });
    const scheduleB = await seedSchedule(page, project.id, { name: "グループB", order: 1 });
    await selectProject(page, project.id);
    await openSidePanel(page, "comment");

    await postCommentViaPanel(page, scheduleA.id, "Aへのコメント");
    await postCommentViaPanel(page, scheduleB.id, "Bへのコメント");

    const headings = page.locator(".comment-group-heading");
    await expect(headings).toHaveCount(2);
    await expect(headings.nth(0)).toContainText("グループA");
    await expect(headings.nth(1)).toContainText("グループB");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-12 コメント0件のときは空表示になる", async ({ page }) => {
    const testId = "08-01-12";
    resetSeq(testId);
    await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    await expect(page.locator("#commentSlidePanel")).toContainText("コメントはまだありません");
    await expect(page.locator(".comment-group-heading")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-13 ▼ボタンでグループの開閉ができる", async ({ page }) => {
    const testId = "08-01-13";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await postCommentViaPanel(page, schedule.id, "開閉確認用コメント");

    const heading = page.locator(".comment-group-heading");
    await expect(heading).not.toHaveClass(/is-collapsed/);
    await expect(page.locator("#commentSlidePanel")).toContainText("開閉確認用コメント");

    await heading.click();
    await expect(heading).toHaveClass(/is-collapsed/);
    await expect(page.locator("#commentSlidePanel")).not.toContainText("開閉確認用コメント");

    await heading.click();
    await expect(heading).not.toHaveClass(/is-collapsed/);
    await expect(page.locator("#commentSlidePanel")).toContainText("開閉確認用コメント");

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-14 スケジュール編集画面での投稿が画面反映される", async ({ page }) => {
    const testId = "08-01-14";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");

    await page.locator(`.wbs-row[data-schedule-id="${schedule.id}"]`).click();
    await page.locator("#scheduleModalCommentTextInput").fill("編集画面反映確認コメント");
    await page.locator("#scheduleModalPostCommentButton").click();

    await expect(page.locator(".modal-comment-list")).toContainText("編集画面反映確認コメント");
    await expect(page.locator("#toast")).not.toHaveClass(/show/);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-15 パネルから削除：commentsから消える。changelog無記録", async ({ page }) => {
    const testId = "08-01-15";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await postCommentViaPanel(page, schedule.id, "パネル削除確認用コメント");

    const beforeLog = await countStore(page, "changelog");
    await page.locator('[data-action="delete-comment"]').first().click();

    expect(await countStore(page, "comments")).toBe(0);
    expect(await countStore(page, "changelog")).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("08-01-16 パネルから削除：確認ダイアログ・成功トースト無しで一覧から消える", async ({ page }) => {
    const testId = "08-01-16";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await postCommentViaPanel(page, schedule.id, "パネル画面削除確認用コメント");

    // 削除ボタンのクリックがconfirm()ダイアログでブロックされない（＝確認無し即削除）ことを、
    // クリック直後に即座に一覧から消えることで確認する。
    await page.locator('[data-action="delete-comment"]').first().click();

    await expect(page.locator("#commentSlidePanel")).not.toContainText("パネル画面削除確認用コメント");
    await expect(page.locator("#toast")).not.toHaveClass(/show/);

    const shot = await captureScreen(page, testId, "comment-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("08-01-17 スケジュール編集画面から削除：commentsから消える。changelog無記録", async ({ page }) => {
    const testId = "08-01-17";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await page.locator(`.wbs-row[data-schedule-id="${schedule.id}"]`).click();
    await page.locator("#scheduleModalCommentTextInput").fill("編集画面削除確認用コメント");
    await page.locator("#scheduleModalPostCommentButton").click();
    await expect(page.locator(".modal-comment-list")).toContainText("編集画面削除確認用コメント");

    const beforeLog = await countStore(page, "changelog");
    await page.locator('[data-action="delete-modal-comment"]').first().click();

    expect(await countStore(page, "comments")).toBe(0);
    expect(await countStore(page, "changelog")).toBe(beforeLog);

    const dbShot = await captureDbSnapshot(page, testId, ["comments"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("08-01-18 スケジュール編集画面から削除：画面反映OK", async ({ page }) => {
    const testId = "08-01-18";
    resetSeq(testId);
    const { schedule } = await seedProjectWithOneSchedule(page);
    await openSidePanel(page, "comment");
    await page.locator(`.wbs-row[data-schedule-id="${schedule.id}"]`).click();
    await page.locator("#scheduleModalCommentTextInput").fill("編集画面反映削除確認用コメント");
    await page.locator("#scheduleModalPostCommentButton").click();
    await expect(page.locator(".modal-comment-list")).toContainText("編集画面反映削除確認用コメント");

    await page.locator('[data-action="delete-modal-comment"]').first().click();

    await expect(page.locator(".modal-comment-list")).not.toContainText("編集画面反映削除確認用コメント");
    await expect(page.locator("#toast")).not.toHaveClass(/show/);

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
