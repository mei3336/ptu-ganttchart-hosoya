    // ===== 複合操作（複数ストアにまたがる処理）の共通ユーティリティ =====

    // 【前提】呼び出し元は新規レコードのidをまだ持っていないこと。
    // 【処理】タイムスタンプ＋ランダム文字列でidを生成する（データモデル設計1章の方針：
    //   autoIncrementは同一DB内でしか一意性を保証しないため、JSONインポート等で他環境発行の
    //   idと衝突しないよう、アプリ側で一意な文字列idを発行する）。
    //   これまでの各CRUD関数（addProject等）はid採番済みのオブジェクトを受け取る前提にして
    //   いたため、複合操作（連鎖削除のログ記録等）で新規レコードを作る段になって
    //   初めてid発行そのものが必要になった。そのため、ここでこの関数を追加する。
    // 【結果】十分に一意な文字列idを返す。
    function generateId() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    // 変更履歴（changelog）に記録する対象ストア（データモデル設計6章・基本設計書8.1節）。
    // 連鎖削除（deleteScheduleCascade/deleteIssueCascade/deleteProjectCascade）・
    // 追加/変更の自動記録（recordChangelogEntry）の両方が、この定数を根拠に
    // 「このストアの操作はログに残すべきか」を判断する。
    const LOGGED_STORES = ["projects", "schedules", "tasks", "issues"];

    // 【前提】beforeObject は変更前のオブジェクト（新規作成時はnull）。afterObjectは保存後の
    //   オブジェクト。fieldLabelsByKeyは{フィールド名: 表示ラベル}のマップで、比較対象を
    //   明示的に絞り込む（idや並び順など、値が変わっても「ユーザーへの変更履歴」としては
    //   意味を持たないフィールドを比較対象に含めないため）。
    // 【処理】fieldLabelsByKeyに列挙された各フィールドについて、beforeとafterの値を比較し、
    //   異なるものだけを集める。
    // 【結果】[{field, label, before, after}] の配列を返す（1件も変わっていなければ空配列）。
    function diffFields(beforeObject, afterObject, fieldLabelsByKey) {
      const changes = [];
      for (const [field, label] of Object.entries(fieldLabelsByKey)) {
        const beforeValue = beforeObject ? beforeObject[field] : undefined;
        const afterValue = afterObject[field];
        if (beforeValue !== afterValue) {
          changes.push({ field, label, before: beforeValue ?? null, after: afterValue ?? null });
        }
      }
      return changes;
    }

    // 【前提】action は "add" | "edit"。projectIdは対象が属するプロジェクトのid
    //   （store="projects"の場合はプロジェクト自身のid）。beforeItemは"edit"時のみ変更前の
    //   オブジェクト（"add"時はnull）。afterItemは保存後のオブジェクト。fieldLabelsByKeyは
    //   diffFieldsに渡す比較対象フィールドの一覧。
    // 【処理】"add"はchanges:[]で無条件に1件記録する（基本設計書8.1節：追加ログに戻すボタンは
    //   無いため差分は不要）。"edit"はdiffFieldsで実際に変わったフィールドを集め、1件も
    //   変わっていなければ記録しない（保存ボタンを押しただけで内容が同じ場合に、意味のない
    //   変更履歴が積み上がるのを防ぐ）。
    // 【結果】記録した場合はtrueを、"edit"で変更が無く記録しなかった場合はfalseを返す。
    async function recordChangelogEntry(action, projectId, store, storeLabel, itemId, itemName, beforeItem, afterItem, fieldLabelsByKey) {
      const changes = action === "edit" ? diffFields(beforeItem, afterItem, fieldLabelsByKey) : [];
      if (action === "edit" && changes.length === 0) return false;
      await addChangelogEntry({
        id: generateId(),
        projectId,
        action,
        store,
        storeLabel,
        itemId,
        itemName,
        changes,
        snapshot: afterItem,
        createdAt: new Date().toISOString(),
      });
      return true;
    }

    // 【前提】scheduleId は取得したいスケジュールの id。
    // 【処理】主キー(id)で1件を直接取得する（絞り込みではなく1件特定のため、インデックス不要）。
    //   schedules の既存CRUDには「idで1件取得」が無かったが、連鎖削除・日付再計算の複合操作で
    //   「特定のスケジュール1件の最新状態」を読む必要があるため、ここで追加する。
    // 【結果】見つかった場合はそのオブジェクトを、存在しない場合は undefined を resolve する。
    async function getScheduleById(scheduleId) {
      const db = await getDB();
      const transaction = db.transaction(STORE_SCHEDULES, "readonly");
      const store = transaction.objectStore(STORE_SCHEDULES);
      return promisifyRequest(store.get(scheduleId), transaction);
    }

    // 【設計判断：祖先日付の再計算をなぜ独立した関数にするか】
    //   基本設計書4.3節「子の開始日・終了日を変更すると、親の日付は全子の最早開始日〜最遅終了日に
    //   自動更新され、上位階層へも再帰的に伝播する」は、連鎖削除に限らず、将来スケジュールの
    //   日付編集機能（バーのドラッグ等）でも同じ処理が必要になる（詳細設計書3.2.3節
    //   syncParentDates/syncAncestorDates相当）。そのため削除処理に埋め込まず、
    //   「対象1件の日付を、その子に合わせて再計算し、必要なら親へ伝播する」という
    //   単独の責務を持つ関数として切り出す。
    //
    // 【前提】scheduleId は日付を再計算したい対象の id（削除された行の「元の親」から呼び出す想定）。
    // 【処理】対象の直下の子（by_parentIdインデックス）を取得し、日付を持つ子だけを対象に
    //   「最早開始日〜最遅終了日」を計算して対象自身に保存する。
    //   ※基本設計書4.3節「子を全て削除した場合、親の日付は再計算・リセットされない」の仕様どおり、
    //   日付を持つ子が1件も残っていない場合は何もしない（対象の日付をそのまま残す）。
    //   更新できた場合は、対象の親についても同じ処理を再帰的に行い、祖先全体へ伝播させる。
    // 【結果】更新が完了した時点で resolve する（戻り値なし）。
    async function syncAncestorDates(scheduleId) {
      const schedule = await getScheduleById(scheduleId);
      if (!schedule) return;

      const children = await getChildSchedules(scheduleId);
      const childrenWithDates = children.filter((child) => child.startDate && child.endDate);
      if (childrenWithDates.length === 0) {
        return;
      }

      const startDates = childrenWithDates.map((child) => child.startDate).sort();
      const endDates = childrenWithDates.map((child) => child.endDate).sort();
      const earliestStartDate = startDates[0];
      const latestEndDate = endDates[endDates.length - 1];
      await addSchedule({ ...schedule, startDate: earliestStartDate, endDate: latestEndDate });

      if (schedule.parentId !== null && schedule.parentId !== undefined) {
        await syncAncestorDates(schedule.parentId);
      }
    }

    // 【設計判断：スケジュールの連鎖削除】
    //   基本設計書L155-157・L200、シーケンス図集「3. 親スケジュール削除」の仕様どおり、
    //   1つの複合操作として次の3段階で実装する。
    //   1. 読み切り：getSchedulesByProjectでプロジェクト内の全件を1回だけ読み、
    //      アプリ層のツリー走査で「起点＋全子孫」のidを集める
    //      （データモデル設計6章：複数ストアにまたがる書き込みは、先に読み切ってから行う）。
    //   2. 書き込み：集めた各idについて、紐づくコメントを削除→スケジュール自体を削除→
    //      個別に削除ログ(changelog)を記録する（親・子・孫それぞれ個別にログが残る仕様＝L200）。
    //   3. 起点スケジュールの「元の親」がまだ存在するなら、syncAncestorDatesで日付を再計算する。
    //
    // 【前提】scheduleId は削除起点のスケジュール id。projectId は所属プロジェクトの id
    //   （呼び出し側は現在開いているプロジェクトを把握しているため受け取る）。
    // 【処理】上記の3段階を実行する。
    // 【結果】実際に削除されたスケジュールidの配列を resolve する（対象が存在しなければ空配列）。
    async function deleteScheduleCascade(scheduleId, projectId) {
      const allSchedules = await getSchedulesByProject(projectId);
      const scheduleById = new Map(allSchedules.map((schedule) => [schedule.id, schedule]));
      const targetSchedule = scheduleById.get(scheduleId);
      if (!targetSchedule) {
        return [];
      }

      const childSchedulesByParentId = new Map();
      for (const schedule of allSchedules) {
        if (schedule.parentId === null || schedule.parentId === undefined) continue;
        if (!childSchedulesByParentId.has(schedule.parentId)) {
          childSchedulesByParentId.set(schedule.parentId, []);
        }
        childSchedulesByParentId.get(schedule.parentId).push(schedule);
      }

      const idsToDelete = [];
      let frontier = [targetSchedule];
      while (frontier.length > 0) {
        const nextFrontier = [];
        for (const node of frontier) {
          idsToDelete.push(node.id);
          nextFrontier.push(...(childSchedulesByParentId.get(node.id) || []));
        }
        frontier = nextFrontier;
      }

      for (const id of idsToDelete) {
        const schedule = scheduleById.get(id);
        const comments = await getCommentsByTask(id);
        for (const comment of comments) {
          await deleteComment(comment.id);
        }
        await deleteSchedule(id);
        await addChangelogEntry({
          id: generateId(),
          projectId: schedule.projectId,
          action: "delete",
          store: "schedules",
          storeLabel: "スケジュール",
          itemId: schedule.id,
          itemName: schedule.name,
          changes: [],
          snapshot: schedule,
          createdAt: new Date().toISOString(),
        });
      }

      const originalParentId = targetSchedule.parentId;
      if (originalParentId !== null && originalParentId !== undefined) {
        await syncAncestorDates(originalParentId);
      }

      return idsToDelete;
    }

    // 【設計判断：マインドマップノードの連鎖削除】
    //   詳細設計書3.5.3節の仕様どおり、対象ノード＋子孫ノードを収集して削除する。
    //   deleteScheduleCascade と同じ考え方だが、issues には次の3点の違いがある：
    //   ・comments のような紐づく別ストアが無い（削除するのはissues自体のみ）
    //   ・日付の概念が無いため、祖先の再計算（syncAncestorDates相当）は不要
    //   ・parentNodeId にインデックスが無いため、子孫収集は getIssuesByProject の結果を
    //     アプリ層でツリー走査する（issues側のCRUD設計方針と同じ理由）
    //   なお issues は LOGGED_STORES に含まれるため、schedules と同様に個別の削除ログを残す。
    //   子孫id収集はcollectIssueSubtreeIds（折りたたみ機能と共通）に委譲し、ここで
    //   ツリー走査ロジックを重複させない。
    //
    // 【前提】issueId は削除起点のノード id。projectId は所属プロジェクトの id。
    // 【処理】起点＋全子孫ノードを収集し、それぞれ削除・削除ログ記録を行う。
    // 【結果】実際に削除されたノードidの配列を resolve する（対象が存在しなければ空配列）。
    async function deleteIssueCascade(issueId, projectId) {
      const allIssues = await getIssuesByProject(projectId);
      const issueById = new Map(allIssues.map((issue) => [issue.id, issue]));
      if (!issueById.has(issueId)) {
        return [];
      }

      const idsToDelete = collectIssueSubtreeIds(allIssues, issueId);

      for (const id of idsToDelete) {
        const issue = issueById.get(id);
        await deleteIssue(id);
        await addChangelogEntry({
          id: generateId(),
          projectId: issue.projectId,
          action: "delete",
          store: "issues",
          storeLabel: "マインドマップノード",
          itemId: issue.id,
          itemName: issue.title,
          changes: [],
          snapshot: issue,
          createdAt: new Date().toISOString(),
        });
      }

      return idsToDelete;
    }

    // ===== H1：データ出力（JSONエクスポート） =====
    // 【設計判断】対象は基本設計書9.1に明記された全8ストア（projects/schedules/tasks/issues/
    //   comments/memos/quickmemos/snapshots）。changelog（変更履歴）はこの一覧に含まれないため
    //   対象外とする。crud-implementation.mdの1関数1処理の方針により、
    //   「全ストアを読み切る」「ファイル名を組み立てる」「ダウンロードを実行する」を
    //   別関数に分け、ボタンのクリックハンドラがこの3つを順に呼ぶだけの構成にする。

    // 【前提】なし。
    // 【処理】8ストアそれぞれの全件取得関数（getAllXxx）を並行に呼び、1つのオブジェクトにまとめる。
    //   各getAllXxxは自分専用のトランザクションを持つ独立した読み取りのため、Promise.allで
    //   並行に走らせても「1つのトランザクション内で他の非同期処理を待つ」ことにはならない
    //   （switchToProjectの3パネル同時更新と同じ考え方）。
    // 【結果】{projects, schedules, tasks, issues, comments, memos, quickmemos, snapshots} を resolve する。
    async function collectAllStoresDataForExport() {
      const [projects, schedules, tasks, issues, comments, memos, quickmemos, snapshots] = await Promise.all([
        getAllProjects(),
        getAllSchedules(),
        getAllTasks(),
        getAllIssues(),
        getAllComments(),
        getAllMemos(),
        getAllQuickMemos(),
        getAllSnapshots(),
      ]);
      return { projects, schedules, tasks, issues, comments, memos, quickmemos, snapshots };
    }

    // 【前提】date はファイル名の日付部分に使うDateオブジェクト。
    // 【処理】YYYYMMDD形式（区切り無し）でエクスポートファイル名を組み立てる
    //   （基本設計書9.1：`GanttForge_backup_{YYYYMMDD}.json`）。
    // 【結果】組み立てたファイル名の文字列を返す。
    function buildExportBackupFileName(date) {
      const compactDateString = date.toISOString().slice(0, 10).replaceAll("-", "");
      return `GanttForge_backup_${compactDateString}.json`;
    }

    // 【前提】fileName はダウンロードさせたいファイル名。dataObject はJSONへ変換可能なオブジェクト。
    // 【処理】dataObjectをJSON文字列化してBlob化し、一時的な<a>要素を使ってブラウザにダウンロードさせる。
    //   Blob URLはダウンロードの合図（click）を出した直後にはもう不要になるため、
    //   revokeObjectURLでメモリ上のURLマッピングを解放する。
    // 【結果】ブラウザのダウンロードが実行される（戻り値なし）。
    function downloadObjectAsJsonFile(fileName, dataObject) {
      const jsonBlob = new Blob([JSON.stringify(dataObject, null, 2)], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(jsonBlob);
      const downloadLinkElement = document.createElement("a");
      downloadLinkElement.href = downloadUrl;
      downloadLinkElement.download = fileName;
      downloadLinkElement.click();
      URL.revokeObjectURL(downloadUrl);
    }

    // 【前提】なし。
    // 【処理】全8ストアを読み切り、ファイル名を組み立ててJSONファイルとしてダウンロードする
    //   （基本設計書9.1／詳細設計書3.9.1 exportData相当）。
    // 【結果】ダウンロード実行後、トースト「データをエクスポートしました」を表示する。
    async function handleExportDataButtonClick() {
      const allStoresData = await collectAllStoresDataForExport();
      const fileName = buildExportBackupFileName(new Date());
      downloadObjectAsJsonFile(fileName, allStoresData);
      showToast("データをエクスポートしました");
    }

    // ===== H2：データ取込（JSONインポート＋差分適用） =====
    // 【設計判断】質問リスト_未確認事項.md Q1〜Q3の決定に従う：
    //   ・比較・適用対象はH1と同じ全8ストア（changelogは対象外）。
    //   ・変更履歴（changelog）への記録は既存のLOGGED_STORES（projects/schedules/tasks/issues）
    //     のみに限定し、comments/memos/quickmemos/snapshotsは記録しない（Q1）。
    //   ・タスク管理の「変更」ログの差分フィールドはTASK_LOGGED_FIELD_LABELS（Q2）。
    //   ・削除候補はプロジェクトによる絞り込みを行わず、DB全体で比較する（Q3）。
    //   ストアごとの分岐をgetBackupStoreDefinitions()の1箇所に集約し、H1のgetAllと揃えることで
    //   「片方のストアだけ増やし忘れる」事故を防ぐ。この関数を宣言時ではなく呼び出し時に
    //   評価するのは、PROJECT_LOGGED_FIELD_LABELS等（後方のモーダル節で定義）を参照するため
    //   （constは宣言前に参照できないが、関数本体の評価は呼び出し時まで遅延されるため問題ない）。

    // 【前提】なし。
    // 【処理】H1（エクスポート）・H2（インポート）で共通して使う「ストアの取扱い定義」を返す。
    // 【結果】8ストア分の { key, label, getAll, put, del, nameField, logged, fieldLabels } の配列を返す。
    function getBackupStoreDefinitions() {
      return [
        { key: "projects", label: "プロジェクト", getAll: getAllProjects, put: addProject, del: deleteProject, nameField: "name", logged: true, fieldLabels: PROJECT_LOGGED_FIELD_LABELS },
        { key: "schedules", label: "スケジュール", getAll: getAllSchedules, put: addSchedule, del: deleteSchedule, nameField: "name", logged: true, fieldLabels: SCHEDULE_LOGGED_FIELD_LABELS },
        { key: "tasks", label: "タスク", getAll: getAllTasks, put: addTask, del: deleteTask, nameField: "title", logged: true, fieldLabels: TASK_LOGGED_FIELD_LABELS },
        { key: "issues", label: "マインドマップノード", getAll: getAllIssues, put: addIssue, del: deleteIssue, nameField: "title", logged: true, fieldLabels: ISSUE_LOGGED_FIELD_LABELS },
        { key: "comments", label: "コメント", getAll: getAllComments, put: addComment, del: deleteComment, nameField: "text", logged: false, fieldLabels: {} },
        { key: "memos", label: "メモ", getAll: getAllMemos, put: addMemo, del: deleteMemo, nameField: "title", logged: false, fieldLabels: {} },
        { key: "quickmemos", label: "即時メモ", getAll: getAllQuickMemos, put: addQuickMemo, del: deleteQuickMemo, nameField: "text", logged: false, fieldLabels: {} },
        { key: "snapshots", label: "スナップショット", getAll: getAllSnapshots, put: addSnapshot, del: deleteSnapshot, nameField: "name", logged: false, fieldLabels: {} },
      ];
    }

    // 【前提】parsedData はJSON.parseの結果（型不明の値である可能性がある）。
    // 【処理】基本設計書9.2の検証：projects・schedulesキーの両方を配列として持つかどうかを判定する。
    // 【結果】有効な形をしていればtrue、そうでなければfalseを返す。
    function isValidImportedBackupShape(parsedData) {
      if (!parsedData || typeof parsedData !== "object") return false;
      return Array.isArray(parsedData.projects) && Array.isArray(parsedData.schedules);
    }

    // 【前提】currentRecords・importedRecordsはどちらも id を持つオブジェクトの配列
    //   （同じストアの、現在のDB内容と取込ファイル内の内容）。
    // 【処理】idをキーに3種類へ分類する：
    //   ・add：importedRecordsにあるが currentRecords に無いid
    //   ・del：currentRecordsにあるが importedRecords に無いid（Q3：プロジェクトによる絞り込み無し）
    //   ・mod：両方にあり、内容（JSON文字列化して比較）が異なるid
    //   内容が完全一致するもの（取り込んでも変化が無いもの）はどの分類にも含めない。
    // 【結果】{ add: [record...], mod: [{before, after}...], del: [record...] } を返す。
    function computeStoreDiff(currentRecords, importedRecords) {
      const currentById = new Map(currentRecords.map((record) => [record.id, record]));
      const importedById = new Map(importedRecords.map((record) => [record.id, record]));

      const add = [];
      const mod = [];
      for (const [id, importedRecord] of importedById) {
        const currentRecord = currentById.get(id);
        if (!currentRecord) {
          add.push(importedRecord);
        } else if (JSON.stringify(currentRecord) !== JSON.stringify(importedRecord)) {
          mod.push({ before: currentRecord, after: importedRecord });
        }
      }

      const del = [];
      for (const [id, currentRecord] of currentById) {
        if (!importedById.has(id)) {
          del.push(currentRecord);
        }
      }

      return { add, mod, del };
    }

    // 【前提】importedAllStoresData はisValidImportedBackupShapeで検証済みの取込データ
    //   （H1エクスポートと同じ形＝8ストア分の配列を持つオブジェクト）。
    // 【処理】getBackupStoreDefinitionsの各ストアについて、現在のDB内容（definition.getAll()）と
    //   取込データをcomputeStoreDiffで比較する。1件も差分が無いストアは結果から除く
    //   （差分比較モーダルに空のグループを表示しないため）。
    // 【結果】[{ key, label, nameField, add, mod, del }, ...]（差分のあるストアのみ）を返す。
    async function buildImportDiff(importedAllStoresData) {
      const diffByStore = [];
      for (const definition of getBackupStoreDefinitions()) {
        const currentRecords = await definition.getAll();
        const importedRecords = importedAllStoresData[definition.key] || [];
        const diff = computeStoreDiff(currentRecords, importedRecords);
        if (diff.add.length > 0 || diff.mod.length > 0 || diff.del.length > 0) {
          diffByStore.push({ key: definition.key, label: definition.label, nameField: definition.nameField, ...diff });
        }
      }
      return diffByStore;
    }

    // 【前提】storeKey/action/itemIdはどのレコードかを特定する識別子（action は "add"|"mod"|"del"）。
    //   displayNameHtmlは表示用に組み立て済みの（エスケープ済み）HTML文字列。
    // 【処理】1件分のチェックボックス付き行のHTML文字列を組み立てる
    //   （モーダル・ダイアログ一覧M9：各項目チェックボックス。既定はチェック済み＝全選択状態）。
    // 【結果】<label>要素のHTML文字列を返す。
    function renderImportDiffItemToHtml(storeKey, action, itemId, displayNameHtml) {
      const actionBadgeLabels = { add: "追加", mod: "変更", del: "削除" };
      const actionBadgeClasses = { add: "is-add", mod: "is-edit", del: "is-delete" };
      return `<label class="import-diff-item">
        <input type="checkbox" class="import-diff-checkbox" data-store-key="${storeKey}" data-action="${action}" data-item-id="${escapeHtmlText(String(itemId))}" checked>
        <span class="changelog-action-badge ${actionBadgeClasses[action]}">${actionBadgeLabels[action]}</span>
        ${displayNameHtml}
      </label>`;
    }

    // 【前提】diffByStoreはbuildImportDiffの戻り値。
    // 【処理】ストアごとに見出し（件数の内訳）と、add/mod/delそれぞれのチェックボックス付き一覧を
    //   組み立てる（モーダル・ダイアログ一覧M9：ストアごとにグループ化した変更・削除候補一覧、
    //   全選択チェックボックス）。modの表示名は、名前フィールドが変わっていれば
    //   「旧名前 → 新名前」、変わっていなければ新しい方の名前をそのまま表示する。
    //   差分が1件も無い場合は、その旨を案内するだけのモーダルにする（基本設計書9.2は
    //   差分が有る前提の記述のため、0件時の表示は本関数内で決める運用上の配慮）。
    // 【結果】モーダルパネルにそのまま入れられるHTML文字列を返す。
    function renderImportDiffModalToHtml(diffByStore) {
      if (diffByStore.length === 0) {
        return `<h2>データ取込－差分比較</h2>
          <p class="empty-state-message">現在のデータと取込ファイルの間に差分はありません。</p>
          <div class="modal-actions">
            <button type="button" class="modal-button-secondary" id="importDiffCancelButton">閉じる</button>
          </div>`;
      }

      const storeGroupsHtml = diffByStore
        .map((storeDiff) => {
          const addItemsHtml = storeDiff.add
            .map((record) => renderImportDiffItemToHtml(storeDiff.key, "add", record.id, escapeHtmlText(String(record[storeDiff.nameField] ?? ""))))
            .join("");
          const modItemsHtml = storeDiff.mod
            .map(({ before, after }) => {
              const beforeName = before[storeDiff.nameField];
              const afterName = after[storeDiff.nameField];
              const displayNameHtml = beforeName !== afterName
                ? `${escapeHtmlText(String(beforeName ?? ""))} → ${escapeHtmlText(String(afterName ?? ""))}`
                : escapeHtmlText(String(afterName ?? ""));
              return renderImportDiffItemToHtml(storeDiff.key, "mod", after.id, displayNameHtml);
            })
            .join("");
          const delItemsHtml = storeDiff.del
            .map((record) => renderImportDiffItemToHtml(storeDiff.key, "del", record.id, escapeHtmlText(String(record[storeDiff.nameField] ?? ""))))
            .join("");
          return `<div class="import-diff-store-group">
            <h3>${escapeHtmlText(storeDiff.label)}（追加${storeDiff.add.length}・変更${storeDiff.mod.length}・削除${storeDiff.del.length}）</h3>
            ${addItemsHtml}${modItemsHtml}${delItemsHtml}
          </div>`;
        })
        .join("");

      return `<h2>データ取込－差分比較</h2>
        <div class="modal-field">
          <label><input type="checkbox" id="importDiffSelectAllCheckbox" checked> 全選択</label>
        </div>
        <div class="import-diff-list">${storeGroupsHtml}</div>
        <div class="modal-actions">
          <button type="button" class="modal-button-secondary" id="importDiffCancelButton">キャンセル</button>
          <button type="button" class="modal-button-primary" id="importDiffApplyButton">選択した変更を適用</button>
        </div>`;
    }

    // 【前提】diffByStoreはbuildImportDiffの戻り値。
    // 【処理】差分比較モーダルを開き、全選択チェックボックス・キャンセル・適用ボタンにイベントを登録する。
    // 【結果】モーダルが操作可能な状態で表示される。
    function openImportDiffModal(diffByStore) {
      openModal(renderImportDiffModalToHtml(diffByStore));

      const cancelButton = document.getElementById("importDiffCancelButton");
      cancelButton.addEventListener("click", closeModal);

      const selectAllCheckbox = document.getElementById("importDiffSelectAllCheckbox");
      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener("change", () => {
          for (const checkbox of document.querySelectorAll(".import-diff-checkbox")) {
            checkbox.checked = selectAllCheckbox.checked;
          }
        });
      }

      const applyButton = document.getElementById("importDiffApplyButton");
      if (applyButton) {
        applyButton.addEventListener("click", () => handleApplyImportButtonClick(diffByStore));
      }
    }

    // 【前提】storeDefinitionはgetBackupStoreDefinitionsの1要素。actionは"add"|"mod"|"del"。
    //   primaryRecordは適用対象そのもの（add/modは取込データ側のレコード、delは削除対象＝
    //   現在のDB側のレコード）。beforeRecordForDiffはmod時のみ使う変更前レコード（他はnull）。
    // 【処理】通常のupsert(put)／削除(del)関数を1件だけ呼ぶ。ストアがLOGGED_STORES対象
    //   （projects/schedules/tasks/issues）の場合のみ、recordChangelogEntryで変更履歴を記録する
    //   （質問リスト_未確認事項.md Q1）。projectIdは、projectsストアではレコード自身のidを、
    //   他ストアではレコードのprojectIdを使う（handleProjectModalSaveButtonClickと同じ扱い）。
    // 【結果】1件の適用（put/delete、必要なら変更履歴の記録）が完了した時点で resolve する。
    async function applyOneImportItem(storeDefinition, action, primaryRecord, beforeRecordForDiff) {
      if (action === "del") {
        await storeDefinition.del(primaryRecord.id);
      } else {
        await storeDefinition.put(primaryRecord);
      }

      if (!storeDefinition.logged) return;

      const projectId = storeDefinition.key === "projects" ? primaryRecord.id : primaryRecord.projectId;
      const changelogAction = action === "add" ? "add" : action === "mod" ? "edit" : "delete";
      await recordChangelogEntry(
        changelogAction,
        projectId,
        storeDefinition.key,
        storeDefinition.label,
        primaryRecord.id,
        primaryRecord[storeDefinition.nameField],
        beforeRecordForDiff ?? null,
        primaryRecord,
        storeDefinition.fieldLabels
      );
    }

    // 【前提】diffByStoreは、開いている差分比較モーダルが表示している内容そのもの
    //   （buildImportDiffの戻り値。チェック状態はモーダルのDOM側が持つ）。
    // 【処理】チェック済みのチェックボックスを集め、0件ならアラートで案内して終了する
    //   （詳細設計書3.9.3エラーバリエーション1）。1件以上ならconfirmで最終確認し
    //   （エラーバリエーション2）、OKならチェック済みの項目だけを1件ずつapplyOneImportItemで適用する。
    // 【結果】適用後はモーダルを閉じ、プロジェクト一覧・現在の画面を再読込し、
    //   トースト「取込完了: 新規{n}件 / 変更{n}件 / 削除{n}件」を表示する。
    async function handleApplyImportButtonClick(diffByStore) {
      const checkedCheckboxes = Array.from(document.querySelectorAll(".import-diff-checkbox:checked"));
      if (checkedCheckboxes.length === 0) {
        window.alert("適用する項目を選択してください");
        return;
      }
      if (!window.confirm(`${checkedCheckboxes.length}件の変更を適用しますか？`)) return;

      const storeDefinitionsByKey = new Map(getBackupStoreDefinitions().map((definition) => [definition.key, definition]));
      const diffByStoreKey = new Map(diffByStore.map((storeDiff) => [storeDiff.key, storeDiff]));

      let addedCount = 0;
      let modifiedCount = 0;
      let deletedCount = 0;

      for (const checkbox of checkedCheckboxes) {
        const storeDefinition = storeDefinitionsByKey.get(checkbox.dataset.storeKey);
        const storeDiff = diffByStoreKey.get(checkbox.dataset.storeKey);
        const itemId = checkbox.dataset.itemId;

        if (checkbox.dataset.action === "add") {
          const record = storeDiff.add.find((item) => String(item.id) === itemId);
          await applyOneImportItem(storeDefinition, "add", record, null);
          addedCount++;
        } else if (checkbox.dataset.action === "mod") {
          const pair = storeDiff.mod.find((item) => String(item.after.id) === itemId);
          await applyOneImportItem(storeDefinition, "mod", pair.after, pair.before);
          modifiedCount++;
        } else if (checkbox.dataset.action === "del") {
          const record = storeDiff.del.find((item) => String(item.id) === itemId);
          await applyOneImportItem(storeDefinition, "del", record, null);
          deletedCount++;
        }
      }

      closeModal();
      await refreshProjectSelectDropdown();
      const remainingProjectList = await getAllProjects();
      const stillExists = remainingProjectList.some((project) => project.id === currentSelectedProjectId);
      const nextProjectId = stillExists ? currentSelectedProjectId : (remainingProjectList[0]?.id || null);
      document.getElementById("projectSelectDropdown").value = nextProjectId || "";
      await switchToProject(nextProjectId);
      showToast(`取込完了: 新規${addedCount}件 / 変更${modifiedCount}件 / 削除${deletedCount}件`);
    }

    // 【前提】fileInputElement は<input type="file">要素で、files[0]に選択されたJSONファイルを持つこと。
    // 【処理】ファイルをテキストとして読み込みJSON.parseする。パース失敗、または
    //   projects/schedulesキーが無い場合は「無効なファイルです。GanttForgeのエクスポートファイルを
    //   選択してください。」をalertで表示しconsole.errorに詳細を出す（基本設計書9.2）。
    //   検証OKなら現在のDB内容との差分を算出し、差分比較モーダルを開く。
    //   ファイル選択欄は最後に必ず空にする（<input type="file">は同じファイルを選び直しても
    //   changeイベントが発火しない仕様のため、次回選択のために毎回リセットする）。
    // 【結果】検証NG時は何も変更せず終了する。OK時は差分比較モーダルを開く。
    async function handleImportFileInputChange(fileInputElement) {
      const selectedFile = fileInputElement.files[0];
      fileInputElement.value = "";
      if (!selectedFile) return;

      let importedData;
      try {
        const fileText = await selectedFile.text();
        importedData = JSON.parse(fileText);
      } catch (error) {
        console.error(error);
        window.alert("無効なファイルです。GanttForgeのエクスポートファイルを選択してください。");
        return;
      }

      if (!isValidImportedBackupShape(importedData)) {
        console.error("インポートファイルにprojects/schedulesキーがありません", importedData);
        window.alert("無効なファイルです。GanttForgeのエクスポートファイルを選択してください。");
        return;
      }

      const diffByStore = await buildImportDiff(importedData);
      openImportDiffModal(diffByStore);
    }

    // 【前提】projectName はファイル名に使うプロジェクト名（未選択時はnull/undefinedを許容）。
    //   extension は拡張子（ドット無し。例："pdf"/"xlsx"）。H3・H4で共通のファイル名規則を使う。
    // 【処理】`GanttForge_{プロジェクト名}_{YYYYMMDD}.{拡張子}` の形でファイル名を組み立てる。
    //   プロジェクト名が無い場合は「無題」を使う。
    // 【結果】組み立てたファイル名の文字列を返す。
    function buildReportFileName(projectName, extension) {
      const compactDateString = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      return `GanttForge_${projectName || "無題"}_${compactDateString}.${extension}`;
    }

    // 【前提】date は出力日時にしたいDateオブジェクト。H3(PDF)・H4(Excel)で共通の表記
    //   （基本設計書9.3・9.4：「出力日時：YYYY/M/D H:mm:ss」）に使う。
    // 【処理】YYYY/M/D H:mm:ss形式の文字列を組み立てる（月日は0埋めせず、時分秒のみ0埋めする）。
    // 【結果】組み立てた文字列を返す。
    function formatDateToOutputTimestampString(date) {
      const padToTwoDigits = (value) => String(value).padStart(2, "0");
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${padToTwoDigits(date.getHours())}:${padToTwoDigits(date.getMinutes())}:${padToTwoDigits(date.getSeconds())}`;
    }

    // ===== H3：PDF出力（exportPDF） =====
    // 【設計判断】crud-implementation.md対象外（DB操作を伴わない）。基本設計書9.3・詳細設計書
    //   3.10.2に従い、以下の方針で実装する：
    //   ・キャプチャ対象は#wbsPanel（左：スケジュール一覧）と#ganttPanelBody（右：ガントチャート）。
    //     #ganttPanelBodyは.gantt-scroll-area（overflow-x:auto）の中身のため、素朴に
    //     html2canvasへ渡すと画面に見えている範囲だけしかキャプチャされない。html2canvasの
    //     width/height/windowWidth/windowHeightオプションに要素自身のscrollWidth/scrollHeight
    //     （スクロール位置に関わらず全内容の実サイズを表す）を明示することで、スクロールで隠れて
    //     いる最終日までの全体を1枚の画像として取得する（「最終日ギリギリに収まる可変サイズ」の
    //     実装方法）。
    //   ・タイトル・出力日時は、DOMへの一時挿入ではなくCanvas 2Dコンテキストで直接描画する
    //     （キャプチャ後の画像に上乗せする方が、一時的なDOM変更を必要とせず確実なため）。
    //   ・PDFのページサイズは、この合成後Canvasのピクセルサイズにそのまま合わせる
    //     （unit:"px"のカスタムformatを使う。A4等の固定サイズは使わない）。

    // 詳細設計書3.10.2：「PDF生成中...」表示後、50ms待機してからキャプチャ処理へ進む。
    const PDF_CAPTURE_START_DELAY_MS = 50;

    // 合成後Canvas上部に確保する、タイトル・出力日時を描くヘッダー帯の高さ（ピクセル）。
    const PDF_HEADER_HEIGHT_PX = 60;

    // 【前提】なし。
    // 【処理】html2canvas・jsPDFのグローバルオブジェクトが両方読み込まれているかを判定する
    //   （詳細設計書3.10.2）。
    // 【結果】両方読み込まれていればtrue、そうでなければfalseを返す。
    function arePdfLibrariesLoaded() {
      return typeof window.html2canvas !== "undefined" && typeof window.jspdf !== "undefined" && typeof window.jspdf.jsPDF !== "undefined";
    }

    // 【前提】targetElement はキャプチャしたいDOM要素。overflow-x:autoな親を持つ場合でも、
    //   要素自身のscrollWidth/scrollHeightは（親のスクロール位置に関わらず）全内容の実サイズを表す。
    // 【処理】html2canvasに、要素の実サイズ（scrollWidth/scrollHeight）をwidth/height/
    //   windowWidth/windowHeightとして明示的に渡し、画面に見えている範囲だけでなく全内容を
    //   キャプチャさせる。
    // 【結果】キャプチャ結果のCanvas要素を resolve する。
    function captureElementFullContentToCanvas(targetElement) {
      return window.html2canvas(targetElement, {
        width: targetElement.scrollWidth,
        height: targetElement.scrollHeight,
        windowWidth: targetElement.scrollWidth,
        windowHeight: targetElement.scrollHeight,
      });
    }

    // 【前提】wbsCanvas・ganttCanvasはそれぞれcaptureElementFullContentToCanvasで取得したCanvas。
    //   titleText・timestampTextはヘッダー帯に描く文字列。
    // 【処理】上部にタイトル・出力日時を描くヘッダー帯を確保した1枚のCanvasを新規に作り、
    //   その下にwbsCanvasを左、ganttCanvasを右に並べて描画する（基本設計書9.3：
    //   「左側：スケジュール一覧／右側：ガントチャート」「右上に出力日時等の情報欄」）。
    // 【結果】合成済みのCanvas要素を返す。
    function composeGanttPdfCanvas(wbsCanvas, ganttCanvas, titleText, timestampText) {
      const composedCanvas = document.createElement("canvas");
      composedCanvas.width = wbsCanvas.width + ganttCanvas.width;
      composedCanvas.height = PDF_HEADER_HEIGHT_PX + Math.max(wbsCanvas.height, ganttCanvas.height);

      const context = composedCanvas.getContext("2d");
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, composedCanvas.width, composedCanvas.height);

      context.fillStyle = "#111827";
      context.font = "bold 24px sans-serif";
      context.textBaseline = "middle";
      context.fillText(titleText, 16, PDF_HEADER_HEIGHT_PX / 2);

      context.font = "14px sans-serif";
      context.textAlign = "right";
      context.fillText(timestampText, composedCanvas.width - 16, PDF_HEADER_HEIGHT_PX / 2);
      context.textAlign = "left";

      context.drawImage(wbsCanvas, 0, PDF_HEADER_HEIGHT_PX);
      context.drawImage(ganttCanvas, wbsCanvas.width, PDF_HEADER_HEIGHT_PX);

      return composedCanvas;
    }

    // 【前提】なし（currentSelectedProjectId・currentProjectObjectが選択済みであること。
    //   未選択時はexportPdfButton自体がdisabledのため、この関数は呼ばれない想定）。
    // 【処理】ライブラリの読込確認→トースト表示→50ms待機→WBS+ガントをキャプチャ→合成→
    //   カスタムページサイズのPDFを生成→ダウンロードする（詳細設計書3.10.2）。
    // 【結果】成功時はトースト「PDFを保存しました」、ライブラリ未読込時は
    //   「PDFライブラリの読み込みに失敗しました。」、生成中の例外時は「PDF生成に失敗しました」
    //   （console.errorにも詳細を出す）を表示する。
    async function exportPDF() {
      if (!arePdfLibrariesLoaded()) {
        showToast("PDFライブラリの読み込みに失敗しました。");
        return;
      }

      showToast("PDF生成中...");
      await new Promise((resolve) => setTimeout(resolve, PDF_CAPTURE_START_DELAY_MS));

      try {
        const wbsCanvas = await captureElementFullContentToCanvas(document.getElementById("wbsPanel"));
        const ganttCanvas = await captureElementFullContentToCanvas(document.getElementById("ganttPanelBody"));
        const titleText = `${currentProjectObject?.name || ""} — ガントチャート`;
        const timestampText = `出力日時：${formatDateToOutputTimestampString(new Date())}`;
        const composedCanvas = composeGanttPdfCanvas(wbsCanvas, ganttCanvas, titleText, timestampText);

        const pdfDocument = new window.jspdf.jsPDF({
          orientation: composedCanvas.width >= composedCanvas.height ? "landscape" : "portrait",
          unit: "px",
          format: [composedCanvas.width, composedCanvas.height],
        });
        pdfDocument.addImage(composedCanvas, "PNG", 0, 0, composedCanvas.width, composedCanvas.height);
        pdfDocument.save(buildReportFileName(currentProjectObject?.name, "pdf"));

        showToast("PDFを保存しました");
      } catch (error) {
        console.error(error);
        showToast("PDF生成に失敗しました");
      }
    }

