# プロジェクト概要

このプロジェクトは、IndexedDBを使ったブラウザ完結型のWebアプリを作る研修課題。
お手本として `ganttforge.html`（単一HTML・ビルドツール不使用・CDN経由ライブラリのみ）の構成を参考にする。

作成者（私）はエンジニア歴が浅く、数学の証明問題やパズルを好む。
そのため「筋道が一本に通っていて、読めば理由がわかるコード」を最優先する。
スピードよりも「レビューする本人が自信を持って読める」ことを優先すること。

---

# 技術方針

- 単一HTMLファイルで完結させる（`index.html` 1ファイル、または資料と同じ構成）
- ビルドツール・フレームワーク（React, Vue等）は使用しない
- 外部ライブラリはCDN経由でのみ利用可（例：XLSX.js, jsPDF等。ganttforge.htmlの構成を参考にしてよい）
- データの永続化は IndexedDB の生API を使用する
- 非同期処理は Promise でラップし、async/await で書く（コールバック直書き禁止）
- IndexedDBのトランザクション内で、他の非同期処理（fetchなど）を待たない

---

# 命名規約（最重要・レビュアーの理解を最優先）

- 変数名・関数名は「役割が一目でわかる」名前にする
  - 悪い例：`s`, `sd`, `ed`, `t`, `arr2`
  - 良い例：`taskStartDate`, `taskEndDate`, `taskList`, `filteredTasks`
- **似ている名前を同時に使わない**（名前が似ていて、何がどう違うのか名前だけでは区別できない状態が典型的な悪い例）
  - 悪い例：
    ```js
    const user = getCurrentUser();
    const userData = getUserData();
    // → user と userData、何が違う？ user にも name や email は入っていそうなのに、
    //   userData だけ別に用意する理由が名前からは全く読み取れない
    ```
  - 良い例：役割の違いが伝わる名前にする
    ```js
    const currentUser = getCurrentUser();       // ログイン中のユーザー情報（表示用）
    const userProfileForm = getUserProfileForm(); // 編集フォームに入力中の値
    ```
  - 似た概念で区別が必要な場合は、`s`をつけて誤魔化さず、役割の違いが伝わる接頭語・接尾語で明確に分ける（例：`beforeUpdateTask` / `afterUpdateTask`）
- 省略語は基本的に使わない（`btn`より`button`、`idx`より`index`など。ただしDOMのid属性名など固有の慣習がある場合は例外可）

---

# コメント方針（レビューを自信を持って行うための最重要ルール）

数学の証明のように「前提 → 処理 → 結論」が読み取れるようにコメントを書く。

- 関数の直前に「この関数が何を保証するか（前提と結果）」を日本語で一行以上書く
- 複雑な処理の直前に「なぜこう書くのか（設計判断の理由）」を書く
- 単に「何をしているか」を書くだけのコメント（コードを読めばわかること）は不要
- 例：
```js
// 【前提】タスクは必ず startDate <= endDate を満たす（呼び出し前にバリデーション済み）
// 【処理】開始日から終了日までの日数を計算し、ガントバーの幅に変換する
function calculateBarWidth(taskStartDate, taskEndDate) {
  ...
}
```

---

# UI方針

- ganttforge.htmlのUI構成（配色・レイアウト）を参考にしてよい
- UI表示文言は日本語、変数・関数名は英語（ganttforge.htmlの慣習を継承）

---

# 関連ファイル

- コーディング・ワークフローの詳細ルール → `RULES.md`
- 作業別の手順テンプレート → `Skills/` フォルダ配下
