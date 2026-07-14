# Skills フォルダについて

工程ごとに「AIへの依頼テンプレート」を分けている。
「〇〇して」と頼むとき、対応するSkillファイルの内容を参照してAIに作業させる。

| ファイル | 対応する工程 |
|---|---|
| data-design.md | データモデル設計（保存したいデータを言葉で説明→ストア構成を提案させる） |
| schema-definition.md | スキーマ定義（openDB, onupgradeneeded） |
| crud-implementation.md | CRUD実装（put/getAll/index.getAll/delete） |
| async-conversion.md | 非同期化（コールバック→Promise/async-await） |
| debugging.md | デバッグ（エラーの原因調査・修正方針） |
| review-procedure.md | エンジニア初心者によるレビュー手順 |
