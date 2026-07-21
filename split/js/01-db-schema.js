    "use strict";

    // ===== IndexedDB 定数 =====
    // DB名・バージョンは1箇所で管理する（複数箇所に散らして修正漏れが起きるのを防ぐ）。
    const DATABASE_NAME = "GanttForgeDB";
    // バージョン1：初版。全9ストアと全インデックスをこのバージョンで一括作成する。
    const DATABASE_VERSION = 1;

    // 全ストア共通の主キー。データモデル設計.md 1章の方針により、ID発行はアプリ側で行う
    // （autoIncrementは使わない）ため、keyPath は全ストアで常に "id" に固定する。
    const PRIMARY_KEY_PATH = "id";

    // ===== ストア定義 =====
    // 【この配列の意味】keyPath は全ストア共通（PRIMARY_KEY_PATH="id"）なので、
    //   ここでは「ストア名」と「そのストアに張るインデックス」だけを宣言する。
    // 【レビュー方法】この配列を データモデル設計.md 4章（インデックス設計一覧）と
    //   上から1対1で突き合わせれば、定義の過不足・値の相違を目視確認できる。
    //   indexName / keyPath / unique は 4章の表の値をそのまま写している。
    const STORE_DEFINITIONS = [
      // projects：プロジェクト選択は常に全件取得（getAll）のため、絞り込み用インデックスは不要。
      { name: "projects", indexes: [] },

      // schedules：プロジェクト切替時の一覧取得(projectId)と、
      //   階層構造での子取得・親日付の再計算(parentId)の2つで絞り込む。
      { name: "schedules", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
        { indexName: "by_parentId",  keyPath: "parentId",  unique: false },
      ] },

      // tasks：カンバン（タスク管理パネル）はプロジェクトごとに開くため projectId で絞り込む。
      { name: "tasks", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
      ] },

      // issues：マインドマップパネルはプロジェクトごとに開くため projectId で絞り込む。
      { name: "issues", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
      ] },

      // comments：projectId を持たず、紐づくスケジュールID(taskId)で絞り込む
      //   （所属プロジェクトは schedules.projectId 経由で辿るため重複保持しない）。
      { name: "comments", indexes: [
        { indexName: "by_taskId", keyPath: "taskId", unique: false },
      ] },

      // memos：メモ一覧はプロジェクトを切り替えると切り替わるため projectId で絞り込む。
      { name: "memos", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
      ] },

      // quickmemos：即時メモはプロジェクト別のタイムラインのため projectId で絞り込む。
      { name: "quickmemos", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
      ] },

      // snapshots：スナップショット一覧はプロジェクトごとに表示するため projectId で絞り込む。
      { name: "snapshots", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
      ] },

      // changelog：変更履歴はプロジェクトごとに表示する（未選択時は projectId:"global"）ため
      //   projectId で絞り込む。
      { name: "changelog", indexes: [
        { indexName: "by_projectId", keyPath: "projectId", unique: false },
      ] },
    ];

    // 【前提】storeDefinition は STORE_DEFINITIONS の1要素（name と indexes を持つ）であること。
    //   また、この関数は onupgradeneeded（アップグレード用トランザクション）内でのみ呼ぶこと。
    //   IndexedDBの仕様上、createObjectStore / createIndex はこのタイミングでしか実行できない。
    // 【処理】1ストア分の定義から、オブジェクトストアを作成し、そのストアに属する
    //   インデックスをすべて張る。
    // 【結果】db 上に storeDefinition.name のストアと、指定インデックスが作成されていることを保証する。
    function createStore(db, storeDefinition) {
      const objectStore = db.createObjectStore(storeDefinition.name, { keyPath: PRIMARY_KEY_PATH });
      for (const index of storeDefinition.indexes) {
        objectStore.createIndex(index.indexName, index.keyPath, { unique: index.unique });
      }
    }

    // 【前提】DATABASE_NAME / DATABASE_VERSION / STORE_DEFINITIONS が定義済みであること。
    // 【処理】IndexedDBを開き、必要ならスキーマ（ストア・インデックス）を作成する。
    //   indexedDB.open のイベントコールバックを Promise に橋渡しし、
    //   呼び出し側が async/await で扱えるようにする（CLAUDE.md：コールバック直書き禁止）。
    // 【結果】成功時：開いた IDBDatabase を resolve する。
    //         失敗時：発生したエラーを reject する（通知・リトライは呼び出し側の責務）。
    function openDB() {
      return new Promise((resolve, reject) => {
        const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

        // 【処理】DBが存在しない、または既存バージョンが DATABASE_VERSION より古いときだけ呼ばれる。
        //   ここでスキーマを作成する（この中では他の非同期処理を待たない＝同期的に作成のみ行う）。
        // 【なぜ oldVersion で分岐するのか】将来バージョンを2,3と上げたとき、この下に
        //   `if (oldVersion < 2) { ... }` を追記するだけで、途中バージョンのユーザーのDBも
        //   順番に積み上げてアップグレードできる構造にするため。
        //   初版の今は「oldVersion < 1」（＝まっさらな新規作成）の分岐だけを持つ。
        openRequest.onupgradeneeded = (event) => {
          const db = event.target.result;
          const oldVersion = event.oldVersion;

          // バージョン1：全9ストアと全インデックスを作成する。
          if (oldVersion < 1) {
            for (const storeDefinition of STORE_DEFINITIONS) {
              createStore(db, storeDefinition);
            }
          }
        };

        // 【処理】DBが正常に開けたら、その IDBDatabase を返す。
        openRequest.onsuccess = (event) => {
          resolve(event.target.result);
        };

        // 【何が起きたら】DBを開けなかったとき（例：プライベートモードでIndexedDBが無効、
        //   ストレージ容量不足、ユーザーによる許可拒否など）に呼ばれる。
        // 【どう対応するか】ここではエラーを reject するだけに留める。ユーザーへの通知や
        //   リトライは呼び出し側（UI層）の責務とし、この関数は「開く」役割だけに絞る。
        openRequest.onerror = (event) => {
          reject(event.target.error);
        };

        // 【onblocked ハンドラを付けない理由】onblocked は「別タブが古いバージョンのDBを
        //   開いたままでアップグレードできない」ときに発生するが、初版はアップグレード自体が
        //   起きないため発生しない。将来バージョンを上げる際に、ここへハンドラを追加する。
      });
    }

    // ===== DB接続の共通処理 =====

    // 開いたDB接続をキャッシュする変数。操作のたびに openDB() すると接続コストがかかるため、
    // 初回だけ開いて以後は同じ接続を使い回す（初期値 null ＝まだ一度も開いていない）。
    let cachedDatabase = null;

    // 【前提】openDB() が9ストアを持つDBを開けること。
    // 【処理】初回呼び出し時だけ openDB() でDBを開いてキャッシュし、2回目以降は同じ接続を返す。
    // 【結果】開いている IDBDatabase を1つ返すことを保証する（毎回同じインスタンス）。
    async function getDB() {
      if (cachedDatabase === null) {
        cachedDatabase = await openDB();
      }
      return cachedDatabase;
    }

    // 【前提】request は store.put / getAll / delete / index.getAll 等が返した IDBRequest。
    //   transaction は、その request を発行したトランザクション（呼び出し側が保持しているものを渡す）。
    //   （indexedDB.open の要求には使わない。あちらは onupgradeneeded を挟むため openDB 側で個別に扱う）。
    // 【なぜ transaction を引数で受け取るのか】request.transaction から辿る手もあるが、
    //   index.getAll() が返す request では実装によって transaction が取れないことがある（可搬性リスク）。
    //   呼び出し側は必ず自分でトランザクションを作っているので、それを明示的に渡す方が確実で読みやすい。
    // 【処理】IndexedDBのイベントコールバックを Promise に橋渡しする。ここでの設計判断は
    //   「リクエスト成功(onsuccess)」ではなく「トランザクション完了(oncomplete)」で resolve する点。
    //   put/delete は onsuccess の時点ではまだコミット前で、コミット後に初めて保存が確定するため、
    //   commit を待ってから resolve することで「Promiseの解決＝保存済み」を保証する。
    //   取得系(getAll)も同じ仕組みでよく、結果値は onsuccess でいったん控えて oncomplete で返す。
    // 【結果】成功時：request.result を resolve。失敗時：発生したエラーを reject。
    function promisifyRequest(request, transaction) {
      return new Promise((resolve, reject) => {
        let requestResult;
        request.onsuccess = () => { requestResult = request.result; };
        // 【何が起きたら】リクエスト自体が失敗したとき（キー制約違反、値の型不正など）。
        // 【どう対応するか】エラーを reject し、通知やリトライは呼び出し側の責務とする。
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(requestResult);
        // 【何が起きたら】トランザクションが中断(abort)されたとき（commitされず保存が無効になる）。
        // 【どう対応するか】保存が確定していないため、エラーを reject する。
        transaction.onabort = () => reject(transaction.error);
      });
    }

