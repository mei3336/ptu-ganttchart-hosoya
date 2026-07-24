// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * GanttForge再現アプリ 結合試験 Playwright設定
 *
 * 前提条件（仕様書 5.テスト環境）:
 *  - 実行方法: index.html をブラウザで開く（file:// またはローカルサーバ）
 *  - 確認方式: ブラウザ手動確認 → 本ハーネスで自動化
 *  - ブラウザ: Chromium固定（仕様書10.リスクにある通りブラウザ差異を避けるため1種のみ）
 *
 * TARGET_URL は環境変数で切替可能:
 *   file://の場合   : TARGET_URL="file:///絶対パス/index.html" npx playwright test
 *   localhostの場合 : TARGET_URL="http://localhost:8080/index.html" npx playwright test
 */
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:8080/index.html';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // IndexedDBの状態に依存するテストが多いため直列実行を既定とする
  workers: 1,
  retries: 0,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'results/raw-results.json' }],
    ['list'],
  ],
  use: {
    baseURL: TARGET_URL,
    trace: 'retain-on-failure',
    screenshot: 'off', // 証跡キャプチャは helpers/evidence.js で命名規則通りに個別取得する
    video: 'retain-on-failure',
    // 【前提】既定の1280px幅だと、右側スライドパネル＋カンバン3列等の横幅がビューポートを
    //   超え、右端付近の要素（編集エリア・画面フィットボタン等）へのクリックが実際の
    //   ブラウザ表示領域外に落ちて無反応になることを実機確認した。
    // 【処理】ビューポートを1600x900に広げ、パネルを開いた状態でも主要な操作対象が
    //   常にビューポート内に収まるようにする。
    viewport: { width: 1600, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
