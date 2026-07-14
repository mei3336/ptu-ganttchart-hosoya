# Skill: CRUD実装

## いつ使うか
データの追加・取得・更新・削除の処理を作るとき

## AIへの依頼テンプレート
```
ストア名：〇〇
項目：（例：taskName, isDone, createdAt）

以下の処理をPromiseでラップして、async/awaitで呼び出せる形で書いて。
- 追加（put）
- 全件取得（getAll）
- インデックスを使った絞り込み取得（index.getAll）
- 削除（delete）

【厳守してほしいこと】
- 1つの関数につき1つの処理のみ（例：追加と取得を1関数にまとめない）
- 各関数の前に「前提・処理内容」を日本語コメントで書く
- トランザクション内で他の非同期処理（fetch等）を待たない
```

## 確認すること（レビューポイント）
- 関数名を見るだけで「何をする関数か」わかるか（例：`addTask`, `getAllTasks`, `getTasksByStatus`, `deleteTask`）
- 1関数1責務になっているか
- Promiseの`resolve`/`reject`が適切な場所で呼ばれているか

## 次のステップ
CRUDが動いたら `async-conversion.md`（すでにPromise化されていれば不要）→ UIとの結合へ
