    // ===== UI：DOM反映（薄い関数） =====
    // 【設計判断】以下は「HTML文字列を対応する要素のinnerHTMLへ入れるだけ」の薄い関数に留める。
    //   ロジック（何を表示するか）は上の純粋関数側に寄せ、ここでは判断を持たせない。

    function applyProjectSelectOptions(optionsHtml) {
      document.getElementById("projectSelectDropdown").innerHTML = optionsHtml;
    }

    function applyWbsPanel(bodyHtml) {
      document.getElementById("wbsPanel").innerHTML = bodyHtml;
    }

    function applyGanttPanel(bodyHtml) {
      document.getElementById("ganttPanelBody").innerHTML = bodyHtml;
    }

    function applyKanbanPanel(bodyHtml) {
      document.getElementById("kanbanPanelBody").innerHTML = bodyHtml;
    }

    function applyMindmapPanel(bodyHtml) {
      document.getElementById("mindmapPanelBody").innerHTML = bodyHtml;
    }

    // 【前提】isLocked は現在のプロジェクトのロック状態。
    // 【処理】ロック帯の表示・スケジュール追加／マイルストーンボタンの活性状態・
    //   ロックボタンの選択状態・プロジェクト削除ボタンの表示有無をまとめて切り替える
    //   （基本設計書3.3節：ロック中は「スケジュール追加」「マイルストーン」ボタンが
    //   淡色化・無効化され、プロジェクト削除ボタンは非表示になる）。
    // 【結果】画面上のロック関連の見た目が状態に一致する。
    function applyLockState(isLocked) {
      document.getElementById("lockBand").hidden = !isLocked;
      document.getElementById("addScheduleButton").disabled = isLocked;
      document.getElementById("milestoneButton").disabled = isLocked;
      document.getElementById("lockToggleButton").classList.toggle("is-active", isLocked);
      document.getElementById("deleteProjectButton").hidden = isLocked;
    }

    // 【前提】hasSelectedProject は現在プロジェクトが選択されているか。
    // 【処理】PDF出力・Excel出力ボタンのdisabledを切り替える（基本設計書2.1：
    //   「PDF出力・Excel出力：プロジェクト未選択時は使用不可（活性制御が必要）」）。
    // 【結果】選択されていればdisabledを外し、されていなければdisabledにする。
    function applyReportButtonAvailability(hasSelectedProject) {
      document.getElementById("exportPdfButton").disabled = !hasSelectedProject;
      document.getElementById("exportExcelButton").disabled = !hasSelectedProject;
    }

    // ===== UI：統括（データ取得→純粋関数→DOM反映のつなぎ） =====

    // 【前提】なし（常に全プロジェクトを取得する。projectsはインデックス無し＝常に全件表示の設計のため）。
    // 【処理】getAllProjectsで最新の一覧を取得し、現在選択中のprojectIdを選択状態にして<select>へ反映する。
    // 【結果】<select>の中身が最新のプロジェクト一覧に更新される。
    async function refreshProjectSelectDropdown() {
      const projectList = await getAllProjects();
      applyProjectSelectOptions(renderProjectOptionsToHtml(projectList, currentSelectedProjectId));
    }

    // 【前提】currentProjectObject・currentScheduleTreeRowsが設定済みであること。
    // 【処理】DBへ再度問い合わせず、キャッシュ済みcurrentScheduleTreeRowsと現在の折りたたみ・
    //   列表示・表示粒度の状態だけを使って、WBSパネル・ガント本体の両方を再描画する。
    //   行の折りたたみ切替のように「DBの中身は変わっていないが見た目の状態だけ変わった」
    //   場面で使う（DB再取得を伴うrefreshGanttPanelと役割を分ける）。
    //   「全て開く／全て閉じる」ボタンのラベルも、毎回areAllParentRowsCollapsedで判定し直して
    //   更新する（対応表No.39：クリック時だけでなく画面描画のたびに実際の状態を見るお手本の
    //   方式に合わせる。個別行を手動開閉した場合でもラベルと実際の状態が食い違わないようにする
    //   ため）。
    // 【結果】WBS・ガント両パネルの表示と、全て開く/閉じるボタンのラベルが、現在のキャッシュ・
    //   状態を反映したものに更新される。
    function rerenderWbsAndGanttFromCache() {
      const visibleScheduleTreeRows = filterVisibleScheduleTreeRows(currentScheduleTreeRows, collapsedScheduleIds);
      const timelineDays = buildGanttTimelineDays(currentProjectObject.startDate, currentProjectObject.endDate);
      const pixelsPerDay = GRANULARITY_PIXELS_PER_DAY[currentGranularity];
      const todayDateString = new Date().toISOString().slice(0, 10);
      applyWbsPanel(renderWbsPanelToHtml(currentScheduleTreeRows, visibleWbsColumns, collapsedScheduleIds));
      applyGanttPanel(
        renderGanttChartToHtml(
          visibleScheduleTreeRows,
          timelineDays,
          pixelsPerDay,
          currentProjectObject.milestones,
          currentProjectObject.startDate,
          currentGranularity,
          todayDateString
        )
      );
      document.getElementById("toggleAllScheduleRowsButton").textContent = areAllParentRowsCollapsed(
        currentScheduleTreeRows,
        collapsedScheduleIds
      )
        ? "全て開く"
        : "全て閉じる";
    }

    // 【前提】projectId はnull、または実在するプロジェクトのid。currentProjectObjectが
    //   switchToProjectで設定済みであること（プロジェクトのstartDate/endDate/milestonesを使うため）。
    // 【処理】projectIdがnullなら空状態を表示し、そうでなければgetSchedulesByProjectで取得して
    //   ツリー化し（currentScheduleTreeRowsは常に「折りたたみに関係ない全件」を保持する。
    //   WBS番号の計算・兄弟位置の判定は隠れている行も含めた全体構造が必要なため）、
    //   rerenderWbsAndGanttFromCacheで両パネルを再描画する。
    // 【結果】WBS・ガント両パネルの表示が最新の状態に更新される。
    async function refreshGanttPanel(projectId) {
      // 追加実装仕様書2.1節：プロジェクト未選択時は、ガント本体エリア（WBSパネル＋
      // タイムライン部分）全体を専用の空状態画面に置き換える（ヘッダー2段は表示したまま）。
      applyGanttEmptyStateVisibility(!projectId || !currentProjectObject);
      if (!projectId || !currentProjectObject) {
        applyWbsPanel("");
        applyGanttPanel("");
        return;
      }
      const scheduleList = await getSchedulesByProject(projectId);
      currentScheduleTreeRows = buildScheduleTreeRows(scheduleList);
      currentTimelineStartDateString = currentProjectObject.startDate;
      rerenderWbsAndGanttFromCache();
    }

    // 【前提】なし。
    // 【処理】プロジェクト未選択時の空状態画面（#ganttEmptyState）と、通常のWBS＋ガント表示
    //   （.main-workspace）のどちらを表示するかを切り替える。
    // 【結果】isEmptyがtrueなら空状態画面を表示し通常表示を隠す。falseならその逆。
    function applyGanttEmptyStateVisibility(isEmpty) {
      document.getElementById("ganttEmptyState").hidden = !isEmpty;
      document.querySelector(".main-workspace").hidden = isEmpty;
    }

    // refreshGanttPanelと同じ考え方。対象はtasks・カンバンボード。
    async function refreshKanbanPanel(projectId) {
      if (!projectId) {
        applyKanbanPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        return;
      }
      const taskList = await getTasksByProject(projectId);
      applyKanbanPanel(renderKanbanBoardToHtml(groupTasksByStatus(taskList)));
    }

    // 【前提】taskId は削除対象のタスクのid。
    // 【処理】確認ダイアログ（詳細設計書3.3.2：deleteTodo「このタスクを削除しますか？」）の上で
    //   deleteTaskし、削除ログを記録する（schedules/issuesの個別削除と同じ方針。tasksも
    //   LOGGED_STORES対象のため）。
    // 【結果】確認OK時、対象タスクが削除されカンバンパネルが再描画される。
    async function handleDeleteTaskButtonClick(taskId) {
      const taskList = await getTasksByProject(currentSelectedProjectId);
      const task = taskList.find((candidateTask) => candidateTask.id === taskId);
      if (!task) return;
      if (!window.confirm("このタスクを削除しますか？")) return;
      await deleteTask(taskId);
      await addChangelogEntry({
        id: generateId(),
        projectId: task.projectId,
        action: "delete",
        store: "tasks",
        storeLabel: "タスク",
        itemId: task.id,
        itemName: task.title,
        changes: [],
        snapshot: task,
        createdAt: new Date().toISOString(),
      });
      await refreshKanbanPanel(currentSelectedProjectId);
    }

    // 【前提】currentSelectedProjectIdが設定済みであること。
    // 【処理】完了列(status==="done")のタスクを数え、0件なら案内のみ表示して終了する。
    //   1件以上あれば件数を明示した確認ダイアログの上で全件削除し、削除ログを個別に記録する
    //   （詳細設計書3.3.2：clearDoneTodos）。
    // 【結果】確認OK時、完了済みタスクがすべて削除されカンバンパネルが再描画される。
    async function handleClearDoneTasksButtonClick() {
      const taskList = await getTasksByProject(currentSelectedProjectId);
      const doneTasks = taskList.filter((task) => task.status === "done");
      if (doneTasks.length === 0) {
        showToast("完了タスクがありません");
        return;
      }
      if (!window.confirm(`完了済み${doneTasks.length}件を削除しますか？`)) return;
      for (const task of doneTasks) {
        await deleteTask(task.id);
        await addChangelogEntry({
          id: generateId(),
          projectId: task.projectId,
          action: "delete",
          store: "tasks",
          storeLabel: "タスク",
          itemId: task.id,
          itemName: task.title,
          changes: [],
          snapshot: task,
          createdAt: new Date().toISOString(),
        });
      }
      showToast("完了タスクを削除しました");
      await refreshKanbanPanel(currentSelectedProjectId);
    }

