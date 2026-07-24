/**
 * 07 メモ — 結合試験（spec/test-items.json 07-01-01 〜 07-01-10、全10項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel, closeSidePanel, acceptConfirmDuring } = require("../helpers/ui-actions");
const { seedProject, selectProject } = require("../helpers/seed");

test.describe("07-01 メモ", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "メモ試験プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "memo");
  });

  test("07-01-01 「＋新規メモ」で作成されると編集エリアに表示される", async ({ page }) => {
    const testId = "07-01-01";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();

    await expect(page.locator("#memoEditorTitleInput")).toBeVisible();
    await expect(page.locator("#memoEditorTitleInput")).toHaveValue("新規メモ");
    await expect(page.locator("#memoEditorBodyTextarea")).toBeVisible();

    const shot = await captureScreen(page, testId, "memo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("07-01-02 新規メモ追加でmemosストアに1件増える", async ({ page }) => {
    const testId = "07-01-02";
    resetSeq(testId);

    const before = await countStore(page, "memos");
    await page.locator("#createMemoButton").click();
    await expect(page.locator("#memoEditorTitleInput")).toBeVisible();
    const after = await countStore(page, "memos");
    expect(after).toBe(before + 1);

    const dbShot = await captureDbSnapshot(page, testId, ["memos"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("07-01-03 編集タブでMarkdown本文を編集できる", async ({ page }) => {
    const testId = "07-01-03";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await expect(page.locator('[data-memo-tab="edit"]')).toHaveClass(/is-active/);
    await page.locator("#memoEditorBodyTextarea").fill("# 見出し\n本文テキスト");
    await page.locator("#memoEditorBodyTextarea").blur();

    const records = await dumpStore(page, "memos");
    expect(records[0].body).toBe("# 見出し\n本文テキスト");

    const shot = await captureScreen(page, testId, "memo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("07-01-04 プレビュータブでサニタイズ済みMarkdownプレビューが表示される", async ({ page }) => {
    const testId = "07-01-04";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await page.locator("#memoEditorBodyTextarea").fill("# 見出し\n\n本文<script>alert(1)</script>テキスト");
    await page.locator("#memoEditorBodyTextarea").blur();

    await page.locator('[data-memo-tab="preview"]').click();
    await expect(page.locator('[data-memo-tab="preview"]')).toHaveClass(/is-active/);
    await expect(page.locator(".memo-editor-preview h1")).toHaveText("見出し");
    // サニタイズにより<script>は実行可能な形で残らないこと。
    await expect(page.locator(".memo-editor-preview script")).toHaveCount(0);

    const shot = await captureScreen(page, testId, "memo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("07-01-05 分割タブで編集エリアとプレビューが並んで表示される", async ({ page }) => {
    const testId = "07-01-05";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await page.locator('[data-memo-tab="split"]').click();

    await expect(page.locator(".memo-editor-split")).toBeVisible();
    await expect(page.locator(".memo-editor-split .memo-editor-split-pane")).toHaveCount(2);
    await expect(page.locator("#memoEditorBodyTextarea")).toBeVisible();
    await expect(page.locator(".memo-editor-preview")).toBeVisible();

    const shot = await captureScreen(page, testId, "memo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("07-01-06 タイトル未入力でも扱えるが一覧の表示は仕様どおりか確認する", async ({ page }) => {
    const testId = "07-01-06";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await page.locator("#memoEditorTitleInput").fill("");
    await page.locator("#memoEditorTitleInput").blur();

    const records = await dumpStore(page, "memos");
    expect(records[0].title).toBe("");

    const listItemText = await page.locator("#memoListBody .memo-list-item").first().innerText();
    const shot = await captureScreen(page, testId, "memo-panel");

    // 【前提】期待値結果は「一覧では無題として表示される」。実装（renderMemoListToHtml）は
    //   memo.titleをそのままdivへ差し込むだけで、空文字の場合の"無題"フォールバックを
    //   持たない（"無題"はhandleDeleteMemoButtonClickの確認ダイアログ文言にのみ存在する）。
    if (listItemText.includes("無題")) {
      recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
    } else {
      recordResult({
        testId,
        judgement: "NG",
        evidenceFiles: [shot],
        note: `タイトル未入力メモの一覧表示が仕様（"無題"表示）と不一致。renderMemoListToHtmlはmemo.titleをそのまま表示するだけで空文字フォールバックが無い（実際の表示: "${listItemText.replace(/\n/g, " / ")}"）`,
      });
    }
  });

  test("07-01-07 削除ボタン：タイトルがある場合、一覧から消える", async ({ page }) => {
    const testId = "07-01-07";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await page.locator("#memoEditorTitleInput").fill("削除対象メモ");
    await page.locator("#memoEditorTitleInput").blur();
    await expect(page.locator("#memoListBody")).toContainText("削除対象メモ");

    await acceptConfirmDuring(page, () => page.locator('[data-action="delete-memo"]').first().click());

    await expect(page.locator("#memoListBody")).not.toContainText("削除対象メモ");

    const shot = await captureScreen(page, testId, "memo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("07-01-08 削除ボタン：タイトルが無い場合、一覧から消える", async ({ page }) => {
    const testId = "07-01-08";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await page.locator("#memoEditorTitleInput").fill("");
    await page.locator("#memoEditorTitleInput").blur();
    expect(await countStore(page, "memos")).toBe(1);

    const confirmMessage = await acceptConfirmDuring(page, () => page.locator('[data-action="delete-memo"]').first().click());
    expect(confirmMessage).toBe("「無題」を削除しますか？");

    expect(await countStore(page, "memos")).toBe(0);
    await expect(page.locator("#memoListBody")).toContainText("メモがありません");

    const shot = await captureScreen(page, testId, "memo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("07-01-09 削除ボタン：memosストアから当該レコードが消える", async ({ page }) => {
    const testId = "07-01-09";
    resetSeq(testId);

    await page.locator("#createMemoButton").click();
    await expect(page.locator("#memoEditorTitleInput")).toBeVisible();
    expect(await countStore(page, "memos")).toBe(1);

    await acceptConfirmDuring(page, () => page.locator('[data-action="delete-memo"]').first().click());

    expect(await countStore(page, "memos")).toBe(0);

    const dbShot = await captureDbSnapshot(page, testId, ["memos"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("07-01-10 閉じるボタンでメモパネルが閉じる", async ({ page }) => {
    const testId = "07-01-10";
    resetSeq(testId);

    await closeSidePanel(page, "memo");
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
