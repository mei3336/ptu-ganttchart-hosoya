/**
 * 10 マインドマップ — 結合試験（spec/test-items.json 10-01-01 〜 10-01-25、全25項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, captureDbSnapshot, resetSeq } = require("../helpers/evidence");
const { dumpStore, countStore } = require("../helpers/db-inspector");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel, closeSidePanel, acceptConfirmDuring, acceptPromptWithTextDuring } = require("../helpers/ui-actions");
const { seedProject, seedIssue, selectProject } = require("../helpers/seed");

async function getRootIssue(page, projectId) {
  const issues = await dumpStore(page, "issues");
  return issues.find((issue) => issue.projectId === projectId && (issue.parentNodeId === null || issue.parentNodeId === undefined));
}

async function fillMindmapInlineEditAndConfirm(page, title) {
  const input = page.locator(".mindmap-inline-edit-input");
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
  // Enter→blur→handleMindmapInlineEditInputBlurは非同期（addIssue等のawaitを含む）ため、
  // 入力欄が再描画で消える（＝保存とパネル再描画が完了した）のを待ってから次に進む。
  await expect(page.locator(".mindmap-inline-edit-input")).toHaveCount(0);
}

function mindmapNode(page, issueId) {
  return page.locator(`.mindmap-node[data-issue-id="${issueId}"]`);
}

async function rightClickContextMenuAction(page, issueId, action) {
  await mindmapNode(page, issueId).click({ button: "right" });
  await expect(page.locator("#mindmapContextMenu")).toBeVisible();
  await page.locator(`#mindmapContextMenu [data-action="${action}"]`).click();
}

test.describe("10-01 マインドマップ", () => {
  let project;

  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    project = await seedProject(page, { name: "マインドマップ試験プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "mindmap");
  });

  test("10-01-01 初期親ノード名：プロジェクト名が画面表示される", async ({ page }) => {
    const testId = "10-01-01";
    resetSeq(testId);

    await expect(page.locator(".mindmap-node")).toHaveText("マインドマップ試験プロジェクト");

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-02 初期親ノード名：issuesストアに反映される", async ({ page }) => {
    const testId = "10-01-02";
    resetSeq(testId);

    const rootIssue = await getRootIssue(page, project.id);
    expect(rootIssue).toBeTruthy();
    expect(rootIssue.title).toBe("マインドマップ試験プロジェクト");

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-03 画面フィット機能：全ノードが収まるズーム倍率に調整される", async ({ page }) => {
    const testId = "10-01-03";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    await seedIssue(page, project.id, { title: "遠くのノードA", parentNodeId: rootIssue.id, x: -1500, y: -1500 });
    await seedIssue(page, project.id, { title: "遠くのノードB", parentNodeId: rootIssue.id, x: 1500, y: 1500 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));
    // レイアウトが安定してからでないとcanvasElement.clientWidthが確定せずズーム計算がぶれるため、
    // ノード描画完了を待ってからボタンを押す。
    await expect(page.locator(".mindmap-node")).toHaveCount(3);

    await page.locator("#mindmapFitViewButton").click();

    await expect(page.locator(".mindmap-canvas-inner")).not.toHaveAttribute("style", /scale\(1\)/);

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-04 最上位ノードの子ノード追加：画面表示OK", async ({ page }) => {
    const testId = "10-01-04";
    resetSeq(testId);

    await page.locator("#addIssueButton").click();
    await fillMindmapInlineEditAndConfirm(page, "最上位の子ノード");

    await expect(page.locator("#mindmapPanelBody")).toContainText("最上位の子ノード");

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-05 最上位ノードの子ノード追加：issuesストアに反映される", async ({ page }) => {
    const testId = "10-01-05";
    resetSeq(testId);

    const before = await countStore(page, "issues");
    await page.locator("#addIssueButton").click();
    await fillMindmapInlineEditAndConfirm(page, "DB確認用の子ノード");

    const records = await dumpStore(page, "issues");
    expect(records).toHaveLength(before + 1);
    expect(records.find((record) => record.title === "DB確認用の子ノード")).toBeTruthy();

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-06 ノード追加：変更履歴パネルにエントリが表示される", async ({ page }) => {
    const testId = "10-01-06";
    resetSeq(testId);

    await page.locator("#addIssueButton").click();
    await fillMindmapInlineEditAndConfirm(page, "変更履歴確認用ノード");

    // マインドマップパネルは横幅が広くヘッダーのボタンと重なりうるため、先に閉じてから
    // 変更履歴パネルを開く。
    await closeSidePanel(page, "mindmap");
    await openSidePanel(page, "changelog");
    await expect(page.locator("#changelogPanelBody")).toContainText("変更履歴確認用ノード");
    await expect(page.locator("#changelogPanelBody .changelog-action-badge.is-add").first()).toBeVisible();

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-07 名前変更：画面表示OK", async ({ page }) => {
    const testId = "10-01-07";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);

    await acceptPromptWithTextDuring(page, "変更後のノード名", () => rightClickContextMenuAction(page, rootIssue.id, "rename"));

    await expect(mindmapNode(page, rootIssue.id)).toHaveText("変更後のノード名");

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-08 名前変更：issuesストアのtitleが更新される", async ({ page }) => {
    const testId = "10-01-08";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);

    await acceptPromptWithTextDuring(page, "DB確認用変更後名", () => rightClickContextMenuAction(page, rootIssue.id, "rename"));

    const records = await dumpStore(page, "issues");
    expect(records.find((record) => record.id === rootIssue.id).title).toBe("DB確認用変更後名");

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-09 名前変更：変更履歴に action:edit, store:issues, changesにtitle差分が記録される", async ({ page }) => {
    const testId = "10-01-09";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);

    await acceptPromptWithTextDuring(page, "履歴確認用変更後名", () => rightClickContextMenuAction(page, rootIssue.id, "rename"));

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("edit");
    expect(latest.store).toBe("issues");
    expect(latest.changes.some((change) => change.field === "title")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-10 子ノード追加（右クリックメニュー）：画面表示OK", async ({ page }) => {
    const testId = "10-01-10";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);

    await rightClickContextMenuAction(page, rootIssue.id, "add-child");
    await fillMindmapInlineEditAndConfirm(page, "右クリックで追加した子ノード");

    await expect(page.locator("#mindmapPanelBody")).toContainText("右クリックで追加した子ノード");

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-11 子ノード追加（右クリックメニュー）：issuesストアに反映される", async ({ page }) => {
    const testId = "10-01-11";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);

    await rightClickContextMenuAction(page, rootIssue.id, "add-child");
    await fillMindmapInlineEditAndConfirm(page, "DB確認用右クリック子ノード");

    const records = await dumpStore(page, "issues");
    const created = records.find((record) => record.title === "DB確認用右クリック子ノード");
    expect(created).toBeTruthy();
    expect(created.parentNodeId).toBe(rootIssue.id);

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-12 子ノード追加（右クリックメニュー）：変更履歴に表示される", async ({ page }) => {
    const testId = "10-01-12";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);

    await rightClickContextMenuAction(page, rootIssue.id, "add-child");
    await fillMindmapInlineEditAndConfirm(page, "履歴確認用右クリック子ノード");

    await closeSidePanel(page, "mindmap");
    await openSidePanel(page, "changelog");
    await expect(page.locator("#changelogPanelBody")).toContainText("履歴確認用右クリック子ノード");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-13 兄弟ノード追加：画面表示OK", async ({ page }) => {
    const testId = "10-01-13";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const child = await seedIssue(page, project.id, { title: "基準となる子ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    await rightClickContextMenuAction(page, child.id, "add-sibling");
    await fillMindmapInlineEditAndConfirm(page, "追加した兄弟ノード");

    await expect(page.locator("#mindmapPanelBody")).toContainText("追加した兄弟ノード");

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-14 兄弟ノード追加：issuesストアに反映される", async ({ page }) => {
    const testId = "10-01-14";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const child = await seedIssue(page, project.id, { title: "DB確認用基準ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    await rightClickContextMenuAction(page, child.id, "add-sibling");
    await fillMindmapInlineEditAndConfirm(page, "DB確認用兄弟ノード");

    const records = await dumpStore(page, "issues");
    const created = records.find((record) => record.title === "DB確認用兄弟ノード");
    expect(created).toBeTruthy();
    expect(created.parentNodeId).toBe(rootIssue.id);

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-15 兄弟ノード追加：変更履歴に表示される", async ({ page }) => {
    const testId = "10-01-15";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const child = await seedIssue(page, project.id, { title: "履歴確認用基準ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    await rightClickContextMenuAction(page, child.id, "add-sibling");
    await fillMindmapInlineEditAndConfirm(page, "履歴確認用兄弟ノード");

    await closeSidePanel(page, "mindmap");
    await openSidePanel(page, "changelog");
    await expect(page.locator("#changelogPanelBody")).toContainText("履歴確認用兄弟ノード");

    const shot = await captureScreen(page, testId, "changelog-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-16 折り畳み機能ON：配下の子ノードが非表示になる", async ({ page }) => {
    const testId = "10-01-16";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    await seedIssue(page, project.id, { title: "折り畳み対象の子ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));
    await expect(page.locator(".mindmap-node")).toHaveCount(2);

    await rightClickContextMenuAction(page, rootIssue.id, "toggle-collapse");

    await expect(page.locator(".mindmap-node")).toHaveCount(1);
    await expect(mindmapNode(page, rootIssue.id)).toHaveClass(/is-collapsed-node/);

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-17 折り畳み機能OFF：配下の子ノードが再表示される", async ({ page }) => {
    const testId = "10-01-17";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    await seedIssue(page, project.id, { title: "折り畳み解除対象の子ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));
    await rightClickContextMenuAction(page, rootIssue.id, "toggle-collapse");
    await expect(page.locator(".mindmap-node")).toHaveCount(1);

    await rightClickContextMenuAction(page, rootIssue.id, "toggle-collapse");

    await expect(page.locator(".mindmap-node")).toHaveCount(2);
    await expect(mindmapNode(page, rootIssue.id)).not.toHaveClass(/is-collapsed-node/);

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-18 子ノードの削除：画面から消える", async ({ page }) => {
    const testId = "10-01-18";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const child = await seedIssue(page, project.id, { title: "削除対象の子ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    // 起点＋子孫が3件以下（この子ノード1件のみ）のため確認ダイアログ無しで即削除される。
    await rightClickContextMenuAction(page, child.id, "delete");

    await expect(mindmapNode(page, child.id)).toHaveCount(0);

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-19 子ノードの削除：issuesストアから消える", async ({ page }) => {
    const testId = "10-01-19";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const child = await seedIssue(page, project.id, { title: "DB確認用削除対象子ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    await rightClickContextMenuAction(page, child.id, "delete");
    // handleDeleteIssueButtonClickは非同期（deleteIssueCascade→applyMindmapAutoLayout→
    // refreshMindmapPanel）のため、ノードがDOMから消えるのを待ってからDBを確認する。
    await expect(mindmapNode(page, child.id)).toHaveCount(0);

    const records = await dumpStore(page, "issues");
    expect(records.find((record) => record.id === child.id)).toBeUndefined();

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-20 子ノードの削除：変更履歴に action:delete, store:issues が表示される", async ({ page }) => {
    const testId = "10-01-20";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const child = await seedIssue(page, project.id, { title: "履歴確認用削除対象子ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    await rightClickContextMenuAction(page, child.id, "delete");
    await expect(mindmapNode(page, child.id)).toHaveCount(0);

    const logRecords = await dumpStore(page, "changelog");
    const latest = logRecords[logRecords.length - 1];
    expect(latest.action).toBe("delete");
    expect(latest.store).toBe("issues");
    expect(latest.itemName).toBe("履歴確認用削除対象子ノード");

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-21 親ノードの削除（配下含め3件以下）：画面から連鎖して消える", async ({ page }) => {
    const testId = "10-01-21";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const parent = await seedIssue(page, project.id, { title: "3件以下の親ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    const child = await seedIssue(page, project.id, { title: "3件以下の子ノード", parentNodeId: parent.id, x: 150, y: 150 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    // 親＋子＝2件（3件以下）のため確認ダイアログ無しで即削除される。
    await rightClickContextMenuAction(page, parent.id, "delete");

    await expect(mindmapNode(page, parent.id)).toHaveCount(0);
    await expect(mindmapNode(page, child.id)).toHaveCount(0);

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-22 親ノードの削除（配下含め4件以上）：確認の上、画面から連鎖して消える", async ({ page }) => {
    const testId = "10-01-22";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const parent = await seedIssue(page, project.id, { title: "4件以上の親ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    const child1 = await seedIssue(page, project.id, { title: "4件以上の子ノード1", parentNodeId: parent.id, x: 150, y: 150 });
    const child2 = await seedIssue(page, project.id, { title: "4件以上の子ノード2", parentNodeId: parent.id, x: 150, y: 200 });
    const child3 = await seedIssue(page, project.id, { title: "4件以上の子ノード3", parentNodeId: parent.id, x: 150, y: 250 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    // 親＋子3件＝4件（3件超）のため確認ダイアログが出る。
    const confirmMessage = await acceptConfirmDuring(page, () => rightClickContextMenuAction(page, parent.id, "delete"));
    expect(confirmMessage).toBe("このノードと子孫ノード計4件を削除しますか？");

    for (const issue of [parent, child1, child2, child3]) {
      await expect(mindmapNode(page, issue.id)).toHaveCount(0);
    }

    const shot = await captureScreen(page, testId, "mindmap-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("10-01-23 親ノード削除の連鎖：issuesストアから親と配下が消える", async ({ page }) => {
    const testId = "10-01-23";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const parent = await seedIssue(page, project.id, { title: "DB確認用連鎖削除親ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    const child1 = await seedIssue(page, project.id, { title: "DB確認用連鎖削除子ノード1", parentNodeId: parent.id, x: 150, y: 150 });
    const child2 = await seedIssue(page, project.id, { title: "DB確認用連鎖削除子ノード2", parentNodeId: parent.id, x: 150, y: 200 });
    const child3 = await seedIssue(page, project.id, { title: "DB確認用連鎖削除子ノード3", parentNodeId: parent.id, x: 150, y: 250 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    await acceptConfirmDuring(page, () => rightClickContextMenuAction(page, parent.id, "delete"));
    await expect(mindmapNode(page, parent.id)).toHaveCount(0);

    const records = await dumpStore(page, "issues");
    for (const issue of [parent, child1, child2, child3]) {
      expect(records.find((record) => record.id === issue.id)).toBeUndefined();
    }

    const dbShot = await captureDbSnapshot(page, testId, ["issues"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-24 親ノード削除の連鎖：変更履歴に削除ノード分のエントリが記録される", async ({ page }) => {
    const testId = "10-01-24";
    resetSeq(testId);
    const rootIssue = await getRootIssue(page, project.id);
    const parent = await seedIssue(page, project.id, { title: "履歴確認用連鎖削除親ノード", parentNodeId: rootIssue.id, x: 100, y: 100 });
    await seedIssue(page, project.id, { title: "履歴確認用連鎖削除子ノード1", parentNodeId: parent.id, x: 150, y: 150 });
    await seedIssue(page, project.id, { title: "履歴確認用連鎖削除子ノード2", parentNodeId: parent.id, x: 150, y: 200 });
    await seedIssue(page, project.id, { title: "履歴確認用連鎖削除子ノード3", parentNodeId: parent.id, x: 150, y: 250 });
    await page.evaluate(() => refreshMindmapPanel(currentSelectedProjectId));

    const beforeLog = await countStore(page, "changelog");
    await acceptConfirmDuring(page, () => rightClickContextMenuAction(page, parent.id, "delete"));
    await expect(mindmapNode(page, parent.id)).toHaveCount(0);
    const afterLog = await countStore(page, "changelog");

    // 親＋子3件＝4件分のdeleteログが積まれる。
    expect(afterLog).toBe(beforeLog + 4);
    const logRecords = await dumpStore(page, "changelog");
    const newEntries = logRecords.slice(-4);
    expect(newEntries.every((entry) => entry.action === "delete" && entry.store === "issues")).toBe(true);

    const dbShot = await captureDbSnapshot(page, testId, ["changelog"]);
    recordResult({ testId, judgement: "OK", evidenceFiles: [dbShot] });
  });

  test("10-01-25 閉じるボタンでマインドマップパネルが閉じる", async ({ page }) => {
    const testId = "10-01-25";
    resetSeq(testId);

    await closeSidePanel(page, "mindmap");
    await expect(page.locator(".main-workspace")).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
