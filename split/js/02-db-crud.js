    // ===== projects ストアのCRUD =====

    // projects の操作対象ストア名。ストア名の打ち間違いを1箇所に閉じ込める
    // （STORE_DEFINITIONS 内の "projects" と同じ値を指す）。
    const STORE_PROJECTS = "projects";

    // 【前提】project は id を含む1件分のプロジェクトオブジェクト（id は呼び出し側で採番済み）。
    //   この関数では id 採番・入力バリデーションは行わない（1関数1責務。採番は別工程の共通関数の責務）。
    // 【処理】読み書きトランザクションで projects ストアに put する。
    //   put を使う理由：「同じidがあれば上書き、なければ新規」なので、将来のインポートや
    //   「戻す」機能でも同じ関数を再利用でき、追加と復元を1つの経路にまとめられるため。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addProject(project) {
      const db = await getDB();
      const transaction = db.transaction(STORE_PROJECTS, "readwrite");
      const store = transaction.objectStore(STORE_PROJECTS);
      return promisifyRequest(store.put(project), transaction);
    }

    // 【前提】projects ストアが存在すること。
    // 【処理】読み取りトランザクションで全プロジェクトを取得する。
    //   projects はインデックスを持たない設計（データモデル設計3.1節）のため、絞り込みではなく
    //   常に getAll で全件を取る（プロジェクト選択ドロップダウンは常に全件表示するため）。
    // 【結果】プロジェクトの配列を resolve する（0件なら空配列）。
    async function getAllProjects() {
      const db = await getDB();
      const transaction = db.transaction(STORE_PROJECTS, "readonly");
      const store = transaction.objectStore(STORE_PROJECTS);
      return promisifyRequest(store.getAll(), transaction);
    }

    // 【前提】projectId は削除したいプロジェクトの id。
    // 【処理】読み書きトランザクションで projects ストアから該当1件を削除する。
    //   ※配下データ（schedules 等）の連鎖削除はここでは行わない（別工程。データモデル設計6章の方針）。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_PROJECTS, "readwrite");
      const store = transaction.objectStore(STORE_PROJECTS);
      return promisifyRequest(store.delete(projectId), transaction);
    }

    // ===== schedules ストアのCRUD =====

    // schedules の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の schedules 定義と同じ値を指す）。
    const STORE_SCHEDULES = "schedules";
    const INDEX_SCHEDULES_BY_PROJECT = "by_projectId";
    const INDEX_SCHEDULES_BY_PARENT = "by_parentId";

    // 【前提】schedule は id を含む1件分のスケジュールオブジェクト（id は呼び出し側で採番済み）。
    //   日付の整合（endDate < startDate はエラー）などのバリデーションはここでは行わない
    //   （データモデル設計6章：バリデーションはフォーム送信層の責務。addProject と一貫させる）。
    // 【処理】読み書きトランザクションで schedules ストアに put する（upsert。理由は addProject と同じ）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addSchedule(schedule) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SCHEDULES, "readwrite");
      const store = transaction.objectStore(STORE_SCHEDULES);
      return promisifyRequest(store.put(schedule), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトに属するスケジュールを全て取得する
    //   （プロジェクト切替のたびに一覧を取り直すため）。
    // 【結果】スケジュールの配列を resolve する（0件なら空配列）。ルート行・子行の区別はせず全行を返す。
    //   ※「ルート行だけ欲しい」場合は、この結果をアプリ層で parentId === null で絞る。
    //     ルート行は parentId が null のため by_parentId インデックスには載らず、インデックスでは取れないため。
    async function getSchedulesByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SCHEDULES, "readonly");
      const index = transaction.objectStore(STORE_SCHEDULES).index(INDEX_SCHEDULES_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】parentId は「具体的な親スケジュールの id」であること。
    //   null / undefined を渡してはいけない：getAll に null を渡すと「キー指定なし＝全件」と解釈され、
    //   インデックス上の全子行が返ってしまう（ルート行だけが返るわけではない）。呼び出し側で保証する。
    // 【処理】by_parentId インデックスを使い、その親の直下の子スケジュールを全て取得する
    //   （階層表示や、子の日付から親の期間を再計算する処理の入力として使う）。
    // 【結果】子スケジュールの配列を resolve する（子がなければ空配列）。
    //   ※ルート行（parentId: null）はこのインデックスに載らないため、この関数では取得できない。
    //     ルート行はプロジェクト単位で取ってアプリ層で絞る（getSchedulesByProject のコメント参照）。
    async function getChildSchedules(parentId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SCHEDULES, "readonly");
      const index = transaction.objectStore(STORE_SCHEDULES).index(INDEX_SCHEDULES_BY_PARENT);
      return promisifyRequest(index.getAll(parentId), transaction);
    }

    // 【前提】scheduleId は削除したいスケジュールの id。
    // 【処理】schedules ストアから該当1件“だけ”を削除する低レベル部品。
    //   ※アプリの「スケジュール削除」操作は、仕様上この1件では終わらない：
    //     親を消すと子・孫も再帰削除し、紐づくコメントも削除し、祖先の日付を再計算する
    //     （基本設計書 L155-157・L200 / シーケンス図集「3. 親スケジュール削除」）。
    //     これは schedules / comments / changelog にまたがるため、子孫idを先に集めてから書き込む
    //     上位操作として別に実装し、この関数はその部品として使う（データモデル設計6章：読み切ってから書く）。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteSchedule(scheduleId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SCHEDULES, "readwrite");
      const store = transaction.objectStore(STORE_SCHEDULES);
      return promisifyRequest(store.delete(scheduleId), transaction);
    }

    // 【前提】なし（プロジェクトによる絞り込みを行わない）。
    // 【処理】schedules ストアの全件を取得する（H1データエクスポート専用。
    //   既存の getSchedulesByProject はプロジェクト単位の絞り込み用のため、
    //   全プロジェクト分をまとめるバックアップ出力には使えない。getAllProjects と同じ考え方）。
    // 【結果】スケジュールの配列を resolve する（0件なら空配列）。
    async function getAllSchedules() {
      const db = await getDB();
      const transaction = db.transaction(STORE_SCHEDULES, "readonly");
      const store = transaction.objectStore(STORE_SCHEDULES);
      return promisifyRequest(store.getAll(), transaction);
    }

    // ===== tasks ストア（カンバン）のCRUD =====

    // tasks の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の tasks 定義と同じ値を指す）。
    const STORE_TASKS = "tasks";
    const INDEX_TASKS_BY_PROJECT = "by_projectId";

    // 【前提】task は id を含む1件分のタスクオブジェクト（id は呼び出し側で採番済み）。
    //   done（完了フラグ）と status（カンバン列）の同期は、ここでは検証・補正しない
    //   （データモデル設計6章：整合性チェックは保存前のアプリケーション層＝フォーム送信処理の責務。
    //   addProject / addSchedule と同様、この関数は「渡された内容をそのままputする」役割に徹する）。
    // 【処理】読み書きトランザクションで tasks ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addTask(task) {
      const db = await getDB();
      const transaction = db.transaction(STORE_TASKS, "readwrite");
      const store = transaction.objectStore(STORE_TASKS);
      return promisifyRequest(store.put(task), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトに属するタスクを全て取得する
    //   （タスク管理パネル＝カンバンはプロジェクトごとに開くため）。
    // 【結果】タスクの配列を resolve する（0件なら空配列）。カンバン列ごとの振り分けは呼び出し側の責務。
    async function getTasksByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_TASKS, "readonly");
      const index = transaction.objectStore(STORE_TASKS).index(INDEX_TASKS_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】taskId は削除したいタスクの id。
    // 【処理】読み書きトランザクションで tasks ストアから該当1件を削除する。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteTask(taskId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_TASKS, "readwrite");
      const store = transaction.objectStore(STORE_TASKS);
      return promisifyRequest(store.delete(taskId), transaction);
    }

    // 【前提】なし（プロジェクトによる絞り込みを行わない）。
    // 【処理】tasks ストアの全件を取得する（H1データエクスポート専用。getAllSchedules と同じ理由）。
    // 【結果】タスクの配列を resolve する（0件なら空配列）。
    async function getAllTasks() {
      const db = await getDB();
      const transaction = db.transaction(STORE_TASKS, "readonly");
      const store = transaction.objectStore(STORE_TASKS);
      return promisifyRequest(store.getAll(), transaction);
    }

    // ===== comments ストアのCRUD =====

    // comments の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の comments 定義と同じ値を指す）。
    const STORE_COMMENTS = "comments";
    const INDEX_COMMENTS_BY_TASK = "by_taskId";

    // 【前提】comment は id を含む1件分のコメントオブジェクト（id は呼び出し側で採番済み）。
    //   comments は projectId を持たない設計（taskId → schedules.projectId で辿るため。
    //   データモデル設計3.5節：正規化の観点で重複保持しない）。
    // 【処理】読み書きトランザクションで comments ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addComment(comment) {
      const db = await getDB();
      const transaction = db.transaction(STORE_COMMENTS, "readwrite");
      const store = transaction.objectStore(STORE_COMMENTS);
      return promisifyRequest(store.put(comment), transaction);
    }

    // 【前提】taskId は絞り込みたいスケジュールの id（schedules.id を指す）。
    // 【処理】by_taskId インデックスを使い、そのスケジュールに紐づくコメントを全て取得する。
    // 【結果】コメントの配列を resolve する（0件なら空配列）。
    //   ※「プロジェクト単位のコメント一覧」はこの関数だけでは作れない（comments はprojectIdを
    //     持たないため）。データモデル設計3.5節の方針どおり、呼び出し側が
    //     getSchedulesByProject でスケジュールID集合を先に取得し、その各IDについてこの関数を
    //     呼んで束ねる（複数ストアをまたぐ合成処理のため、この関数の責務には含めない）。
    async function getCommentsByTask(taskId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_COMMENTS, "readonly");
      const index = transaction.objectStore(STORE_COMMENTS).index(INDEX_COMMENTS_BY_TASK);
      return promisifyRequest(index.getAll(taskId), transaction);
    }

    // 【前提】commentId は削除したいコメントの id。
    // 【処理】comments ストアから該当1件“だけ”を削除する低レベル部品。
    //   ※スケジュール削除時にそのスケジュールへのコメントも連鎖削除する仕様（基本設計書L156）が
    //   あるが、それは deleteSchedule 側の複合削除操作からこの関数を呼ぶ形で後日実装する
    //   （データモデル設計6章：複数ストアにまたがる書き込みは読み切ってから行う方針）。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteComment(commentId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_COMMENTS, "readwrite");
      const store = transaction.objectStore(STORE_COMMENTS);
      return promisifyRequest(store.delete(commentId), transaction);
    }

    // 【前提】なし（taskIdによる絞り込みを行わない）。
    // 【処理】comments ストアの全件を取得する（H1データエクスポート専用。comments は projectId を
    //   持たないため、プロジェクト単位で束ねる既存の合成処理は使えず、ストア全体を直接取得する）。
    // 【結果】コメントの配列を resolve する（0件なら空配列）。
    async function getAllComments() {
      const db = await getDB();
      const transaction = db.transaction(STORE_COMMENTS, "readonly");
      const store = transaction.objectStore(STORE_COMMENTS);
      return promisifyRequest(store.getAll(), transaction);
    }

    // ===== changelog ストア（変更履歴）のCRUD =====

    // changelog の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の changelog 定義と同じ値を指す）。
    const STORE_CHANGELOG = "changelog";
    const INDEX_CHANGELOG_BY_PROJECT = "by_projectId";

    // 【前提】entry は id を含む1件分の変更履歴オブジェクト（id は呼び出し側で採番済み）。
    //   action/store/changes/snapshot 等の組み立て（何がどう変わったかの判定）はここでは行わない
    //   （データモデル設計6章と同じ考え方：ログ内容の組み立ては、各CRUD操作を呼ぶ上位処理の責務。
    //   この関数は組み立て済みの entry をそのまま保存するだけの部品）。
    // 【処理】読み書きトランザクションで changelog ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addChangelogEntry(entry) {
      const db = await getDB();
      const transaction = db.transaction(STORE_CHANGELOG, "readwrite");
      const store = transaction.objectStore(STORE_CHANGELOG);
      return promisifyRequest(store.put(entry), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id（未選択時の操作は "global" という文字列）。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトの変更履歴を全て取得する
    //   （変更履歴パネルはプロジェクトごとに表示するため）。"global" も他のprojectIdと同じ扱いで、
    //   特別扱いの関数は用意しない。
    // 【結果】変更履歴の配列を resolve する（0件なら空配列）。
    async function getChangelogByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_CHANGELOG, "readonly");
      const index = transaction.objectStore(STORE_CHANGELOG).index(INDEX_CHANGELOG_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】projectId は削除対象を絞り込むプロジェクトの id。
    //   このアプリには変更履歴の「個別削除」機能はなく、「履歴の全削除」ボタンのみが存在する
    //   （詳細設計書3.6.3節`clearChangelog`）。そのためこの関数は1件削除ではなく、
    //   指定プロジェクトの変更履歴を丸ごと削除する仕様にする。
    // 【なぜ promisifyRequest を使わないのか】このヘルパーは「1トランザクションにつき
    //   transaction.oncomplete を1回だけ設定する」前提で作られている。複数件のdeleteをそのつど
    //   promisifyRequest に渡すと、同じトランザクションの oncomplete ハンドラを毎回上書きしてしまい、
    //   最後の1件以外は永久に resolve されなくなる。そのため、この関数だけは
    //   「1トランザクション・複数delete・oncompleteは1回だけ」を自分で組み立てる。
    // 【処理】1つの読み書きトランザクションの中で、対象プロジェクトの全キーを取得し、
    //   それぞれに delete を発行してから、トランザクション全体の完了を待つ。
    // 【結果】コミット完了後に resolve する（対象が0件でも正常に完了する）。
    function clearChangelogByProject(projectId) {
      return getDB().then((db) => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_CHANGELOG, "readwrite");
          const store = transaction.objectStore(STORE_CHANGELOG);
          const index = store.index(INDEX_CHANGELOG_BY_PROJECT);
          const getKeysRequest = index.getAllKeys(projectId);

          getKeysRequest.onsuccess = () => {
            for (const key of getKeysRequest.result) {
              store.delete(key);
            }
          };
          getKeysRequest.onerror = () => reject(getKeysRequest.error);

          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        });
      });
    }

    // ===== issues ストア（マインドマップ）のCRUD =====

    // issues の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の issues 定義と同じ値を指す）。
    const STORE_ISSUES = "issues";
    const INDEX_ISSUES_BY_PROJECT = "by_projectId";

    // 【前提】issue は id を含む1件分のノードオブジェクト（id は呼び出し側で採番済み）。
    // 【処理】読み書きトランザクションで issues ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addIssue(issue) {
      const db = await getDB();
      const transaction = db.transaction(STORE_ISSUES, "readwrite");
      const store = transaction.objectStore(STORE_ISSUES);
      return promisifyRequest(store.put(issue), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトの全ノードを取得する
    //   （マインドマップパネルを開いたプロジェクトのノードのみ表示するため）。
    // 【結果】ノードの配列を resolve する（0件なら空配列）。親子どちらのノードも区別せず全件返す。
    //   ※「特定ノードの子だけ」が欲しい場合は、issues には parentNodeId のインデックスが無いため
    //     （データモデル設計3.4節）、この結果をアプリ層で parentNodeId 一致でフィルタする。
    async function getIssuesByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_ISSUES, "readonly");
      const index = transaction.objectStore(STORE_ISSUES).index(INDEX_ISSUES_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】issueId は削除したいノードの id。
    // 【処理】issues ストアから該当1件“だけ”を削除する低レベル部品。
    //   ※マインドマップのノード削除は、仕様上「対象ノード＋子孫ノードを再帰的に収集して削除」する
    //   （詳細設計書3.5.3節。deleteSchedule と同じ考え方）。子孫の収集・一括削除は
    //   この関数の責務に含めず、別工程の複合操作から呼び出す部品として使う。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteIssue(issueId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_ISSUES, "readwrite");
      const store = transaction.objectStore(STORE_ISSUES);
      return promisifyRequest(store.delete(issueId), transaction);
    }

    // 【前提】なし（プロジェクトによる絞り込みを行わない）。
    // 【処理】issues ストアの全件を取得する（H1データエクスポート専用。getAllSchedules と同じ理由）。
    // 【結果】ノードの配列を resolve する（0件なら空配列）。
    async function getAllIssues() {
      const db = await getDB();
      const transaction = db.transaction(STORE_ISSUES, "readonly");
      const store = transaction.objectStore(STORE_ISSUES);
      return promisifyRequest(store.getAll(), transaction);
    }

    // ===== memos ストアのCRUD =====

    // memos の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の memos 定義と同じ値を指す）。
    const STORE_MEMOS = "memos";
    const INDEX_MEMOS_BY_PROJECT = "by_projectId";

    // 【前提】memo は id を含む1件分のメモオブジェクト（id は呼び出し側で採番済み）。
    //   createdAt/updatedAt の発行・更新はここでは行わない（他の add* 関数と同様、
    //   渡された内容をそのままputするだけ。日時の発行は自動保存処理側の責務）。
    // 【処理】読み書きトランザクションで memos ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addMemo(memo) {
      const db = await getDB();
      const transaction = db.transaction(STORE_MEMOS, "readwrite");
      const store = transaction.objectStore(STORE_MEMOS);
      return promisifyRequest(store.put(memo), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトのメモを全て取得する
    //   （メモパネルはプロジェクトごとに一覧を切り替えるため）。
    // 【結果】メモの配列を resolve する（0件なら空配列）。
    async function getMemosByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_MEMOS, "readonly");
      const index = transaction.objectStore(STORE_MEMOS).index(INDEX_MEMOS_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】memoId は削除したいメモの id。
    // 【処理】読み書きトランザクションで memos ストアから該当1件を削除する
    //   （詳細設計書3.7.2節：メモは個別削除の仕様。全削除機能は無い）。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteMemo(memoId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_MEMOS, "readwrite");
      const store = transaction.objectStore(STORE_MEMOS);
      return promisifyRequest(store.delete(memoId), transaction);
    }

    // 【前提】なし（プロジェクトによる絞り込みを行わない）。
    // 【処理】memos ストアの全件を取得する（H1データエクスポート専用。getAllSchedules と同じ理由）。
    // 【結果】メモの配列を resolve する（0件なら空配列）。
    async function getAllMemos() {
      const db = await getDB();
      const transaction = db.transaction(STORE_MEMOS, "readonly");
      const store = transaction.objectStore(STORE_MEMOS);
      return promisifyRequest(store.getAll(), transaction);
    }

    // ===== quickmemos ストア（即時メモ）のCRUD =====

    // quickmemos の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の quickmemos 定義と同じ値を指す）。
    const STORE_QUICKMEMOS = "quickmemos";
    const INDEX_QUICKMEMOS_BY_PROJECT = "by_projectId";

    // 【前提】quickMemo は id を含む1件分の即時メモオブジェクト（id は呼び出し側で採番済み）。
    // 【処理】読み書きトランザクションで quickmemos ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addQuickMemo(quickMemo) {
      const db = await getDB();
      const transaction = db.transaction(STORE_QUICKMEMOS, "readwrite");
      const store = transaction.objectStore(STORE_QUICKMEMOS);
      return promisifyRequest(store.put(quickMemo), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトの即時メモを全て取得する
    //   （即時メモはプロジェクトごとの時系列タイムラインのため）。
    // 【結果】即時メモの配列を resolve する（0件なら空配列）。
    async function getQuickMemosByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_QUICKMEMOS, "readonly");
      const index = transaction.objectStore(STORE_QUICKMEMOS).index(INDEX_QUICKMEMOS_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】quickMemoId は削除したい即時メモの id。
    // 【処理】読み書きトランザクションで quickmemos ストアから該当1件を削除する
    //   （即時メモには個別削除・全削除の両方の機能がある。これは個別削除の方）。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    async function deleteQuickMemo(quickMemoId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_QUICKMEMOS, "readwrite");
      const store = transaction.objectStore(STORE_QUICKMEMOS);
      return promisifyRequest(store.delete(quickMemoId), transaction);
    }

    // 【前提】projectId は削除対象を絞り込むプロジェクトの id。
    //   即時メモには個別削除（deleteQuickMemo）に加えて全削除の機能もある
    //   （詳細設計書3.8.2節`clearQuickMemos`）。この関数はその全削除の方。
    // 【なぜ promisifyRequest を使わないのか】clearChangelogByProject と同じ理由：
    //   1トランザクション内で複数件のdeleteを発行するため、transaction.oncomplete の
    //   多重代入を避けるには、このヘルパーを流用せず専用のPromiseを組む必要がある。
    // 【処理】1つの読み書きトランザクションの中で、対象プロジェクトの全キーを取得し、
    //   それぞれに delete を発行してから、トランザクション全体の完了を待つ。
    // 【結果】コミット完了後に resolve する（対象が0件でも正常に完了する）。
    function clearQuickMemosByProject(projectId) {
      return getDB().then((db) => {
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_QUICKMEMOS, "readwrite");
          const store = transaction.objectStore(STORE_QUICKMEMOS);
          const index = store.index(INDEX_QUICKMEMOS_BY_PROJECT);
          const getKeysRequest = index.getAllKeys(projectId);

          getKeysRequest.onsuccess = () => {
            for (const key of getKeysRequest.result) {
              store.delete(key);
            }
          };
          getKeysRequest.onerror = () => reject(getKeysRequest.error);

          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
        });
      });
    }

    // 【前提】なし（プロジェクトによる絞り込みを行わない）。
    // 【処理】quickmemos ストアの全件を取得する（H1データエクスポート専用。getAllSchedules と同じ理由）。
    // 【結果】即時メモの配列を resolve する（0件なら空配列）。
    async function getAllQuickMemos() {
      const db = await getDB();
      const transaction = db.transaction(STORE_QUICKMEMOS, "readonly");
      const store = transaction.objectStore(STORE_QUICKMEMOS);
      return promisifyRequest(store.getAll(), transaction);
    }

    // ===== snapshots ストアのCRUD =====

    // snapshots の操作対象ストア名・インデックス名。名前の打ち間違いを1箇所に閉じ込める
    // （いずれも STORE_DEFINITIONS の snapshots 定義と同じ値を指す）。
    const STORE_SNAPSHOTS = "snapshots";
    const INDEX_SNAPSHOTS_BY_PROJECT = "by_projectId";

    // 【前提】snapshot は id を含む1件分のスナップショットオブジェクト（id は呼び出し側で採番済み）。
    //   data フィールド（{project, schedules}）はネストしたオブジェクトだが、IndexedDBの
    //   構造化複製アルゴリズムでそのまま保存できるため、ここでは特別な変換をせず丸ごとputする。
    // 【処理】読み書きトランザクションで snapshots ストアに put する（upsert）。
    // 【結果】コミット完了後に resolve する（＝保存が確定したことを保証）。
    async function addSnapshot(snapshot) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SNAPSHOTS, "readwrite");
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      return promisifyRequest(store.put(snapshot), transaction);
    }

    // 【前提】projectId は絞り込みたいプロジェクトの id。
    // 【処理】by_projectId インデックスを使い、そのプロジェクトのスナップショットを全て取得する
    //   （スナップショット一覧はプロジェクトごとに表示するため）。
    // 【結果】スナップショットの配列を resolve する（0件なら空配列）。
    async function getSnapshotsByProject(projectId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SNAPSHOTS, "readonly");
      const index = transaction.objectStore(STORE_SNAPSHOTS).index(INDEX_SNAPSHOTS_BY_PROJECT);
      return promisifyRequest(index.getAll(projectId), transaction);
    }

    // 【前提】snapshotId は削除したいスナップショットの id。
    // 【処理】読み書きトランザクションで snapshots ストアから該当1件を削除する
    //   （詳細設計書3.8.3節：スナップショットは個別削除の仕様）。
    // 【結果】コミット完了後に resolve する（対象が存在しなくても delete はエラーにならない＝冪等）。
    //   ※「復元」機能（現在のスケジュールを全削除→書き戻し）はここでは扱わない。
    //   変更履歴に記録しない低レベルAPIを使う特殊な複合操作のため、別工程で実装する（3.6.1節）。
    async function deleteSnapshot(snapshotId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SNAPSHOTS, "readwrite");
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      return promisifyRequest(store.delete(snapshotId), transaction);
    }

    // 【前提】なし（プロジェクトによる絞り込みを行わない）。
    // 【処理】snapshots ストアの全件を取得する（H1データエクスポート専用。getAllSchedules と同じ理由）。
    // 【結果】スナップショットの配列を resolve する（0件なら空配列）。
    async function getAllSnapshots() {
      const db = await getDB();
      const transaction = db.transaction(STORE_SNAPSHOTS, "readonly");
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      return promisifyRequest(store.getAll(), transaction);
    }

