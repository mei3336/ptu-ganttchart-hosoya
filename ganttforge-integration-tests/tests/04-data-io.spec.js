/**
 * 04 データ入出力 — 結合試験（spec/test-items.json 04-01-01 〜 04-04-01、全9項目）
 */

const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, acceptConfirmDuring, expectToast } = require("../helpers/ui-actions");
const { seedProjectWithAllChildStores, selectProject } = require("../helpers/seed");

const SCRATCH_DIR = path.join(__dirname, "..", "evidence", "tmp-import-files");

function writeTempJsonFile(fileName, content) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const filePath = path.join(SCRATCH_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
  return filePath;
}

/**
 * 【前提】なし。
 * 【処理】既存の何とも重複しないid（"import-"接頭辞）で、8ストア分「新規追加候補」の
 *   レコードを1件ずつ持つバックアップ形式オブジェクトを組み立てる。
 * 【結果】isValidImportedBackupShape(=projects/schedulesが配列)を満たすオブジェクトを返す。
 */
function buildImportBackupFixture() {
  const projectId = "import-project-1";
  const scheduleId = "import-schedule-1";
  return {
    projects: [{ id: projectId, name: "取込プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31", milestones: [], locked: false, createdAt: "2026-01-01T00:00:00.000Z" }],
    schedules: [{ id: scheduleId, projectId, parentId: null, name: "取込スケジュール", startDate: "2026-02-01", endDate: "2026-02-10", assignee: "", taskStatus: "todo", notes: "", color: "#2563EB", order: 0 }],
    tasks: [{ id: "import-task-1", projectId, title: "取込タスク", status: "todo", done: false, doneAt: null, priority: 2, dueDate: "", description: "", order: 0 }],
    issues: [{ id: "import-issue-1", projectId, title: "取込ノード", parentNodeId: null, x: 0, y: 0, color: "#2563EB", order: 0 }],
    comments: [{ id: "import-comment-1", taskId: scheduleId, text: "取込コメント", createdAt: "2026-01-01T00:00:00.000Z" }],
    memos: [{ id: "import-memo-1", projectId, title: "取込メモ", body: "", order: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    quickmemos: [{ id: "import-quickmemo-1", projectId, text: "取込即時メモ", createdAt: "2026-01-01T00:00:00.000Z" }],
    snapshots: [{ id: "import-snapshot-1", projectId, name: "取込スナップショット", createdAt: "2026-01-01T00:00:00.000Z", data: { project: null, schedules: [] } }],
  };
}

test.describe("04-01 データ取込", () => {
  let seededData;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    seededData = await seedProjectWithAllChildStores(page, { name: "既存プロジェクト" });
    await selectProject(page, seededData.project.id);
  });

  test("04-01-01 形式が対応していない→アラート表示・DB無変更", async ({ page }) => {
    const testId = "04-01-01";
    resetSeq(testId);

    const invalidFilePath = writeTempJsonFile("invalid.json", { foo: "bar" });
    const beforeCounts = {};
    for (const storeName of ["projects", "schedules", "tasks", "issues", "comments", "memos", "quickmemos", "snapshots"]) {
      beforeCounts[storeName] = await countStore(page, storeName);
    }

    const dialogPromise = new Promise((resolve) => page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    }));
    await page.locator("#importFileInput").setInputFiles(invalidFilePath);
    const message = await dialogPromise;
    expect(message).toBe("無効なファイルです。GanttForgeのエクスポートファイルを選択してください。");

    for (const storeName of Object.keys(beforeCounts)) {
      expect(await countStore(page, storeName)).toBe(beforeCounts[storeName]);
    }

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("04-01-02 有効なJSONで差分モーダルに8ストア分の差分が表示される", async ({ page }) => {
    const testId = "04-01-02";
    resetSeq(testId);

    const validFilePath = writeTempJsonFile("valid.json", buildImportBackupFixture());
    await page.locator("#importFileInput").setInputFiles(validFilePath);

    await expect(page.locator(".import-diff-store-group")).toHaveCount(8);
    for (const label of ["プロジェクト", "スケジュール", "タスク", "マインドマップノード", "コメント", "メモ", "即時メモ", "スナップショット"]) {
      await expect(page.locator(".import-diff-list")).toContainText(label);
    }

    const shot = await captureScreen(page, testId, "modal");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("04-01-03 既存プロジェクトを削除する／しないを選択できる", async ({ page }) => {
    const testId = "04-01-03";
    resetSeq(testId);
    const existingProjectId = seededData.project.id;

    const validFilePath = writeTempJsonFile("valid.json", buildImportBackupFixture());
    await page.locator("#importFileInput").setInputFiles(validFilePath);

    const existingProjectDeleteCheckbox = page.locator(
      `.import-diff-checkbox[data-store-key="projects"][data-action="del"][data-item-id="${existingProjectId}"]`
    );
    await expect(existingProjectDeleteCheckbox).toBeChecked();
    // 「削除しない」を選べることを確認する＝チェックを外せる。
    await existingProjectDeleteCheckbox.uncheck();
    await expect(existingProjectDeleteCheckbox).not.toBeChecked();

    await acceptConfirmDuring(page, () => page.locator("#importDiffApplyButton").click());
    await expectToast(page, /取込完了/);

    const projectRecords = await dumpStore(page, "projects");
    // チェックを外した＝削除しない、を選んだので既存プロジェクトはDBに残っている。
    expect(projectRecords.find((record) => record.id === existingProjectId)).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["projects"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("04-01-04 選択項目のみ反映されトースト表示OK", async ({ page }) => {
    const testId = "04-01-04";
    resetSeq(testId);

    const validFilePath = writeTempJsonFile("valid.json", buildImportBackupFixture());
    await page.locator("#importFileInput").setInputFiles(validFilePath);
    // 全選択（既定でチェック済みだが明示的に全選択チェックボックスも確認する）のまま適用する。
    await expect(page.locator("#importDiffSelectAllCheckbox")).toBeChecked();

    await acceptConfirmDuring(page, () => page.locator("#importDiffApplyButton").click());
    // 8ストア×(追加1件+削除1件)＝新規8件・変更0件・削除8件。
    await expectToast(page, "取込完了: 新規8件 / 変更0件 / 削除8件");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("04-01-05 DB反映OK：選択項目のみ各ストアに反映される", async ({ page }) => {
    const testId = "04-01-05";
    resetSeq(testId);
    const existingProjectId = seededData.project.id;

    const validFilePath = writeTempJsonFile("valid.json", buildImportBackupFixture());
    await page.locator("#importFileInput").setInputFiles(validFilePath);
    await acceptConfirmDuring(page, () => page.locator("#importDiffApplyButton").click());
    await expectToast(page, "取込完了: 新規8件 / 変更0件 / 削除8件");

    const projectRecords = await dumpStore(page, "projects");
    expect(projectRecords.find((record) => record.id === "import-project-1")).toBeTruthy();
    expect(projectRecords.find((record) => record.id === existingProjectId)).toBeUndefined();

    const scheduleRecords = await dumpStore(page, "schedules");
    expect(scheduleRecords.find((record) => record.id === "import-schedule-1")).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["projects", "schedules", "tasks", "issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("04-01-06 変更履歴反映OK：適用件数分（1件ごと）記録される", async ({ page }) => {
    const testId = "04-01-06";
    resetSeq(testId);

    const beforeLog = await countStore(page, "changelog");
    const validFilePath = writeTempJsonFile("valid.json", buildImportBackupFixture());
    await page.locator("#importFileInput").setInputFiles(validFilePath);
    await acceptConfirmDuring(page, () => page.locator("#importDiffApplyButton").click());
    await expectToast(page, "取込完了: 新規8件 / 変更0件 / 削除8件");

    // LOGGED_STORES（projects/schedules/tasks/issues）の4ストア×(追加1+削除1)＝8件だけ増える。
    // comments/memos/quickmemos/snapshotsの取込は変更履歴の対象外（一括の特別扱いもしない）。
    const afterLog = await countStore(page, "changelog");
    expect(afterLog).toBe(beforeLog + 8);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });
});

test.describe("04-02/03/04 データ出力（JSON・PDF・Excel）", () => {
  let seededData;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    seededData = await seedProjectWithAllChildStores(page, { name: "出力対象プロジェクト" });
    await selectProject(page, seededData.project.id);
  });

  test("04-02-01 JSON出力：ダウンロードされ中身にChangelog以外の全8ストアが含まれる", async ({ page }) => {
    const testId = "04-02-01";
    resetSeq(testId);

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportDataButton").click()]);
    await expectToast(page, "データをエクスポートしました");

    const downloadedPath = await download.path();
    const content = JSON.parse(fs.readFileSync(downloadedPath, "utf-8"));
    const expectedKeys = ["projects", "schedules", "tasks", "issues", "comments", "memos", "quickmemos", "snapshots"];
    expect(Object.keys(content).sort()).toEqual(expectedKeys.sort());
    expect(content.changelog).toBeUndefined();
    expect(content.projects.some((project) => project.id === seededData.project.id)).toBe(true);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("04-03-01 PDF出力：ダウンロードされ内容が生成される", async ({ page }) => {
    const testId = "04-03-01";
    resetSeq(testId);

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportPdfButton").click()]);
    await expectToast(page, "PDFを保存しました");

    const downloadedPath = await download.path();
    const buffer = fs.readFileSync(downloadedPath);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("04-04-01 Excel出力：ダウンロードされシート1に固定列見出しが出力される", async ({ page }) => {
    const testId = "04-04-01";
    resetSeq(testId);

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportExcelButton").click()]);

    const downloadedPath = await download.path();
    const buffer = fs.readFileSync(downloadedPath);
    // xlsxはZIP形式（先頭マジックナンバー"PK"）であることをまず確認する。
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    // 中身の検証は、アプリ自身が読み込み済みのxlsx-js-style（window.XLSX）をそのまま使う
    // （Node側に別途xlsxパーサを追加install しないための設計判断）。
    const byteArray = Array.from(buffer);
    const result = await page.evaluate((bytes) => {
      const workbook = XLSX.read(new Uint8Array(bytes), { type: "array" });
      const sheet = workbook.Sheets["ガントチャート"];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      return { sheetNames: workbook.SheetNames, headerRow: rows[1] };
    }, byteArray);

    expect(result.sheetNames).toEqual(["ガントチャート", "サマリー"]);
    expect(result.headerRow.slice(0, 9)).toEqual(["No", "WBS", "スケジュール", "階層", "開始日", "終了日", "期間", "担当者", "ステータス"]);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
