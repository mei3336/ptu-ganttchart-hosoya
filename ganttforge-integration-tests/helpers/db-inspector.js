/**
 * db-inspector.js
 *
 * 仕様書の確認方式「ブラウザ手動確認（DevTools > Application > IndexedDB で状態確認）」を
 * Playwright上で再現するヘルパー。DevToolsのUIをキャプチャする代わりに、
 * ブラウザコンテキスト内で indexedDB API を直接叩いて全ストアの中身を取得する。
 * → 目視のDevTools確認と同じ情報（各ストアの全レコード）をJSON/スクリーンショットの両方で残せる。
 *
 * 対象DB名: GanttForgeDB（仕様書 6.テスト実施手順 より）
 * 既知のストア: projects / schedules / tasks / issues / comments / memos / quickmemos /
 *              snapshots / changelog （表紙・仕様に記載の8+1ストア。実装確認後に調整すること）
 */

const DB_NAME = 'GanttForgeDB';

/**
 * ブラウザコンテキスト内で実行する関数。page.evaluate に渡す。
 * @param {string} dbName
 * @returns {Promise<Record<string, any[]>>} ストア名 -> 全レコード配列
 */
async function dumpIndexedDBInPage(dbName) {
  return await new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);
    openReq.onerror = () => reject(new Error(`IndexedDB open failed: ${dbName}`));
    openReq.onsuccess = () => {
      const db = openReq.result;
      const storeNames = Array.from(db.objectStoreNames);
      if (storeNames.length === 0) {
        resolve({});
        return;
      }
      const tx = db.transaction(storeNames, 'readonly');
      const result = {};
      let remaining = storeNames.length;

      storeNames.forEach((storeName) => {
        const store = tx.objectStore(storeName);
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          result[storeName] = getAllReq.result;
          remaining -= 1;
          if (remaining === 0) resolve(result);
        };
        getAllReq.onerror = () => reject(new Error(`getAll failed for store: ${storeName}`));
      });
    };
  });
}

/**
 * ページの現在のIndexedDB全体をダンプする。
 * @param {import('@playwright/test').Page} page
 * @param {string} [dbName]
 * @returns {Promise<Record<string, any[]>>}
 */
async function dumpAllStores(page, dbName = DB_NAME) {
  return page.evaluate(dumpIndexedDBInPage, dbName);
}

/**
 * 特定ストアのみ取得（仕様書の「見たいストア名をクリック」に相当）。
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName
 * @param {string} [dbName]
 */
async function dumpStore(page, storeName, dbName = DB_NAME) {
  const all = await dumpAllStores(page, dbName);
  return all[storeName] ?? [];
}

/**
 * 特定ストアの件数のみ取得（「ログの増減を数える項目」用。操作前後で呼んで差分を取る）。
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName
 * @param {string} [dbName]
 */
async function countStore(page, storeName, dbName = DB_NAME) {
  const records = await dumpStore(page, storeName, dbName);
  return records.length;
}

/**
 * DB状態を「DevToolsキャプチャ」相当の見た目でHTML化し、スクリーンショットとして保存する。
 * 実際のDevTools画面そのものではなく、テーブル表示のHTMLをレンダリングしてキャプチャする。
 * これにより <項目ID>_<連番>_db.png として保存可能な画像を生成する。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} storeNames 表示したいストア名（複数可）
 * @param {string} [dbName]
 */
async function renderDbSnapshotAsHtml(page, storeNames, dbName = DB_NAME) {
  const all = await dumpAllStores(page, dbName);
  const rowsHtml = storeNames
    .map((name) => {
      const records = all[name] ?? [];
      const body = records
        .map(
          (r, i) =>
            `<tr><td>${i}</td><td><pre>${escapeHtml(JSON.stringify(r, null, 2))}</pre></td></tr>`
        )
        .join('');
      return `
        <h3>${name} (${records.length}件)</h3>
        <table border="1" cellspacing="0" cellpadding="4">
          <thead><tr><th>#</th><th>Value</th></tr></thead>
          <tbody>${body}</tbody>
        </table>`;
    })
    .join('<hr/>');

  // 新しいオーバーレイ要素として挿入し、そのままスクリーンショットを撮る運用を想定。
  await page.evaluate((html) => {
    const el = document.createElement('div');
    el.id = '__db_snapshot_overlay__';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;background:#fff;z-index:999999;overflow:auto;padding:16px;font-family:monospace;font-size:12px;';
    el.innerHTML = html;
    document.body.appendChild(el);
  }, rowsHtml);
}

async function removeDbSnapshotOverlay(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__db_snapshot_overlay__');
    if (el) el.remove();
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  DB_NAME,
  dumpAllStores,
  dumpStore,
  countStore,
  renderDbSnapshotAsHtml,
  removeDbSnapshotOverlay,
};
