/**
 * ui-actions.js
 *
 * 234項目に共通する「UI操作」をまとめたヘルパー。DOM構造（id・クラス名）は
 * index.htmlの実装（グローバル関数のコメント・renderXxxToHtml系）から直接確認したもの。
 */

const { expect } = require("@playwright/test");

// ヘッダーの各スライドパネルの定義。index.html の SIDE_PANEL_DEFINITIONS と1対1で対応する。
const SIDE_PANEL_BY_KEY = {
  kanban: { panelId: "kanbanSlidePanel", buttonId: "switchToKanbanButton" },
  snapshot: { panelId: "snapshotSlidePanel", buttonId: "snapshotButton" },
  quickMemo: { panelId: "quickMemoSlidePanel", buttonId: "quickMemoButton" },
  memo: { panelId: "memoSlidePanel", buttonId: "memoButton" },
  comment: { panelId: "commentSlidePanel", buttonId: "commentButton" },
  changelog: { panelId: "changelogSlidePanel", buttonId: "changelogButton" },
  mindmap: { panelId: "mindmapSlidePanel", buttonId: "switchToMindmapButton" },
};

/**
 * 【前提】page はGanttForge再現アプリを開いた状態（goto済み）であること。
 * 【処理】IndexedDB（GanttForgeDB）を削除してからリロードし、初期状態（プロジェクト0件）を作る。
 * 【結果】プロジェクトが1件も無い、アプリ起動直後と同じ状態になる。
 */
async function resetToInitialState(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("GanttForgeDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
}

/** ヘッダー「＋ 新規プロジェクト」ボタンで新規作成モーダルを開く。 */
async function openCreateProjectModal(page) {
  await page.locator("#createProjectButton").click();
}

/** ヘッダー「編集」ボタンでプロジェクト編集モーダルを開く。 */
async function openEditProjectModal(page) {
  await page.locator("#editProjectButton").click();
}

/**
 * プロジェクトモーダル（新規／編集共通）の入力欄を埋める。undefinedのフィールドは変更しない。
 * @param {import('@playwright/test').Page} page
 * @param {{name?: string, startDate?: string, endDate?: string}} fields
 */
async function fillProjectModal(page, fields) {
  if (fields.name !== undefined) await page.locator("#projectModalNameInput").fill(fields.name);
  if (fields.startDate !== undefined) await page.locator("#projectModalStartDateInput").fill(fields.startDate);
  if (fields.endDate !== undefined) await page.locator("#projectModalEndDateInput").fill(fields.endDate);
}

/**
 * プロジェクトモーダルの保存ボタンを押し、正常保存（アラート無し）を期待する。
 * 保存後、モーダルが閉じるまで待つ。
 */
async function saveProjectModalExpectingSuccess(page) {
  await page.locator("#projectModalSaveButton").click();
  await expect(page.locator("#modalOverlay")).toBeHidden();
}

/**
 * 【前提】なし。
 * 【処理】dialog（alert/confirm/prompt）を待ち受け、発生した瞬間にaccept/dismissする
 *   Promiseを組み立てる。
 * 【設計判断】alert()・confirm()は同期的にレンダラーをブロックするものと、ハンドラ内で
 *   await（IndexedDB読み取り等）を挟んでから呼ばれる非同期なものの両方があり、後者では
 *   ダイアログの出現がtriggerAction（クリック）自体の完了より後になる。
 *   「waitForEventしてからclickをawaitする」実装だと前者でデッドロック（clickがダイアログの
 *   解決を待ち、ダイアログの解決がclickの完了後まで行われない）になり、逆に「clickの完了を
 *   待ってからダイアログを待つ」実装だと後者でtriggerActionが先に終わってしまいダイアログを
 *   取りこぼす。ここでは「ダイアログが来た瞬間に即accept/dismissし、その結果をPromiseとして
 *   触れずに返す」ことで、同期・非同期どちらの出現タイミングでも取りこぼさない。
 * 【結果】呼び出し側がtriggerActionと独立にawaitできる、ダイアログ文言のPromiseを返す。
 */
function waitForDialogAndResolve(page, respond) {
  return new Promise((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await respond(dialog);
    });
  });
}

/**
 * プロジェクトモーダルの保存ボタンを押し、バリデーションアラートが出ることを期待する。
 * @returns {Promise<string>} アラートの文言
 */
async function saveProjectModalExpectingAlert(page) {
  const dialogMessagePromise = waitForDialogAndResolve(page, (dialog) => dialog.accept());
  await page.locator("#projectModalSaveButton").click();
  return dialogMessagePromise;
}

/** ヘッダー「＋ スケジュール追加」ボタンでスケジュール追加モーダルを開く。 */
async function openAddScheduleModal(page) {
  await page.locator("#addScheduleButton").click();
}

