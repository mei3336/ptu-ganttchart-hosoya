    // 【前提】DOMの構築が完了していること（DOMContentLoaded後に呼ばれる想定）。
    // 【処理】各ボタン・<select>にイベントを登録し、プロジェクト一覧を取得して
    //   先頭のプロジェクトを初期選択状態にする。
    // 【結果】画面を開いた直後から、先頭プロジェクトのデータが3パネルに表示された状態になる
    //   （プロジェクトが1件も無い場合は空状態表示のまま）。
    async function initializeApp() {
      initializePanelResizeHandles();
      document.addEventListener("pointerdown", handlePanelResizePointerDown);
      document.addEventListener("pointermove", handlePanelResizePointerMove);
      document.addEventListener("pointerup", handlePanelResizePointerUp);
      document.getElementById("projectSelectDropdown").addEventListener("change", (event) => {
        switchToProject(event.target.value || null);
      });
      document.getElementById("createProjectButton").addEventListener("click", handleCreateProjectButtonClick);
      // 追加実装仕様書2.1節：空状態画面の「＋最初のプロジェクトを作成」ボタンも、
      // ヘッダーの「＋新規プロジェクト」と同じM1モーダルを開く。
      document.getElementById("createFirstProjectButton").addEventListener("click", handleCreateProjectButtonClick);
      document.getElementById("exportDataButton").addEventListener("click", handleExportDataButtonClick);
      document.getElementById("importDataButton").addEventListener("click", () => {
        document.getElementById("importFileInput").click();
      });
      document.getElementById("importFileInput").addEventListener("change", (event) => {
        handleImportFileInputChange(event.target);
      });
      document.getElementById("exportPdfButton").addEventListener("click", exportPDF);
      document.getElementById("exportExcelButton").addEventListener("click", exportExcel);
      document.getElementById("deleteProjectButton").addEventListener("click", handleDeleteProjectButtonClick);
      document.getElementById("addScheduleButton").addEventListener("click", handleAddScheduleButtonClick);
      document.getElementById("addIssueButton").addEventListener("click", handleAddIssueButtonClick);
      document.getElementById("mindmapFitViewButton").addEventListener("click", handleMindmapFitViewButtonClick);
      // マインドマップのノードドラッグ。pointerdownは各ノードへのイベント委譲、
      // pointermove/pointerupはドラッグ中にポインタがノード外へ出ても追従できるようdocument側で拾う。
      document.getElementById("mindmapPanelBody").addEventListener("pointerdown", (event) => {
        // 追加実装仕様書8.1節：インライン編集中の<input>内でのクリックは、ドラッグ開始とは
        // 別物として扱う（ここでreturnしないと、入力欄をクリックした瞬間にドラッグが始まり
        // フォーカス・テキスト選択ができなくなる）。
        if (event.target.closest(".mindmap-inline-edit-input")) return;
        const node = event.target.closest(".mindmap-node");
        if (!node) return;
        handleMindmapNodePointerDown(event, node.dataset.issueId, node);
      });
      document.addEventListener("pointermove", handleMindmapNodePointerMove);
      document.addEventListener("pointerup", handleMindmapNodePointerUp);
      // ガントバーのドラッグによる日程変更。掴んだ場所（掴み手か本体か）でモードを決める
      // （マインドマップと同じ理由でpointermove/pointerupはdocument側で拾う）。
      document.getElementById("ganttPanelBody").addEventListener("pointerdown", (event) => {
        const barElement = event.target.closest(".gantt-bar[data-schedule-id]");
        if (!barElement) {
          // UI差分表No.42：バー・掴み手のどちらにも当たらなかった場合だけ背景ドラッグを開始する
          // （既存のバー操作とは完全に排他）。
          handleGanttBackgroundPointerDown(event);
          return;
        }
        const handleElement = event.target.closest(".gantt-bar-handle");
        const mode = handleElement ? handleElement.dataset.dragMode : "move";
        handleBarPointerDown(event, barElement.dataset.scheduleId, mode, barElement);
      });
      document.addEventListener("pointermove", handleBarPointerMove);
      document.addEventListener("pointerup", handleBarPointerUp);
      document.addEventListener("pointermove", handleGanttBackgroundPointerMove);
      document.addEventListener("pointerup", handleGanttBackgroundPointerUp);
      // ガントバー直接クリックの軽量ポップアップ（UI差分表No.75）。pointerup直後に発火する
      // clickイベントで開く。実際にドラッグした場合（wasBarPointerMovedSignificantly）は
      // 開かない。
      document.getElementById("ganttPanelBody").addEventListener("click", (event) => {
        const barElement = event.target.closest(".gantt-bar[data-schedule-id]");
        if (!barElement) return;
        if (wasBarPointerMovedSignificantly) {
          wasBarPointerMovedSignificantly = false;
          return;
        }
        openTaskPopup(barElement.dataset.scheduleId, event.clientX, event.clientY);
      });
      // ポップアップの外側をクリックしたら閉じる（別のバーをクリックした場合は、そちらの
      // ハンドラが新しい内容で開き直すため、ここでは閉じない）。
      document.addEventListener("click", (event) => {
        const popupElement = document.getElementById("taskPopup");
        if (popupElement.hidden) return;
        if (popupElement.contains(event.target)) return;
        if (event.target.closest(".gantt-bar")) return;
        closeTaskPopup();
      });
      // ポップアップ内の閉じる・投稿・削除ボタン（コメント欄はinnerHTML再構築を経るため、
      // #taskPopup自体に1回だけイベント委譲で登録する）。
      document.getElementById("taskPopup").addEventListener("click", (event) => {
        if (event.target.id === "taskPopupCloseButton") {
          closeTaskPopup();
          return;
        }
        if (event.target.id === "taskPopupPostCommentButton") {
          handlePostTaskPopupCommentButtonClick();
          return;
        }
        const deleteButton = event.target.closest('[data-action="delete-task-popup-comment"]');
        if (deleteButton) {
          const item = deleteButton.closest("[data-comment-id]");
          if (item) handleDeleteTaskPopupCommentButtonClick(item.dataset.commentId);
        }
      });
      // マインドマップの右クリックメニュー。
      document.getElementById("mindmapPanelBody").addEventListener("contextmenu", (event) => {
        const node = event.target.closest(".mindmap-node");
        if (!node) return;
        event.preventDefault();
        openMindmapContextMenu(node.dataset.issueId, event.clientX, event.clientY);
      });
      document.getElementById("mindmapContextMenu").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (button) handleMindmapContextMenuAction(button.dataset.action);
      });
      // メニューの外側をクリック、またはEscapeキーで閉じる。
      document.addEventListener("click", (event) => {
        const menuElement = document.getElementById("mindmapContextMenu");
        if (!menuElement.hidden && !menuElement.contains(event.target)) {
          closeMindmapContextMenu();
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMindmapContextMenu();
      });
      document.getElementById("closeKanbanPanelButton").addEventListener("click", () => {
        closeSlidePanel("kanbanSlidePanel");
        document.getElementById("switchToKanbanButton").classList.remove("is-active");
      });
      // カンバンの埋め込み追加フォーム・削除ボタン・完了済み一括削除ボタンは
      // kanbanPanelBodyのinnerHTMLごと再生成されるため、個々のボタンではなく
      // 親要素にイベント委譲する。
      document.getElementById("kanbanPanelBody").addEventListener("click", (event) => {
        const submitButton = event.target.closest(".kanban-add-submit-button");
        if (submitButton) {
          handleKanbanAddFormSubmit(submitButton.closest(".kanban-add-form"));
          return;
        }
        const openFormButton = event.target.closest(".kanban-add-toggle-button");
        if (openFormButton) {
          handleOpenKanbanAddFormButtonClick(openFormButton.dataset.columnStatus);
          return;
        }
        const cancelFormButton = event.target.closest(".kanban-add-cancel-button");
        if (cancelFormButton) {
          handleCloseKanbanAddFormButtonClick();
          return;
        }
        const deleteButton = event.target.closest('[data-action="delete-task"]');
        if (deleteButton) {
          const card = deleteButton.closest("[data-task-id]");
          if (card) handleDeleteTaskButtonClick(card.dataset.taskId);
          return;
        }
        const editArea = event.target.closest('[data-action="edit-task"]');
        if (editArea) {
          const card = editArea.closest("[data-task-id]");
          if (card) handleOpenTaskEditModalClick(card.dataset.taskId);
          return;
        }
        if (event.target.id === "clearDoneTasksButton") handleClearDoneTasksButtonClick();
      });
      // 追加実装仕様書6.1節：追加フォームのタイトル入力欄でEnter＝追加確定、Escape＝キャンセル
      // （お手本ganttforge.htmlのkbNewTitle onkeydownと同じ挙動）。
      document.getElementById("kanbanPanelBody").addEventListener("keydown", (event) => {
        if (!event.target.classList.contains("kanban-add-title-input")) return;
        if (event.key === "Enter") {
          handleKanbanAddFormSubmit(event.target.closest(".kanban-add-form"));
        } else if (event.key === "Escape") {
          handleCloseKanbanAddFormButtonClick();
        }
      });
      // ドラッグ＆ドロップによる列間の移動（WBS行の並び替えと同じPointer/HTML5 Drag &
      // Drop APIの使い分け方針：カンバンも離散的な移動先＝列単位のため、こちらもHTML5
      // draggableを使う。ドロップ先はカード単体ではなく列全体＝data-column-statusを持つ
      // .kanban-columnで判定する）。
      document.getElementById("kanbanPanelBody").addEventListener("dragstart", (event) => {
        const draggedCard = event.target.closest(".kanban-card[data-task-id]");
        if (!draggedCard) return;
        draggedTaskId = draggedCard.dataset.taskId;
        event.dataTransfer.effectAllowed = "move";
        // UI差分表No.60：ドラッグ中の視覚フィードバック。マインドマップノードの
        // is-draggingクラスと同じ考え方（見た目だけの一時クラス、dragendで必ず外す）。
        draggedCard.classList.add("is-dragging");
      });
      document.getElementById("kanbanPanelBody").addEventListener("dragend", (event) => {
        const draggedCard = event.target.closest(".kanban-card[data-task-id]");
        if (draggedCard) draggedCard.classList.remove("is-dragging");
      });
      document.getElementById("kanbanPanelBody").addEventListener("dragover", (event) => {
        if (event.target.closest(".kanban-column[data-column-status]")) event.preventDefault();
      });
      document.getElementById("kanbanPanelBody").addEventListener("drop", (event) => {
        const targetColumn = event.target.closest(".kanban-column[data-column-status]");
        if (!targetColumn || !draggedTaskId) return;
        event.preventDefault();
        handleTaskDragDrop(draggedTaskId, targetColumn.dataset.columnStatus);
        draggedTaskId = null;
      });
      document.getElementById("lockToggleButton").addEventListener("click", handleLockToggleButtonClick);
      document.getElementById("todayButton").addEventListener("click", handleTodayButtonClick);
      document.getElementById("wbsPanel").addEventListener("scroll", handleWbsPanelVerticalScroll);
      document.querySelector(".gantt-scroll-area").addEventListener("scroll", handleGanttScrollAreaVerticalScroll);
      document.getElementById("toggleAllScheduleRowsButton").addEventListener("click", handleToggleAllScheduleRowsButtonClick);
      for (const granularityButton of document.querySelectorAll("[data-granularity]")) {
        granularityButton.addEventListener("click", () => handleGranularityButtonClick(granularityButton.dataset.granularity, granularityButton));
      }
      document.getElementById("toggleColumnStartDateButton").addEventListener("click", (event) => handleToggleColumnClick("startDate", event.currentTarget));
      document.getElementById("toggleColumnEndDateButton").addEventListener("click", (event) => handleToggleColumnClick("endDate", event.currentTarget));
      document.getElementById("toggleColumnStatusButton").addEventListener("click", (event) => handleToggleColumnClick("status", event.currentTarget));
      document.getElementById("switchToKanbanButton").addEventListener("click", handleSwitchToKanbanButtonClick);
      for (const outOfScopeButton of document.querySelectorAll("[data-out-of-scope-label]")) {
        outOfScopeButton.addEventListener("click", handleOutOfScopeButtonClick);
      }
      document.getElementById("editProjectButton").addEventListener("click", handleEditProjectButtonClick);
      document.getElementById("milestoneButton").addEventListener("click", openMilestoneModal);
      // モーダル外側（オーバーレイ自身）をクリックしたときだけ閉じる
      // （モーダル・ダイアログ一覧2.3節：「モーダル外側をクリックすると閉じる」）。
      document.getElementById("modalOverlay").addEventListener("click", (event) => {
        if (event.target.id === "modalOverlay") closeModal();
      });
      // WBSパネルのクリックをイベント委譲でまとめて扱う（wbsPanelの中身はrefreshGanttPanelの
      // たびに丸ごと再生成されるため、個々の行・アイコンではなく親要素にリスナーを1つだけ持たせる）。
      // ホバーアイコン（.wbs-icon-button）のクリックを先に判定し、該当すればそちらだけを
      // 処理してreturnする（アイコンは行の内側にあるため、判定を後回しにすると行クリックの
      // 編集モーダルも同時に開いてしまう＝二重発火を避けるための順序）。
      document.getElementById("wbsPanel").addEventListener("click", (event) => {
        const iconButton = event.target.closest(".wbs-icon-button");
        if (iconButton) {
          if (iconButton.disabled) return;
          const iconRow = iconButton.closest(".wbs-row[data-schedule-id]");
          if (iconRow) handleWbsRowIconClick(iconButton.dataset.action, iconRow.dataset.scheduleId);
          return;
        }
        const clickedRow = event.target.closest(".wbs-row[data-schedule-id]");
        if (clickedRow) handleWbsRowClick(clickedRow.dataset.scheduleId);
      });
      // ドラッグ＆ドロップによる並び替え（上下矢印ボタンと併用。同じ兄弟グループ内のみ有効
      // ＝handleScheduleDragDrop側でparentId一致を判定する）。
      document.getElementById("wbsPanel").addEventListener("dragstart", (event) => {
        const draggedRow = event.target.closest(".wbs-row[data-schedule-id]");
        if (!draggedRow) return;
        draggedScheduleId = draggedRow.dataset.scheduleId;
        event.dataTransfer.effectAllowed = "move";
      });
      document.getElementById("wbsPanel").addEventListener("dragover", (event) => {
        // ドロップを許可するにはdragoverでpreventDefault()が必須（ブラウザの既定動作）。
        if (event.target.closest(".wbs-row[data-schedule-id]")) event.preventDefault();
      });
      document.getElementById("wbsPanel").addEventListener("drop", (event) => {
        const targetRow = event.target.closest(".wbs-row[data-schedule-id]");
        if (!targetRow || !draggedScheduleId) return;
        event.preventDefault();
        handleScheduleDragDrop(draggedScheduleId, targetRow.dataset.scheduleId);
        draggedScheduleId = null;
      });

      // P2〜P7：右側スライドパネルの開閉配線。6パネルとも「ボタンでトグル開閉・
      // 開いた瞬間に最新データへ再描画・×ボタンで必ず閉じる」という共通の挙動のため、
      // 定義テーブル1つと共通のwire関数にまとめる（P1タスク管理は既存の専用ハンドラの
      // ままとし、ここでは触れない）。
      const SIDE_PANEL_DEFINITIONS = [
        { panelId: "snapshotSlidePanel", buttonId: "snapshotButton", closeButtonId: "closeSnapshotPanelButton", onOpen: () => refreshSnapshotPanel(currentSelectedProjectId) },
        { panelId: "quickMemoSlidePanel", buttonId: "quickMemoButton", closeButtonId: "closeQuickMemoPanelButton", onOpen: () => refreshQuickMemoPanel(currentSelectedProjectId) },
        { panelId: "memoSlidePanel", buttonId: "memoButton", closeButtonId: "closeMemoPanelButton", onOpen: () => refreshMemoPanel(currentSelectedProjectId) },
        { panelId: "commentSlidePanel", buttonId: "commentButton", closeButtonId: "closeCommentPanelButton", onOpen: () => refreshCommentPanel(currentSelectedProjectId) },
        { panelId: "changelogSlidePanel", buttonId: "changelogButton", closeButtonId: "closeChangelogPanelButton", onOpen: () => refreshChangelogPanel(currentSelectedProjectId) },
        { panelId: "mindmapSlidePanel", buttonId: "switchToMindmapButton", closeButtonId: "closeMindmapPanelButton", onOpen: () => refreshMindmapPanel(currentSelectedProjectId) },
      ];
      for (const definition of SIDE_PANEL_DEFINITIONS) {
        document.getElementById(definition.buttonId).addEventListener("click", () => {
          toggleSlidePanel(definition.panelId);
          const isOpen = document.getElementById(definition.panelId).classList.contains("is-open");
          document.getElementById(definition.buttonId).classList.toggle("is-active", isOpen);
          if (isOpen) definition.onOpen();
        });
        document.getElementById(definition.closeButtonId).addEventListener("click", () => {
          closeSlidePanel(definition.panelId);
          document.getElementById(definition.buttonId).classList.remove("is-active");
        });
      }

      // P2：スナップショットの保存・削除・復元・比較（いずれもイベント委譲。パネルはrefreshの
      // たびに再生成されるため）。
      document.getElementById("saveSnapshotButton").addEventListener("click", handleSaveSnapshotButtonClick);
      document.getElementById("snapshotPanelBody").addEventListener("click", (event) => {
        const item = event.target.closest("[data-snapshot-id]");
        if (!item) return;
        if (event.target.closest('[data-action="delete-snapshot"]')) {
          handleDeleteSnapshotButtonClick(item.dataset.snapshotId);
          return;
        }
        if (event.target.closest('[data-action="restore-snapshot"]')) {
          handleRestoreSnapshotButtonClick(item.dataset.snapshotId);
          return;
        }
        if (event.target.closest('[data-action="compare-snapshot"]')) {
          handleCompareSnapshotButtonClick(item.dataset.snapshotId);
        }
      });

      // P3：即時メモの投稿（クリック・Ctrl+Enter）・削除（イベント委譲）。
      document.getElementById("postQuickMemoButton").addEventListener("click", handlePostQuickMemoButtonClick);
      document.getElementById("clearQuickMemosButton").addEventListener("click", handleClearQuickMemosButtonClick);
      document.getElementById("quickMemoTextInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.ctrlKey) handlePostQuickMemoButtonClick();
      });
      document.getElementById("quickMemoPanelBody").addEventListener("click", (event) => {
        const deleteButton = event.target.closest('[data-action="delete-quick-memo"]');
        if (!deleteButton) return;
        const item = deleteButton.closest("[data-quick-memo-id]");
        if (item) handleDeleteQuickMemoButtonClick(item.dataset.quickMemoId);
      });

      // P4：メモの新規作成・選択・削除（一覧側）・自動保存（編集エリア側、blurで発火）。
      document.getElementById("createMemoButton").addEventListener("click", handleCreateMemoButtonClick);
      document.getElementById("memoListBody").addEventListener("click", (event) => {
        const deleteButton = event.target.closest('[data-action="delete-memo"]');
        if (deleteButton) {
          const item = deleteButton.closest("[data-memo-id]");
          if (item) handleDeleteMemoButtonClick(item.dataset.memoId);
          return;
        }
        const selectItem = event.target.closest('[data-action="select-memo"]');
        if (selectItem) handleSelectMemoButtonClick(selectItem.dataset.memoId);
      });
      // 編集エリアはrefreshMemoPanelのたびに再生成されるため、フォーカスアウトの委譲は
      // キャプチャフェーズ（blurはバブリングしないため）で親要素に持たせる。
      document.getElementById("memoEditorBody").addEventListener(
        "blur",
        (event) => {
          if (event.target.id === "memoEditorTitleInput" || event.target.id === "memoEditorBodyTextarea") {
            handleMemoEditorFieldBlur();
          }
        },
        true
      );
      // 追加実装仕様書9.2節：編集／プレビュー／分割タブの切り替え。
      document.getElementById("memoEditorBody").addEventListener("click", (event) => {
        const tabButton = event.target.closest("[data-memo-tab]");
        if (!tabButton) return;
        handleMemoEditorTabButtonClick(tabButton.dataset.memoTab);
      });

      // P5：コメントの投稿・削除・グループ開閉（イベント委譲。パネルは再描画のたびに
      //   作り直されるため）。
      document.getElementById("commentPanelBody").addEventListener("click", (event) => {
        if (event.target.id === "postCommentButton") {
          handlePostCommentButtonClick();
          return;
        }
        const deleteButton = event.target.closest('[data-action="delete-comment"]');
        if (deleteButton) {
          const item = deleteButton.closest("[data-comment-id]");
          if (item) handleDeleteCommentButtonClick(item.dataset.commentId);
          return;
        }
        const toggleHeading = event.target.closest('[data-action="toggle-comment-group"]');
        if (toggleHeading) handleToggleCommentGroupButtonClick(toggleHeading.dataset.scheduleId);
      });

      // P6：変更履歴のフィルタタブ・全削除ボタン・「戻す」ボタン（後者2つはイベント委譲。
      //   パネルはフィルタ切替や復元のたびに作り直されるため）。
      for (const filterButton of document.querySelectorAll("#changelogFilterTabs [data-changelog-filter]")) {
        filterButton.addEventListener("click", () => handleChangelogFilterClick(filterButton.dataset.changelogFilter, filterButton));
      }
      document.getElementById("clearChangelogButton").addEventListener("click", handleClearChangelogButtonClick);
      document.getElementById("changelogPanelBody").addEventListener("click", (event) => {
        const restoreButton = event.target.closest('[data-action="restore-log"]');
        if (!restoreButton) return;
        const item = restoreButton.closest("[data-entry-id]");
        if (item) handleRestoreFromLogButtonClick(item.dataset.entryId);
      });

      const projectList = await getAllProjects();
      await refreshProjectSelectDropdown();
      const firstProjectId = projectList.length > 0 ? projectList[0].id : null;
      document.getElementById("projectSelectDropdown").value = firstProjectId || "";
      await switchToProject(firstProjectId);
    }

    // Node.js等、windowが存在しない環境（自動テスト）でこのスクリプトを評価しても
    // 起動処理が実行されないようにするガード（この関数群を純粋関数として単体テストするため）。
    if (typeof window !== "undefined") {
      window.addEventListener("DOMContentLoaded", initializeApp);
    }
