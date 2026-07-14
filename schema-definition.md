# Skill: スキーマ定義

## いつ使うか
data-design.mdで決めた設計を、実際のコード（openDB部分）にするとき

## AIへの依頼テンプレート
```
以下の設計をもとに、IndexedDBを開く処理（openDB、onupgradeneededを含む）を書いて。

【設計内容】
（data-design.mdで決まった内容を貼る）

【厳守してほしいこと】
- CLAUDE.mdの命名規約に沿った変数名にする
- 各処理の前に「前提・処理内容」を日本語コメントで書く
- バージョン管理（onupgradeneededでの分岐）がある場合は、その理由もコメントで書く
```

## 確認すること（レビューポイント）
- `onupgradeneeded` の中で何をしているか、コメントを読んで理解できるか
- ストア名・keyPathがdata-design.mdの決定内容と一致しているか
- エラー処理（onerror等）があるか

## 次のステップ
DBが開けることを確認したら `crud-implementation.md` に進む
