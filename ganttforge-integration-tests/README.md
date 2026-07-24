# GanttForge再現アプリ 結合試験 自動化ハーネス

対象: `GanttForge再現課題_結合試験_仕様書実施項目書ｖ1_5.xlsx`（234項目）
方式: Playwright（Chromium）+ IndexedDB直接検証 + xlsx書き戻し

このディレクトリは、Claude Code（CLI）に渡して自動実行させることを想定した
スキャフォールド（骨組み）です。**index.html の実際のDOM構造が未確定のため、
セレクタ部分はTODOのままになっています。** index.html が用意でき次第、以下の
手順でClaude Codeに仕上げ・実行させてください。

---

## 0. ディレクトリ構成

```
ganttforge-integration-tests/
├── spec/
│   ├── original-spec.xlsx      # 元の仕様書（判定・証跡列を後で書き戻す対象）
│   └── test-items.json         # 234項目を構造化抽出したもの（自動生成用の正データ）
├── helpers/
│   ├── db-inspector.js         # IndexedDB全ストアをJSで直接ダンプ（DevTools確認の代替）
│   ├── evidence.js             # 命名規則通りの証跡キャプチャ（画面/DB）
│   ├── results-tracker.js      # 判定結果をresults/test-results.jsonに蓄積
│   └── results-writer.py       # 蓄積結果を元のxlsxに書き戻す
├── tests/
│   └── 01-project-management.spec.js  # ★実装パターンの見本（1カテゴリ分のみ）
├── evidence/                   # 実行時に証跡png が溜まる（<ID>_<連番>_<画面|db>.png）
├── results/                    # 実行時にtest-results.json / raw-results.jsonが溜まる
├── playwright.config.js
└── package.json
```

## 1. 事前準備（Claude Codeに依頼する内容）

1. `index.html`（参照実装コミット）をこのディレクトリ直下、またはローカルサーバで配信できる場所に配置する。
2. `npm install` で Playwright をインストールし、`npx playwright install chromium` でブラウザ本体を取得する。
3. 実行方式を決める（仕様書 5.テスト環境 で「記入」となっている箇所）:
   - `file://` で直接開く場合 → `playwright.config.js` の `baseURL` 不要、各テストで `page.goto('file:///絶対パス/index.html')`
   - ローカルサーバの場合 → 例 `npx http-server . -p 8080` を裏で立ち上げ、`TARGET_URL=http://localhost:8080/index.html` で実行

## 2. Claude Codeへの依頼手順（推奨プロンプト例）

index.html を用意した後、Claude Codeに次のように依頼してください:

> `ganttforge-integration-tests/` 配下の `tests/01-project-management.spec.js` は
> 実装パターンの見本です。同じディレクトリの `spec/test-items.json` にある234項目
> （`spec/original-spec.xlsx` の「テスト項目一覧」シートを構造化したもの）を元に、
> `index.html` の実際のDOM構造を調査した上で、大項目02〜14についても同じパターンで
> Playwrightテストを生成してください。各テストは以下を必ず行うこと:
>   - 前提条件（test-items.jsonの`前提条件`）をbeforeEach等で再現する
>   - 操作手順（`操作手順`）を実際のUI操作に変換する
>   - 期待値結果（`期待値結果`）をexpect()でアサーションする
>   - 観点区分（`観点区分`）に応じて `helpers/evidence.js` で証跡を保存する
>       【表示】【非表示】【遷移】→ captureScreen
>       【DB】                  → captureDbSnapshot（対象ストア列を渡す）
>       【履歴】                → changelogストアの差分を確認しつつcaptureScreen
>       【データ出力】          → ダウンロードイベントを検証
>   - 最後に `recordResult()` で判定を記録する
> 実装したら `npx playwright test` を実行し、失敗したテストのエラー内容を
> 確認・修正するループを、全234項目がPASSする（または仕様通りの既知の非整合として
> 判定OKになる）まで繰り返してください。

## 3. 実行

```bash
npm install
npx playwright install chromium
TARGET_URL="file:///絶対パス/index.html" npm test
```

- 実行後、`evidence/` に命名規則通りの証跡png（`<項目ID>_<連番>_<画面|db>.png`）が生成される。
- `results/test-results.json` に各テストIDの判定・証跡ファイル名が蓄積される。
- `playwright-report/` にHTMLレポートが生成される（`npm run report` で閲覧）。

## 4. 仕様書への結果書き戻し

```bash
python3 helpers/results-writer.py \
  --results results/test-results.json \
  --spec spec/original-spec.xlsx \
  --out spec/original-spec_実施済み.xlsx
```

- 「実施日／実施者／判定／証跡／不具合票／備考」列のみを更新し、既存の数式・書式は変更しない。
- 「進捗サマリー」の自動集計（OK/NG/未実施/保留の件数）は判定列を参照する既存数式に
  依存しているため、**書き戻し後にExcelまたはLibreOfficeで一度開いて保存し直す**と数値が更新される。

## 5. NG項目の扱い

仕様書 8.不具合報告フロー に準拠し、`judgement: 'NG'` で記録したテストは
`recordResult()` の `bugTicket` に不具合票番号を付与できるようにしてある。
既知の非整合（仕様書 7.合否判定基準に列挙されているもの: 幽霊レコード、孤立コメント、
非対称バリデーション、reparent旧親の再計算など）はバグと誤判定せず、
期待結果側をその非整合の内容に合わせてOK判定とすること。

## 6. 注意点（仕様書のリスク・注意事項を自動化観点で言い換え）

- IndexedDB一覧は自動更新されない → `dumpAllStores`は毎回`indexedDB.open()`し直すため問題なし。ただし
  UI操作直後は非同期保存が完了する前にダンプしないよう、保存完了トースト等の出現を`await`してからダンプすること。
- 状態依存のテスト（プロジェクト切替・日付伝播・連鎖削除・スナップショット比較）は
  直前の操作結果に依存するため、`test.describe.serial()` を使うか、各テストの
  `前提条件`を明示的にセットアップし直すこと。
- ブラウザはChromium固定（`playwright.config.js`で設定済み）。
