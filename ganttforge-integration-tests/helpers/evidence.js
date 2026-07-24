/**
 * evidence.js
 *
 * 仕様書 6.テスト実施手順「エビデンス命名規則」を機械的に守るためのヘルパー。
 *   <項目ID>_<連番>_<画面 or db>.png
 *   例: 13-07-01_01_gantt.png / 13-07-01_02_db.png
 *
 * 連番はテストID単位でカウンタを保持し、同一テスト内で複数回キャプチャしても自動採番する。
 */

const fs = require('fs');
const path = require('path');
const { renderDbSnapshotAsHtml, removeDbSnapshotOverlay } = require('./db-inspector');

const EVIDENCE_DIR = path.join(__dirname, '..', 'evidence');

const counters = new Map(); // testId -> 連番

function nextSeq(testId) {
  const cur = counters.get(testId) ?? 0;
  const next = cur + 1;
  counters.set(testId, next);
  return String(next).padStart(2, '0');
}

function ensureDir() {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

/**
 * 画面キャプチャを命名規則通りに保存する。
 * @param {import('@playwright/test').Page} page
 * @param {string} testId 例: "13-07-01"
 * @param {string} label 画面名の短縮ラベル（例: "gantt", "wbs", "modal"）
 * @returns {Promise<string>} 保存先の絶対パス
 */
async function captureScreen(page, testId, label) {
  ensureDir();
  const seq = nextSeq(testId);
  const filename = `${testId}_${seq}_${label}.png`;
  const filepath = path.join(EVIDENCE_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

/**
 * DBスナップショットをキャプチャする（オーバーレイ描画→撮影→撤去）。
 * 仕様書「プロジェクト切替・連鎖削除・日付伝播・スナップショット復元はIndexedDBの
 * キャプチャを必須とする」に対応。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} testId
 * @param {string[]} storeNames
 * @returns {Promise<string>}
 */
async function captureDbSnapshot(page, testId, storeNames) {
  ensureDir();
  await renderDbSnapshotAsHtml(page, storeNames);
  const seq = nextSeq(testId);
  const filename = `${testId}_${seq}_db.png`;
  const filepath = path.join(EVIDENCE_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  await removeDbSnapshotOverlay(page);
  return filepath;
}

/** テスト開始時にそのテストIDの連番カウンタをリセットする（describe/beforeEachで呼ぶ） */
function resetSeq(testId) {
  counters.delete(testId);
}

module.exports = { captureScreen, captureDbSnapshot, resetSeq, EVIDENCE_DIR };
