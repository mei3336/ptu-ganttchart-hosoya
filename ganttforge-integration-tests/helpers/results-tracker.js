/**
 * results-tracker.js
 *
 * 各テストの判定結果・証跡ファイル名・実施日時を results/test-results.json に蓄積する。
 * 実行後、helpers/results-writer.py がこのJSONを読み、元のxlsxの
 * 実施日／実施者／判定／証跡／不具合票 列に書き戻す。
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'test-results.json');

function loadAll() {
  if (!fs.existsSync(RESULTS_FILE)) return {};
  return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
}

function saveAll(all) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2), 'utf-8');
}

/**
 * @param {object} record
 * @param {string} record.testId 例: "13-07-01"
 * @param {'OK'|'NG'|'保'} record.judgement
 * @param {string[]} record.evidenceFiles 証跡ファイル名（相対パス、evidence/配下）
 * @param {string} [record.tester] 実施者
 * @param {string} [record.bugTicket] 不具合票番号（NGの場合）
 * @param {string} [record.note] 実施時の備考
 */
function recordResult({ testId, judgement, evidenceFiles = [], tester = 'Claude Code (自動実施)', bugTicket = '', note = '' }) {
  const all = loadAll();
  all[testId] = {
    実施日: new Date().toISOString().slice(0, 10),
    実施者: tester,
    判定: judgement,
    証跡: evidenceFiles.map((f) => path.basename(f)).join(', '),
    不具合票: bugTicket,
    備考: note,
  };
  saveAll(all);
}

module.exports = { recordResult, loadAll };
