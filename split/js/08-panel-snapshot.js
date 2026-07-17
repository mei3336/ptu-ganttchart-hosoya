    // ===== P2：スナップショットパネル =====
    // 【設計判断】保存・一覧表示・削除に加え、復元（restoreSnapshot）と比較（compareSnapshot）を
    //   実装する。復元は「現在のschedules全削除→書き戻し、projectの日付・マイルストーンも
    //   書き戻す、変更履歴に記録しない」特殊な一括書き換え専用の処理（お手本の既知の非対称
    //   仕様。詳細はrestoreSnapshot直前のコメントを参照）。

    // 比較結果を表示中（展開中）のスナップショットidの集合。collapsedScheduleIdsと同じ理由で
    // DB非保存の画面上だけの一時状態にする（複数件を同時に展開できる）。
    const expandedSnapshotCompareIds = new Set();
    // 展開中スナップショットの比較結果キャッシュ（snapshotId→compareSnapshotの戻り値）。
    // compareSnapshotはDB読み取りを伴う非同期処理のため、開くたびに計算し直すのではなく
    // 展開中だけ保持し、閉じたら破棄する（次回開いたときは最新のDB状態で再計算するため）。
    const snapshotCompareResultsById = new Map();

    // 変更履歴（changelog）が対象にするSCHEDULE_LOGGED_FIELD_LABELSとは対象フィールドが異なる
    // ため、専用の定数として別に定義する（parentIdを含む・orderを含まない）。
    // parentIdを含める理由：スナップショット時点と親子関係が変わっていることも「変更」として
    // 検出したいため。orderを含めない理由：並び順だけが変わった場合を「変更」として誤検出
    // したくないため（ユーザー指定の比較対象フィールドに合わせる）。
    const SNAPSHOT_COMPARE_FIELD_LABELS = {
      name: "名前",
      startDate: "開始日",
      endDate: "終了日",
      taskStatus: "ステータス",
      assignee: "担当者",
      notes: "メモ",
      color: "カラー",
      parentId: "親スケジュール",
    };

    // 【前提】snapshot は比較対象のスナップショットオブジェクト（snapshot.data.schedulesを持つ）。
    // 【処理】snapshot.projectIdの現在のschedules全件を取得し、idをキーにスナップショット側と
    //   突き合わせる。追加＝現在にあってスナップショットに無いもの、削除＝スナップショットに
    //   あって現在に無いもの、変更＝両方にありSNAPSHOT_COMPARE_FIELD_LABELSのいずれかの値が
    //   異なるもの（diffFieldsの結果が1件以上ある場合のみ。orderだけの違いを変更扱いしない
    //   ための判定）。
    // 【結果】{ add: [schedule...], mod: [{before, after, changes}...], del: [schedule...] } を返す。
    async function compareSnapshot(snapshot) {
      const currentSchedules = await getSchedulesByProject(snapshot.projectId);
      const currentById = new Map(currentSchedules.map((schedule) => [schedule.id, schedule]));
      const snapshotById = new Map(snapshot.data.schedules.map((schedule) => [schedule.id, schedule]));

      const add = currentSchedules.filter((schedule) => !snapshotById.has(schedule.id));
      const del = snapshot.data.schedules.filter((schedule) => !currentById.has(schedule.id));

      const mod = [];
      for (const [scheduleId, snapshotSchedule] of snapshotById) {
        const currentSchedule = currentById.get(scheduleId);
        if (!currentSchedule) continue;
        const changes = diffFields(snapshotSchedule, currentSchedule, SNAPSHOT_COMPARE_FIELD_LABELS);
        if (changes.length > 0) {
          mod.push({ before: snapshotSchedule, after: currentSchedule, changes });
        }
      }
      return { add, mod, del };
    }

    // 【前提】diffResult はcompareSnapshotの戻り値。
    // 【処理】追加/変更/削除を分類して一覧表示するHTML文字列を組み立てる（変更行の新旧値表示は
    //   変更履歴と同じ.cl-old/.cl-new/.changelog-changes-listを再利用し、見た目の役割が同じ
    //   ものに新規クラスを増やさない）。3種とも0件なら「差分なし」を表示する。
    // 【結果】比較結果表示欄に入れられるHTML文字列を返す。
    function renderSnapshotCompareResultToHtml(diffResult) {
      if (diffResult.add.length === 0 && diffResult.mod.length === 0 && diffResult.del.length === 0) {
        return '<p class="empty-state-message">差分なしです。</p>';
      }
      const addRowsHtml = diffResult.add
        .map(
          (schedule) => `<div class="panel-list-item">
            <span class="changelog-action-badge is-add">追加</span> ${escapeHtmlText(schedule.name)}
          </div>`
        )
        .join("");
      const delRowsHtml = diffResult.del
        .map(
          (schedule) => `<div class="panel-list-item">
            <span class="changelog-action-badge is-delete">削除</span> ${escapeHtmlText(schedule.name)}
          </div>`
        )
        .join("");
      const modRowsHtml = diffResult.mod
        .map(({ after, changes }) => {
          const changesHtml = changes
            .map(
              (change) => `<div class="changelog-change-row">
                <span class="changelog-field-label">${escapeHtmlText(change.label)}：</span>
                <span class="cl-old">${escapeHtmlText(String(change.before ?? ""))}</span>
                <span class="changelog-change-arrow">→</span>
                <span class="cl-new">${escapeHtmlText(String(change.after ?? ""))}</span>
              </div>`
            )
            .join("");
          return `<div class="panel-list-item">
            <div class="panel-list-item-main">
              <span class="changelog-action-badge is-edit">変更</span> ${escapeHtmlText(after.name)}
              <div class="changelog-changes-list">${changesHtml}</div>
            </div>
          </div>`;
        })
        .join("");
      return `<div class="snapshot-compare-result">${addRowsHtml}${modRowsHtml}${delRowsHtml}</div>`;
    }

    // 【前提】snapshotList は同一プロジェクト内のスナップショット全件。expandedSnapshotCompareIds は
    //   比較結果を展開中のスナップショットidの集合。snapshotCompareResultsById は展開中の
    //   比較結果キャッシュ（snapshotId→compareSnapshotの戻り値）。
    // 【処理】名前・作成日時・削除/復元/比較ボタンを持つ一覧のHTML文字列を組み立てる（DOMには
    //   触れない）。展開中のスナップショットは、直下に比較結果をインライン表示する。
    // 【結果】snapshotPanelBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderSnapshotListToHtml(snapshotList, expandedSnapshotCompareIds, snapshotCompareResultsById) {
      if (snapshotList.length === 0) {
        return '<p class="empty-state-message">スナップショットがありません。</p>';
      }
      return snapshotList
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((snapshot) => {
          const isExpanded = expandedSnapshotCompareIds.has(snapshot.id);
          const compareResultHtml = isExpanded && snapshotCompareResultsById.has(snapshot.id)
            ? renderSnapshotCompareResultToHtml(snapshotCompareResultsById.get(snapshot.id))
            : "";
          return `<div class="panel-list-item" data-snapshot-id="${escapeHtmlText(snapshot.id)}">
            <div class="panel-list-item-main">
              <div>${escapeHtmlText(snapshot.name)}</div>
              <div class="panel-list-item-meta">${escapeHtmlText(snapshot.createdAt)}</div>
              ${compareResultHtml}
            </div>
            <div class="panel-list-item-actions snapshot-item-icons">
              <button type="button" class="wbs-icon-button" data-action="compare-snapshot" title="現在と比較">«</button>
              <button type="button" class="wbs-icon-button" data-action="restore-snapshot" title="この状態に復元">⟲</button>
              <button type="button" class="wbs-icon-button" data-action="delete-snapshot" title="削除">🗑</button>
            </div>
          </div>`;
        })
        .join("");
    }

    function applySnapshotPanel(bodyHtml) {
      document.getElementById("snapshotPanelBody").innerHTML = bodyHtml;
    }

    // 【前提】count はプロジェクトに紐づくスナップショットの件数（未選択時はnull）。
    // 【処理】見出し右側の件数表示（追加実装仕様書10章）を更新する。
    // 【結果】#snapshotCountBadgeの表示テキストが最新の件数に切り替わる。
    function updateSnapshotCountBadge(count) {
      document.getElementById("snapshotCountBadge").textContent = count === null ? "" : `${count}件`;
    }

    // 【前提】projectId はnull、または実在するプロジェクトのid。
    // 【処理】projectIdがnullなら空状態を表示し、そうでなければgetSnapshotsByProjectで
    //   取得して一覧を再描画する。
    // 【結果】スナップショットパネルの表示・件数表示が最新の状態に更新される。
    async function refreshSnapshotPanel(projectId) {
      if (!projectId) {
        applySnapshotPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        updateSnapshotCountBadge(null);
        return;
      }
      const snapshotList = await getSnapshotsByProject(projectId);
      applySnapshotPanel(renderSnapshotListToHtml(snapshotList, expandedSnapshotCompareIds, snapshotCompareResultsById));
      updateSnapshotCountBadge(snapshotList.length);
    }

    // 【前提】currentSelectedProjectId・currentProjectObjectが設定済みであること。
    // 【処理】名前をprompt()で受け取り（既定値：「{プロジェクト名} - {今日の日付}」、
    //   モーダル・ダイアログ一覧P2）、現在のプロジェクト情報＋スケジュール全件を
    //   dataとして保存する（データモデル設計3.8節：data={project, schedules}）。
    // 【結果】保存後、パネルを再描画し、トースト「スナップショットを保存しました」を
    //   表示する（詳細設計書3.8.3）。
    async function handleSaveSnapshotButtonClick() {
      if (!currentSelectedProjectId || !currentProjectObject) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const todayDateString = new Date().toISOString().slice(0, 10);
      const defaultName = `${currentProjectObject.name} - ${todayDateString}`;
      const snapshotName = window.prompt("スナップショット名を入力してください", defaultName);
      if (!snapshotName) return;
      await addSnapshot({
        id: generateId(),
        projectId: currentSelectedProjectId,
        name: snapshotName,
        createdAt: new Date().toISOString(),
        data: {
          project: currentProjectObject,
          schedules: currentScheduleTreeRows.map((row) => row.schedule),
        },
      });
      await refreshSnapshotPanel(currentSelectedProjectId);
      showToast("スナップショットを保存しました");
    }

    // 【前提】snapshotId は削除したいスナップショットのid。
    // 【処理】確認ダイアログ（モーダル・ダイアログ一覧C7：確認ダイアログのみ、成功トースト無し）
    //   の上でdeleteSnapshotする。
    // 【結果】確認OK時、削除してパネルを再描画する。
    async function handleDeleteSnapshotButtonClick(snapshotId) {
      if (!window.confirm("このスナップショットを削除しますか？")) return;
      await deleteSnapshot(snapshotId);
      await refreshSnapshotPanel(currentSelectedProjectId);
    }

    // 【既知の非対称仕様・意図的に忠実再現（改善しない）】
    //   通常のスケジュール追加・編集・削除は、保存の直後にrecordChangelogEntry/
    //   addChangelogEntryを呼ぶことで変更履歴（changelog）に自動的に記録される
    //   （例：handleScheduleModalSaveButtonClick、deleteScheduleCascade）。
    //   一方この関数は、現在のschedulesを全削除してスナップショット時点の内容を丸ごと
    //   書き戻す一括処理だが、changelogには一切記録しない。データ取込（applyOneImportItem）は
    //   1件ずつ保存する際に必ずrecordChangelogEntryも呼ぶため全件がログに残るが、復元は
    //   意図的にこの経路を通らない。これはお手本アプリの仕様として確認された非対称であり、
    //   「統一されていないバグ」ではなく「そのまま再現すべき仕様」として扱う。
    //   実現方法：addSchedule/deleteSchedule/addProjectはそもそも内部でchangelogへ書き込まない
    //   （書き込むかどうかは呼び出し側がrecordChangelogEntryを呼ぶか次第）。そのため
    //   「ログを経由しない一括書き換え」のための専用の低レベル関数やフラグ引数は不要で、
    //   この関数が既存のadd/delete関数をそのまま呼び、recordChangelogEntryを呼ばないだけで
    //   実現できる。
    //
    // 【前提】snapshot は復元対象のスナップショットオブジェクト（snapshot.data = {project, schedules}）。
    // 【処理】snapshot.projectIdの現在のschedules全件を削除し、snapshot.data.schedulesの内容を
    //   そのまま書き戻す（idはスナップショット時点のものを維持）。続けて、対象projectの
    //   startDate/endDate/milestonesのみをスナップショット時点の値に書き戻す（locked/createdAt等
    //   復元対象外のフィールドは現状を維持する）。
    //   【対象ストア外への影響（対応しない）】comments等、削除されるscheduleに紐づく他ストアの
    //   データはこの関数では一切触れない（対象ストアはschedules/projects/snapshotsのみと
    //   指定されているため）。孤立したコメントが残る可能性があるが、変更履歴の「戻す」機能に
    //   ある既知の非整合と同種のものとして今回は対応しない。
    // 【結果】DBが復元後の状態になる（画面更新・トースト表示は呼び出し側の責務）。
    async function restoreSnapshot(snapshot) {
      const currentSchedules = await getSchedulesByProject(snapshot.projectId);
      for (const schedule of currentSchedules) {
        await deleteSchedule(schedule.id);
      }
      for (const schedule of snapshot.data.schedules) {
        await addSchedule(schedule);
      }

      const projectList = await getAllProjects();
      const project = projectList.find((candidateProject) => candidateProject.id === snapshot.projectId);
      if (project) {
        await addProject({
          ...project,
          startDate: snapshot.data.project.startDate,
          endDate: snapshot.data.project.endDate,
          milestones: snapshot.data.project.milestones,
        });
      }
    }

    // 【前提】snapshotId は復元したいスナップショットのid。
    // 【処理】対象スナップショットを取得し、確認ダイアログの上でrestoreSnapshotする。
    // 【結果】確認OK時、DBが復元され、switchToProjectで画面一式（ガント・カンバン・
    //   マインドマップ・ロック状態）を再取得・再描画し、トースト「「{名前}」に復元しました」を
    //   表示する。キャンセル時は何もしない。
    async function handleRestoreSnapshotButtonClick(snapshotId) {
      const snapshotList = await getSnapshotsByProject(currentSelectedProjectId);
      const snapshot = snapshotList.find((candidateSnapshot) => candidateSnapshot.id === snapshotId);
      if (!snapshot) return;
      if (!window.confirm(`「${snapshot.name}」の状態に復元しますか？\n現在のスケジュールデータは上書きされます。`)) return;

      await restoreSnapshot(snapshot);
      await switchToProject(snapshot.projectId);
      await refreshSnapshotPanel(snapshot.projectId);
      showToast(`「${snapshot.name}」に復元しました`);
    }

    // 【前提】snapshotId は比較したいスナップショットのid。
    // 【処理】expandedSnapshotCompareIdsへの追加/削除だけをトグルする（基本設計書の指定どおり、
    //   もう一度押すと閉じる）。新たに展開する場合のみcompareSnapshotを計算してキャッシュに
    //   保持し、閉じる場合はキャッシュを破棄する（次に開いたときは最新のDB状態で再計算する）。
    // 【結果】パネルが再描画され、対象スナップショットの比較結果が表示/非表示になる。
    async function handleCompareSnapshotButtonClick(snapshotId) {
      if (expandedSnapshotCompareIds.has(snapshotId)) {
        expandedSnapshotCompareIds.delete(snapshotId);
        snapshotCompareResultsById.delete(snapshotId);
      } else {
        const snapshotList = await getSnapshotsByProject(currentSelectedProjectId);
        const snapshot = snapshotList.find((candidateSnapshot) => candidateSnapshot.id === snapshotId);
        if (!snapshot) return;
        const diffResult = await compareSnapshot(snapshot);
        expandedSnapshotCompareIds.add(snapshotId);
        snapshotCompareResultsById.set(snapshotId, diffResult);
      }
      await refreshSnapshotPanel(currentSelectedProjectId);
    }

