/**
 * 06 即時メモ — 結合試験（spec/test-items.json 06-01-01 〜 06-01-11、全11項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel, closeSidePanel, acceptConfirmDuring, expectToast } = require("../helpers/ui-actions");
const { seedProject, selectProject } = require("../helpers/seed");

test.describe("06-01 即時メモ", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "即時メモ試験プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "quickMemo");
  });

  test("06-01-01 未入力でCtrl+Enter／投稿ボタン→エラー無く保存されない", async ({ page }) => {
    const testId = "06-01-01";
    resetSeq(testId);

    const before = await countStore(page, "quickmemos");
    await page.locator("#quickMemoTextInput").fill("");
    await page.locator("#quickMemoTextInput").press("Control+Enter");
    await page.locator("#postQuickMemoButton").click();
    const after = await countStore(page, "quickmemos");
    expect(after).toBe(before);
    await expect(page.locator("#quickMemoSlidePanel")).toContainText("即時メモがありません");

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("06-01-02 入力してCtrl+Enter→一覧に追加表示される", async ({ page }) => {
    const testId = "06-01-02";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("Ctrl+Enterで投稿するメモ");
    await page.locator("#quickMemoTextInput").press("Control+Enter");

    await expect(page.locator("#quickMemoSlidePanel")).toContainText("Ctrl+Enterで投稿するメモ");
    await expect(page.locator("#quickMemoTextInput")).toHaveValue("");

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("06-01-03 入力してCtrl+Enter→quickmemosストアに1件保存される", async ({ page }) => {
    const testId = "06-01-03";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("DB確認用Ctrl+Enterメモ");
    await page.locator("#quickMemoTextInput").press("Control+Enter");

    const records = await dumpStore(page, "quickmemos");
    expect(records.find((record) => record.text === "DB確認用Ctrl+Enterメモ")).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["quickmemos"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("06-01-04 入力して投稿ボタン→一覧に追加表示される", async ({ page }) => {
    const testId = "06-01-04";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("投稿ボタンで投稿するメモ");
    await page.locator("#postQuickMemoButton").click();

    await expect(page.locator("#quickMemoSlidePanel")).toContainText("投稿ボタンで投稿するメモ");

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("06-01-05 入力して投稿ボタン→quickmemosストアに1件保存される", async ({ page }) => {
    const testId = "06-01-05";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("DB確認用投稿ボタンメモ");
    await page.locator("#postQuickMemoButton").click();

    const records = await dumpStore(page, "quickmemos");
    expect(records.find((record) => record.text === "DB確認用投稿ボタンメモ")).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["quickmemos"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("06-01-06 個別削除→quickmemosストアから消える", async ({ page }) => {
    const testId = "06-01-06";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("削除対象メモ");
    await page.locator("#postQuickMemoButton").click();
    const before = await dumpStore(page, "quickmemos");
    expect(before).toHaveLength(1);

    await page.locator('#quickMemoSlidePanel [data-action="delete-quick-memo"]').first().click();

    const after = await dumpStore(page, "quickmemos");
    expect(after).toHaveLength(0);

    const dbShot = await captureDbSnapshot(page, testId, ["quickmemos"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("06-01-07 個別削除→一覧から消える", async ({ page }) => {
    const testId = "06-01-07";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("画面表示確認用削除対象メモ");
    await page.locator("#postQuickMemoButton").click();
    await expect(page.locator("#quickMemoSlidePanel")).toContainText("画面表示確認用削除対象メモ");

    await page.locator('#quickMemoSlidePanel [data-action="delete-quick-memo"]').first().click();

    await expect(page.locator("#quickMemoSlidePanel")).not.toContainText("画面表示確認用削除対象メモ");

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("06-01-08 全削除（0件時）→「メモがありません」トースト", async ({ page }) => {
    const testId = "06-01-08";
    resetSeq(testId);

    expect(await countStore(page, "quickmemos")).toBe(0);
    await page.locator("#clearQuickMemosButton").click();
    await expectToast(page, "メモがありません");

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("06-01-09 全削除（1件以上）→quickmemosストアが0件になる", async ({ page }) => {
    const testId = "06-01-09";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("全削除確認用メモ1");
    await page.locator("#postQuickMemoButton").click();
    await page.locator("#quickMemoTextInput").fill("全削除確認用メモ2");
    await page.locator("#postQuickMemoButton").click();
    expect(await countStore(page, "quickmemos")).toBe(2);

    await acceptConfirmDuring(page, () => page.locator("#clearQuickMemosButton").click());

    expect(await countStore(page, "quickmemos")).toBe(0);

    const dbShot = await captureDbSnapshot(page, testId, ["quickmemos"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("06-01-10 全削除→確認アラートOKで一覧が空になる", async ({ page }) => {
    const testId = "06-01-10";
    resetSeq(testId);

    await page.locator("#quickMemoTextInput").fill("全削除画面確認用メモ");
    await page.locator("#postQuickMemoButton").click();

    const confirmMessage = await acceptConfirmDuring(page, () => page.locator("#clearQuickMemosButton").click());
    expect(confirmMessage).toBe("1件のメモを全て削除しますか？");

    await expect(page.locator("#quickMemoSlidePanel")).toContainText("即時メモがありません");

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("06-01-11 閉じるボタンでパネルが閉じてメイン画面に戻る", async ({ page }) => {
    const testId = "06-01-11";
    resetSeq(testId);

    await closeSidePanel(page, "quickMemo");
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