/**
 * スケジュールモーダル（新規／編集共通）の入力欄を埋める。undefinedのフィールドは変更しない。
 * @param {{name?: string, startDate?: string, endDate?: string, assignee?: string, notes?: string}} fields
 */
async function fillScheduleModal(page, fields) {
  if (fields.name !== undefined) await page.locator("#scheduleModalNameInput").fill(fields.name);
  if (fields.startDate !== undefined) await page.locator("#scheduleModalStartDateInput").fill(fields.startDate);
  if (fields.endDate !== undefined) await page.locator("#scheduleModalEndDateInput").fill(fields.endDate);
  if (fields.assignee !== undefined) await page.locator("#scheduleModalAssigneeInput").fill(fields.assignee);
  if (fields.notes !== undefined) await page.locator("#scheduleModalNotesTextarea").fill(fields.notes);
}

async function saveScheduleModalExpectingSuccess(page) {
  await page.locator("#scheduleModalSaveButton").click();
  await expect(page.locator("#modalOverlay")).toBeHidden();
}

async function saveScheduleModalExpectingAlert(page) {
  const dialogMessagePromise = waitForDialogAndResolve(page, (dialog) => dialog.accept());
  await page.locator("#scheduleModalSaveButton").click();
  return dialogMessagePromise;
}

/**
 * confirm()ダイアログを承諾しつつactionを実行する（プロジェクト削除・メモ削除等の
 * 「確認ダイアログの上で実行する」操作に使う共通ヘルパー）。
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<void>} triggerAction ダイアログを発生させる操作（ボタンクリック等）
 * @returns {Promise<string>} confirmダイアログの文言
 */
async function acceptConfirmDuring(page, triggerAction) {
  const dialogMessagePromise = waitForDialogAndResolve(page, (dialog) => dialog.accept());
  await triggerAction();
  return dialogMessagePromise;
}

/** confirm()ダイアログをキャンセルしつつactionを実行する。 */
async function dismissConfirmDuring(page, triggerAction) {
  const dialogMessagePromise = waitForDialogAndResolve(page, (dialog) => dialog.dismiss());
  await triggerAction();
  return dialogMessagePromise;
}

/**
 * prompt()ダイアログに指定文言を入力してOKしつつactionを実行する
 * （スナップショット保存の名前入力等）。
 * @param {import('@playwright/test').Page} page
 * @param {string} promptText 入力する文言
 * @param {() => Promise<void>} triggerAction ダイアログを発生させる操作
 */
async function acceptPromptWithTextDuring(page, promptText, triggerAction) {
  const dialogMessagePromise = waitForDialogAndResolve(page, (dialog) => dialog.accept(promptText));
  await triggerAction();
  await dialogMessagePromise;
}

/**
 * 【前提】panelKey は SIDE_PANEL_BY_KEY のキー（'snapshot'|'quickMemo'|'memo'|'comment'|
 *   'changelog'|'mindmap'）のいずれか。
 * 【処理】対応するヘッダーボタンをクリックしてスライドパネルを開く。
 * 【結果】パネルに.is-openクラスが付き、開いた瞬間の最新データで再描画される。
 */
async function openSidePanel(page, panelKey) {
  const definition = SIDE_PANEL_BY_KEY[panelKey];
  await page.locator(`#${definition.buttonId}`).click();
  await expect(page.locator(`#${definition.panelId}`)).toHaveClass(/is-open/);
}

async function closeSidePanel(page, panelKey) {
  const definition = SIDE_PANEL_BY_KEY[panelKey];
  await page.locator(`#${definition.panelId} .slide-panel-close-button`).click();
  await expect(page.locator(`#${definition.panelId}`)).not.toHaveClass(/is-open/);
}

/** 現在表示中のトースト文言を取得する（表示前の場合は空文字）。 */
async function getToastText(page) {
  return page.locator("#toast").textContent();
}

/** トーストが指定文言で表示されるのを待つ。 */
async function expectToast(page, message) {
  await expect(page.locator("#toast")).toHaveClass(/show/);
  await expect(page.locator("#toast")).toHaveText(message);
}

module.exports = {
  resetToInitialState,
  openCreateProjectModal,
  openEditProjectModal,
  fillProjectModal,
  saveProjectModalExpectingSuccess,
  saveProjectModalExpectingAlert,
  openAddScheduleModal,
  fillScheduleModal,
  saveScheduleModalExpectingSuccess,
  saveScheduleModalExpectingAlert,
  acceptConfirmDuring,
  dismissConfirmDuring,
  acceptPromptWithTextDuring,
  openSidePanel,
  closeSidePanel,
  getToastText,
  expectToast,
};
