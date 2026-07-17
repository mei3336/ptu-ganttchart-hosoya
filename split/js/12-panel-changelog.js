    // ===== P6：変更履歴パネル =====

    // 現在のフィルタ（"all" | "add" | "edit" | "delete"）。
    let currentChangelogFilter = "all";
    // フィルタ切替時にDB再取得しないためのキャッシュ。
    let currentChangelogEntries = [];

    // 【前提】changes は1件分の変更履歴エントリが持つentry.changes（{field,label,before,after}の
    //   配列。diffFieldsの戻り値と同じ形）。
    // 【処理】UI差分表No.69：フィールドごとに「ラベル：旧値（取り消し線・赤）→新値（緑）」の
    //   行を組み立てる（お手本の.cl-old/.cl-new相当）。
    // 【結果】変更が無ければ空文字列、あれば一覧のHTML文字列を返す。
    function renderChangelogChangesToHtml(changes) {
      if (!changes || changes.length === 0) return "";
      const rowsHtml = changes
        .map(
          (change) => `<div class="changelog-change-row">
            <span class="changelog-field-label">${escapeHtmlText(change.label)}：</span>
            <span class="cl-old">${escapeHtmlText(String(change.before ?? ""))}</span>
            <span class="changelog-change-arrow">→</span>
            <span class="cl-new">${escapeHtmlText(String(change.after ?? ""))}</span>
          </div>`
        )
        .join("");
      return `<div class="changelog-changes-list">${rowsHtml}</div>`;
    }

    // 【前提】changelogEntries は同一プロジェクト内の変更履歴全件。filter は
    //   "all" | "add" | "edit" | "delete"。
    // 【処理】filterが"all"以外ならactionで絞り込み、記録日時の降順（新しい順）に並べて、
    //   操作種別バッジ・対象名・記録日時のHTML文字列を組み立てる。削除ログのみ「戻す」
    //   ボタンを添える（基本設計書8.1節：削除ログのみ戻すボタンあり）。「変更」ログは
    //   renderChangelogChangesToHtmlでフィールドごとの新旧値も表示する（UI差分表No.69）。
    // 【結果】changelogPanelBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderChangelogEntriesToHtml(changelogEntries, filter) {
      const filteredEntries = changelogEntries
        .filter((entry) => filter === "all" || entry.action === filter)
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (filteredEntries.length === 0) {
        return '<p class="empty-state-message">変更履歴がありません。</p>';
      }
      const actionLabels = { add: "追加", edit: "変更", delete: "削除" };
      return filteredEntries
        .map((entry) => {
          const actionLabel = actionLabels[entry.action] || entry.action;
          const restoreButtonHtml = entry.action === "delete"
            ? `<button type="button" class="panel-add-button" data-action="restore-log" title="この状態に戻す">戻す</button>`
            : "";
          return `<div class="panel-list-item" data-entry-id="${escapeHtmlText(entry.id)}">
            <div class="panel-list-item-main">
              <span class="changelog-action-badge is-${escapeHtmlText(entry.action)}">${escapeHtmlText(actionLabel)}</span>
              ${escapeHtmlText(entry.storeLabel)}「${escapeHtmlText(entry.itemName)}」
              <div class="panel-list-item-meta">${escapeHtmlText(entry.createdAt)}</div>
              ${renderChangelogChangesToHtml(entry.changes)}
            </div>
            <div class="panel-list-item-actions">${restoreButtonHtml}</div>
          </div>`;
        })
        .join("");
    }

    function applyChangelogPanel(bodyHtml) {
      document.getElementById("changelogPanelBody").innerHTML = bodyHtml;
    }

    // 【前提】changelogEntries は同一プロジェクト内の変更履歴全件（フィルタで絞り込む前）。
    // 【処理】action別の件数を数える（基本設計書8.1節：フィルタ下に全件数の内訳を表示する）。
    //   フィルタタブの選択状態に関わらず、常に全件での内訳を示す。
    // 【結果】「全{n}件（追加{n}・変更{n}・削除{n}）」の文字列を返す。
    function renderChangelogSummaryToHtml(changelogEntries) {
      const addCount = changelogEntries.filter((entry) => entry.action === "add").length;
      const editCount = changelogEntries.filter((entry) => entry.action === "edit").length;
      const deleteCount = changelogEntries.filter((entry) => entry.action === "delete").length;
      return `全${changelogEntries.length}件（追加${addCount}・変更${editCount}・削除${deleteCount}）`;
    }

    function applyChangelogSummary(summaryText) {
      document.getElementById("changelogSummary").textContent = summaryText;
    }

    // 【前提】projectId はnull、または実在するプロジェクトのid。
    // 【処理】getChangelogByProjectで取得してcurrentChangelogEntriesにキャッシュし、
    //   現在のフィルタで一覧を、フィルタに関わらず全件の内訳をサマリーとして描画する。
    // 【結果】変更履歴パネルの表示が最新の状態に更新される。
    async function refreshChangelogPanel(projectId) {
      if (!projectId) {
        applyChangelogSummary("");
        applyChangelogPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        return;
      }
      currentChangelogEntries = await getChangelogByProject(projectId);
      applyChangelogSummary(renderChangelogSummaryToHtml(currentChangelogEntries));
      applyChangelogPanel(renderChangelogEntriesToHtml(currentChangelogEntries, currentChangelogFilter));
    }

    // 【前提】currentSelectedProjectId・currentChangelogEntriesが設定済みであること。
    // 【処理】0件なら案内のみ表示して終了する。1件以上あれば件数を明示した確認ダイアログの上で
    //   clearChangelogByProjectする（詳細設計書3.6.3）。
    // 【結果】確認OK時、このプロジェクトの変更履歴がすべて削除され、パネルが再描画される。
    async function handleClearChangelogButtonClick() {
      if (currentChangelogEntries.length === 0) {
        showToast("履歴がありません");
        return;
      }
      if (!window.confirm(`${currentChangelogEntries.length}件の変更履歴を削除しますか？`)) return;
      await clearChangelogByProject(currentSelectedProjectId);
      showToast("変更履歴を削除しました");
      await refreshChangelogPanel(currentSelectedProjectId);
    }

    // 【前提】filter は "all" | "add" | "edit" | "delete"。buttonElement はクリックされたボタン。
    // 【処理】フィルタを切り替え、ボタンの選択状態を更新した上で、キャッシュ済み
    //   currentChangelogEntriesを使ってパネルだけを再描画する（DB再取得は不要）。
    // 【結果】変更履歴パネルの表示が新しいフィルタの内容になる。
    function handleChangelogFilterClick(filter, buttonElement) {
      currentChangelogFilter = filter;
      for (const tabButton of document.querySelectorAll("#changelogFilterTabs [data-changelog-filter]")) {
        tabButton.classList.toggle("is-active", tabButton === buttonElement);
      }
      applyChangelogPanel(renderChangelogEntriesToHtml(currentChangelogEntries, currentChangelogFilter));
    }

    // 【前提】entryId は「戻す」を押された変更履歴エントリのid（currentChangelogEntriesに
    //   含まれること。削除ログのみボタンが表示されるため、通常はaction==="delete"）。
    // 【処理】確認の上、entry.snapshot（削除直前の全フィールドのコピー）をentry.storeに
    //   応じたadd*関数でそのまま書き戻す（データモデル設計6章：snapshotは削除時点の
    //   完全なコピーのため、putし直せば元の状態に戻る）。復元操作自体は新たな変更履歴として
    //   記録しない（「戻す」を繰り返すたびにログが増え続けるのを防ぐため）。この単純な
    //   書き戻しには限界があり、連鎖削除で一緒に消えた子スケジュール・コメント等の
    //   関連データまでは復元しない（単一レコードの復元に留まる、既知の非整合）。
    // 【結果】snapshotが無ければ案内のみ表示し何もしない。復元後は対象パネルと
    //   変更履歴パネルを再描画する。
    async function handleRestoreFromLogButtonClick(entryId) {
      const entry = currentChangelogEntries.find((changelogEntry) => changelogEntry.id === entryId);
      if (!entry) return;
      if (!entry.snapshot) {
        showToast("復元データがありません");
        return;
      }
      if (!window.confirm(`「${entry.itemName}」（${entry.storeLabel}）をこの時点の状態に戻しますか？`)) return;

      if (entry.store === "projects") {
        await addProject(entry.snapshot);
        await refreshProjectSelectDropdown();
      } else if (entry.store === "schedules") {
        await addSchedule(entry.snapshot);
        await refreshGanttPanel(currentSelectedProjectId);
      } else if (entry.store === "tasks") {
        await addTask(entry.snapshot);
        await refreshKanbanPanel(currentSelectedProjectId);
      } else if (entry.store === "issues") {
        await addIssue(entry.snapshot);
        await refreshMindmapPanel(currentSelectedProjectId);
      }
      showToast(`「${entry.itemName}」を復元しました`);
      await refreshChangelogPanel(currentSelectedProjectId);
    }

    // refreshGanttPanelと同じ考え方。対象はissues・マインドマップキャンバス。
    // 【設計判断：ルートノード＝プロジェクト名（追加実装仕様書8.2節）】
    //   issueが1件も無い場合、固定文字列ではなく現在のプロジェクト名をタイトルとするルート
    //   ノードを自動生成する。プロジェクト情報が参照できない場合のみ「メインテーマ」に
    //   フォールバックする（8.2節に明記の通り）。
    async function refreshMindmapPanel(projectId) {
      if (!projectId) {
        applyMindmapPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        return;
      }
      let issueList = await getIssuesByProject(projectId);
      if (issueList.length === 0) {
        const rootIssue = {
          id: generateId(),
          projectId,
          title: currentProjectObject?.name || "メインテーマ",
          parentNodeId: null,
          x: MINDMAP_LAYOUT_BASE_X,
          y: MINDMAP_LAYOUT_BASE_Y,
          color: MINDMAP_NODE_COLORS[0],
          order: 0,
        };
        await addIssue(rootIssue);
        issueList = [rootIssue];
      }
      applyMindmapPanel(renderMindmapCanvasToHtml(issueList, collapsedMindmapIssueIds, mindmapIssueIdPendingInlineEdit, mindmapZoomLevel));
      attachMindmapInlineEditInputEvents();
    }

    // 【前提】projectId はnull、または実在するプロジェクトのid。
    // 【処理】現在選択中のプロジェクトを切り替え、そのプロジェクトの最新データを取得してから、
    //   3パネル（ガント・カンバン・マインドマップ）とロック状態表示をまとめて更新する。
    // 【結果】currentSelectedProjectId・currentProjectObjectが更新され、画面全体が新しい
    //   プロジェクトのものになる。
    async function switchToProject(projectId) {
      currentSelectedProjectId = projectId || null;
      if (currentSelectedProjectId) {
        const projectList = await getAllProjects();
        currentProjectObject = projectList.find((project) => project.id === currentSelectedProjectId) || null;
      } else {
        currentProjectObject = null;
      }
      applyLockState(Boolean(currentProjectObject?.locked));
      applyReportButtonAvailability(Boolean(currentSelectedProjectId));
      // プロジェクトが変われば見ているマインドマップも別物になるため、前のプロジェクトの
      // ズーム倍率を引き継がない（追加実装仕様書8.3節：画面フィットのズーム状態はプロジェクト
      // ごとにリセットする）。
      mindmapZoomLevel = 1;
      await Promise.all([
        refreshGanttPanel(currentSelectedProjectId),
        refreshKanbanPanel(currentSelectedProjectId),
        refreshMindmapPanel(currentSelectedProjectId),
      ]);
    }

    // 【前提】panelId はスライドパネル要素のid（例："kanbanSlidePanel"）。
    // 【処理】.is-openクラスの有無で開閉を反転させる（モーダル・ダイアログ一覧②：
    //   ボタンをもう一度押すと閉じる、という共通挙動）。
    // 【結果】パネルが開いていれば閉じ、閉じていれば開く。
    function toggleSlidePanel(panelId) {
      document.getElementById(panelId).classList.toggle("is-open");
    }

    // 【前提】panelId はスライドパネル要素のid。
    // 【処理】.is-openクラスを外す（×ボタンから閉じる用。開閉トグルではなく必ず閉じる）。
    // 【結果】パネルが閉じる。
    function closeSlidePanel(panelId) {
      document.getElementById(panelId).classList.remove("is-open");
    }

