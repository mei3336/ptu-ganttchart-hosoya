    // ===== UI：モーダル（モーダル・ダイアログ一覧①：中央モーダル） =====
    // 【設計判断】M1（新規プロジェクト作成）・M4（スケジュール新規作成・編集）を、
    // prompt()の連鎖から、UIデザイン仕様書2.3節に沿った中央モーダルへ作り直した。
    // モーダルの開閉・入れ物（#modalOverlay/#modalPanel）は全モーダル共通で使い回す。

    // 【前提】contentHtml はモーダルパネルに表示するHTML文字列。
    // 【処理】共通のモーダルオーバーレイにcontentHtmlを差し込んで表示する。
    // 【結果】画面中央にモーダルが表示される。
    function openModal(contentHtml) {
      document.getElementById("modalPanel").innerHTML = contentHtml;
      document.getElementById("modalOverlay").hidden = false;
    }

    // 【前提】なし。
    // 【処理】モーダルを閉じ、中身を空にする（次回開いたときに前回の入力値が残らないようにする）。
    // 【結果】モーダルが非表示になる。
    function closeModal() {
      document.getElementById("modalOverlay").hidden = true;
      document.getElementById("modalPanel").innerHTML = "";
    }

    const SCHEDULE_BAR_COLOR_PALETTE = ["#2563EB", "#0891B2", "#059669", "#D97706", "#DC2626", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#0E7490", "#4B5563"];

    // 【前提】project はnull（新規作成モード）、または既存プロジェクトオブジェクト（編集モード）。
    // 【処理】M1/M2共通のプロジェクトモーダルのHTML文字列を組み立てる（DOMには触れない）。
    //   新規作成時は開始日・終了日の既定値を今日,1年後にする（モーダル・ダイアログ一覧M1）。
    // 【結果】モーダルパネルにそのまま入れられるHTML文字列を返す。
    function renderProjectModalToHtml(project) {
      const isEditMode = Boolean(project);
      const todayDateString = new Date().toISOString().slice(0, 10);
      const oneYearLaterDate = new Date();
            oneYearLaterDate.setFullYear(oneYearLaterDate.getFullYear() + 1);
      const oneYearLaterDateString = oneYearLaterDate.toISOString().slice(0, 10);
      const nameValue = isEditMode ? project.name : "";
      const startDateValue = isEditMode ? project.startDate : todayDateString;
      const endDateValue = isEditMode ? project.endDate : oneYearLaterDateString;
      return `
        <h2>${isEditMode ? "プロジェクト編集" : "新規プロジェクト作成"}</h2>
        <div class="modal-field">
          <label for="projectModalNameInput">プロジェクト名</label>
          <input type="text" id="projectModalNameInput" value="${escapeHtmlText(nameValue)}">
        </div>
        <div class="modal-field-row">
          <div class="modal-field">
            <label for="projectModalStartDateInput">開始日</label>
            <input type="date" id="projectModalStartDateInput" value="${escapeHtmlText(startDateValue)}">
          </div>
          <div class="modal-field">
            <label for="projectModalEndDateInput">終了日</label>
            <input type="date" id="projectModalEndDateInput" value="${escapeHtmlText(endDateValue)}">
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="modal-button-secondary" id="projectModalCancelButton">キャンセル</button>
          <button type="button" class="modal-button-primary" id="projectModalSaveButton">保存</button>
        </div>
      `;
    }

    // 【前提】existingProject はnull（新規作成）または既存プロジェクトオブジェクト（編集）。
    // 【処理】プロジェクトモーダルを開き、キャンセル・保存ボタンにイベントを登録する。
    // 【結果】モーダルが操作可能な状態で表示される。
    function openProjectModal(existingProject) {
      openModal(renderProjectModalToHtml(existingProject));
      document.getElementById("projectModalCancelButton").addEventListener("click", closeModal);
      document.getElementById("projectModalSaveButton").addEventListener("click", () => handleProjectModalSaveButtonClick(existingProject));
    }

    function handleCreateProjectButtonClick() {
      openProjectModal(null);
    }

    function handleEditProjectButtonClick() {
      if (!currentProjectObject) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      openProjectModal(currentProjectObject);
    }

    // ===== M3：マイルストーン管理モーダル =====
    // 【設計判断】名前・日付の行を保存ボタンを押すまでDBに反映しない「作業用コピー」
    //   （milestoneModalDraftRows）を持つ。行の追加・削除のたびに#milestoneModalRowsContainerの
    //   innerHTMLを丸ごと再構築するため、削除ボタン（動的に増減する要素）はイベント委譲で
    //   拾う。再構築の直前には必ずsyncMilestoneModalDraftRowsFromDomでDOM上の現在値を
    //   作業用コピーへ書き戻す（他の行への入力中の変更を、行追加・削除で消さないため）。

    // 現在開いているマイルストーン管理モーダルの作業用コピー（{name, date}の配列）。
    let milestoneModalDraftRows = [];

    // 【前提】draftRows は milestoneModalDraftRows と同じ形の配列。
    // 【処理】1行分＝名前入力・日付入力・削除ボタンのHTML文字列を、行インデックス付きで組み立てる
    //   （基本設計書2.2節：「マイルストーン名」「日付」の入力行、行ごとに×削除ボタン）。
    // 【結果】#milestoneModalRowsContainerの中身にそのまま入れられるHTML文字列を返す。
    function renderMilestoneModalRowsToHtml(draftRows) {
      return draftRows
        .map(
          (row, index) => `<div class="modal-milestone-row" data-row-index="${index}">
            <input type="text" class="modal-milestone-name-input" placeholder="マイルストーン名" value="${escapeHtmlText(row.name)}">
            <input type="date" class="modal-milestone-date-input" value="${escapeHtmlText(row.date)}" required>
            <button type="button" class="wbs-icon-button" data-action="remove-milestone-row" title="削除">×</button>
          </div>`
        )
        .join("");
    }

    // 【前提】draftRows は milestoneModalDraftRows と同じ形の配列。
    // 【処理】M3モーダル全体（行一覧＋行追加ボタン＋キャンセル／保存）のHTML文字列を組み立てる
    //   （モーダル・ダイアログ一覧M3）。
    // 【結果】モーダルパネルにそのまま入れられるHTML文字列を返す。
    function renderMilestoneModalToHtml(draftRows) {
      return `
        <h2>マイルストーン管理</h2>
        <div id="milestoneModalRowsContainer">${renderMilestoneModalRowsToHtml(draftRows)}</div>
        <button type="button" class="panel-add-button" id="addMilestoneRowButton">＋マイルストーンを追加</button>
        <div class="modal-actions">
          <button type="button" class="modal-button-secondary" id="milestoneModalCancelButton">キャンセル</button>
          <button type="button" class="modal-button-primary" id="milestoneModalSaveButton">保存</button>
        </div>
      `;
    }

    // 【前提】なし。
    // 【処理】現在表示されている各行のDOM入力値を読み取り、milestoneModalDraftRowsへ書き戻す。
    //   行の追加・削除でHTMLを再構築する前に必ず呼ぶことで、未保存の入力を失わないようにする。
    // 【結果】milestoneModalDraftRowsが画面表示と同じ内容になる。
    function syncMilestoneModalDraftRowsFromDom() {
      const rowElements = document.querySelectorAll("#milestoneModalRowsContainer .modal-milestone-row");
      milestoneModalDraftRows = Array.from(rowElements).map((rowElement) => ({
        name: rowElement.querySelector(".modal-milestone-name-input").value,
        date: rowElement.querySelector(".modal-milestone-date-input").value,
      }));
    }

    // 【前提】milestoneModalDraftRowsが最新であること（呼び出し前にsync済み）。
    // 【処理】#milestoneModalRowsContainerの中身をmilestoneModalDraftRowsの内容で再構築する。
    // 【結果】行一覧の表示が作業用コピーと一致する。
    function rerenderMilestoneModalRows() {
      document.getElementById("milestoneModalRowsContainer").innerHTML = renderMilestoneModalRowsToHtml(milestoneModalDraftRows);
    }

    // 【前提】なし。
    // 【処理】現在の入力値をsyncしたうえで、末尾に空行（{name:"",date:""}）を追加して再描画する
    //   （基本設計書2.2節：「＋マイルストーンを追加」で行を追加）。
    // 【結果】行一覧に空行が1行増える。
    function handleAddMilestoneRowButtonClick() {
      syncMilestoneModalDraftRowsFromDom();
      milestoneModalDraftRows.push({ name: "", date: "" });
      rerenderMilestoneModalRows();
    }

    // 【前提】rowIndex は削除対象行の、現在の表示順でのインデックス。
    // 【処理】現在の入力値をsyncしたうえで、指定インデックスの行を取り除いて再描画する。
    // 【結果】行一覧から指定行が消える。
    function handleRemoveMilestoneRowButtonClick(rowIndex) {
      syncMilestoneModalDraftRowsFromDom();
      milestoneModalDraftRows.splice(rowIndex, 1);
      rerenderMilestoneModalRows();
    }

    // 【前提】currentProjectObjectが設定済み（プロジェクト選択済み）であること。
    // 【処理】現在の入力値をDOMから読み取り、project.milestonesを丸ごと置き換えてaddProjectで
    //   保存する（詳細設計書3.11.1：1回の保存で複数行の追加・削除をまとめて反映。差分ではなく
    //   丸ごと置換）。名前が空の行があってもエラーにはしない（同節エラーバリエーション：
    //   保存自体は成功し、該当行はガントチャート上に表示されないだけ）。
    //   milestonesはPROJECT_LOGGED_FIELD_LABELSの対象外のため、この保存では変更履歴は
    //   記録されない（詳細設計書3.11.1に変更履歴への言及が無いことに合わせる）。
    // 【結果】保存後、モーダルを閉じてガントパネルを再描画し、
    //   トースト「マイルストーンを保存しました」を表示する。
    async function handleMilestoneModalSaveButtonClick() {
      syncMilestoneModalDraftRowsFromDom();
      const updatedProject = {
        ...currentProjectObject,
        milestones: milestoneModalDraftRows.map((row) => ({ name: row.name, date: row.date })),
      };
      await addProject(updatedProject);
      currentProjectObject = updatedProject;
      closeModal();
      await refreshGanttPanel(currentSelectedProjectId);
      showToast("マイルストーンを保存しました");
    }

    // 【前提】currentProjectObjectが設定済み（プロジェクト選択済み）であること
    //   （マイルストーンボタン自体が未選択時・ロック中はdisabledのため、通常はここに
    //   到達する時点で選択済み）。
    // 【処理】現在のproject.milestonesを作業用コピーへ複製してモーダルを開き、
    //   行追加・削除（イベント委譲）・キャンセル・保存にイベントを登録する。
    // 【結果】マイルストーン管理モーダルが操作可能な状態で表示される。
    function openMilestoneModal() {
      if (!currentProjectObject) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      milestoneModalDraftRows = currentProjectObject.milestones.map((milestone) => ({ ...milestone }));
      openModal(renderMilestoneModalToHtml(milestoneModalDraftRows));
      document.getElementById("milestoneModalCancelButton").addEventListener("click", closeModal);
      document.getElementById("addMilestoneRowButton").addEventListener("click", handleAddMilestoneRowButtonClick);
      document.getElementById("milestoneModalSaveButton").addEventListener("click", handleMilestoneModalSaveButtonClick);
      document.getElementById("milestoneModalRowsContainer").addEventListener("click", (event) => {
        const removeButton = event.target.closest('[data-action="remove-milestone-row"]');
        if (!removeButton) return;
        const rowElement = removeButton.closest(".modal-milestone-row");
        handleRemoveMilestoneRowButtonClick(Number(rowElement.dataset.rowIndex));
      });
    }

    // 3年後の判定はうるう年を厳密に数えず、365日×3年分の日数で近似する（実務上十分な簡略化）。
    const THREE_YEARS_IN_MILLISECONDS = 3 * 365 * MILLISECONDS_PER_DAY;

    // 【前提】input は {name, startDate, endDate}（プロジェクトモーダルの入力値）。
    // 【処理】モーダル・ダイアログ一覧A1〜A4のバリデーションを順に判定する（DOMには触れない）。
    //   ※A3はプロジェクト側が`<=`判定（終了日=開始日も拒否）で、スケジュール側（A7）の
    //   `<`判定とは非対称。これは基本設計書1.3節No.1の既知の非整合として忠実再現する。
    // 【結果】エラーがあればそのアラート文言（string）を、無ければnullを返す。
    function validateProjectModalInput(input) {
      if (!input.name) return "プロジェクト名を入力してください";
      if (!input.startDate || !input.endDate) return "日付を入力してください";
      if (input.endDate <= input.startDate) return "終了日は開始日より後にしてください";
      if (parseDateStringToUtcTimestamp(input.endDate) - parseDateStringToUtcTimestamp(input.startDate) > THREE_YEARS_IN_MILLISECONDS) {
        return "期間は最大3年です";
      }
      return null;
    }

    // 変更履歴（changelog）に記録するプロジェクトの対象フィールド（データモデル設計6章）。
    // milestones/locked/createdAtはこのモーダルから編集できないため対象外。
    const PROJECT_LOGGED_FIELD_LABELS = { name: "名前", startDate: "開始日", endDate: "終了日" };

    // 【前提】existingProject はnull（新規作成）または既存プロジェクトオブジェクト（編集）。
    // 【処理】モーダル内の入力値を読み取り、validateProjectModalInputでバリデーションし、
    //   OKならaddProjectで保存してモーダルを閉じ、画面を更新する。保存後、追加/変更の
    //   変更履歴をrecordChangelogEntryで記録する（詳細設計書3.6.1：LOGGED_STORES対象は
    //   保存のたびに自動記録）。
    // 【結果】保存成功時はモーダルを閉じ、プロジェクト一覧・選択状態を更新し、
    //   トースト「プロジェクトを保存しました」を表示する（詳細設計書3.1.1 step8）。
    async function handleProjectModalSaveButtonClick(existingProject) {
      const name = document.getElementById("projectModalNameInput").value.trim();
      const startDate = document.getElementById("projectModalStartDateInput").value;
      const endDate = document.getElementById("projectModalEndDateInput").value;

      const validationError = validateProjectModalInput({ name, startDate, endDate });
      if (validationError) {
        window.alert(validationError);
        return;
      }

      const projectToSave = existingProject
        ? { ...existingProject, name, startDate, endDate }
        : { id: generateId(), name, startDate, endDate, milestones: [], locked: false, createdAt: new Date().toISOString() };
      await addProject(projectToSave);
      await recordChangelogEntry(
        existingProject ? "edit" : "add",
        projectToSave.id,
        "projects",
        "プロジェクト",
        projectToSave.id,
        projectToSave.name,
        existingProject,
        projectToSave,
        PROJECT_LOGGED_FIELD_LABELS
      );
      closeModal();
      await refreshProjectSelectDropdown();
      document.getElementById("projectSelectDropdown").value = projectToSave.id;
      await switchToProject(projectToSave.id);
      showToast("プロジェクトを保存しました");
    }

    // 【前提】projectId は削除したいプロジェクトのid。project は削除前に取得済みの
    //   プロジェクトオブジェクト（変更履歴のsnapshot・itemNameに使う）。
    // 【処理】配下データ（スケジュール・タスク・issue・コメント・メモ・即時メモ・
    //   スナップショット）を先にすべて読み切ってから削除する（データモデル設計6章：
    //   複数ストアにまたがる書き込みは読み切ってから行う方針）。
    //   LOGGED_STORES対象（schedules/tasks/issues）は削除のたびに個別の変更履歴を記録し、
    //   最後にプロジェクト自体の削除ログも記録してからprojectsストアの当該行を削除する。
    //   既存の変更履歴（このプロジェクトのchangelogエントリ）は監査ログとして削除せず残す
    //   （スナップショット・変更履歴自体の削除UIは今回のスコープ外のため、消す手段が無いことと
    //   整合させる）。
    // 【結果】プロジェクトと配下データがすべて削除される。
    async function deleteProjectCascade(projectId, project) {
      const scheduleList = await getSchedulesByProject(projectId);
      const taskList = await getTasksByProject(projectId);
      const issueList = await getIssuesByProject(projectId);
      const memoList = await getMemosByProject(projectId);
      const quickMemoList = await getQuickMemosByProject(projectId);
      const snapshotList = await getSnapshotsByProject(projectId);

      for (const schedule of scheduleList) {
        const comments = await getCommentsByTask(schedule.id);
        for (const comment of comments) {
          await deleteComment(comment.id);
        }
      }
      for (const schedule of scheduleList) {
        await deleteSchedule(schedule.id);
        await addChangelogEntry({
          id: generateId(),
          projectId,
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
      for (const task of taskList) {
        await deleteTask(task.id);
        await addChangelogEntry({
          id: generateId(),
          projectId,
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
      for (const issue of issueList) {
        await deleteIssue(issue.id);
        await addChangelogEntry({
          id: generateId(),
          projectId,
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
      for (const memo of memoList) {
        await deleteMemo(memo.id);
      }
      for (const quickMemo of quickMemoList) {
        await deleteQuickMemo(quickMemo.id);
      }
      for (const snapshot of snapshotList) {
        await deleteSnapshot(snapshot.id);
      }

      await addChangelogEntry({
        id: generateId(),
        projectId,
        action: "delete",
        store: "projects",
        storeLabel: "プロジェクト",
        itemId: project.id,
        itemName: project.name,
        changes: [],
        snapshot: project,
        createdAt: new Date().toISOString(),
      });
      await deleteProject(projectId);
    }

    // 【前提】currentSelectedProjectId・currentProjectObjectが設定済みであること。
    // 【処理】確認ダイアログ（モーダル・ダイアログ一覧C1：「『{プロジェクト名}』を削除しますか？
    //   （すべてのスケジュールも削除されます）」）の上でdeleteProjectCascadeする。
    //   削除後は、残っている先頭のプロジェクトを選択し直す（無ければ未選択状態にする）。
    // 【結果】確認OK時、プロジェクトと配下データが削除され、画面が更新される。
    //   トースト「プロジェクトを削除しました」を表示する（詳細設計書3.1.2 step4）。
    async function handleDeleteProjectButtonClick() {
      if (!currentSelectedProjectId || !currentProjectObject) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const confirmMessage = `「${currentProjectObject.name}」を削除しますか？（すべてのスケジュールも削除されます）`;
      if (!window.confirm(confirmMessage)) return;

      await deleteProjectCascade(currentSelectedProjectId, currentProjectObject);
      await refreshProjectSelectDropdown();
      const remainingProjectList = await getAllProjects();
      const nextProjectId = remainingProjectList.length > 0 ? remainingProjectList[0].id : null;
      document.getElementById("projectSelectDropdown").value = nextProjectId || "";
      await switchToProject(nextProjectId);
      showToast("プロジェクトを削除しました");
    }

    // 【前提】schedule はnull（新規作成モード）、または既存スケジュールオブジェクト（編集モード）。
    //   hasChildren は編集対象が子を持つか（子を持つ場合、開始日・終了日は自動計算のため
    //   読み取り専用にする。基本設計書4.2節）。
    // 【処理】M4（スケジュール新規作成・編集）モーダルのHTML文字列を組み立てる。
    // 【結果】モーダルパネルにそのまま入れられるHTML文字列を返す。
    // 【前提】comments は対象スケジュールに紐づくコメント全件（無ければ空配列）。
    // 【処理】投稿日時の昇順（古い順）に並べ、各コメントに削除ボタンを添えた一覧と、
    //   末尾に投稿フォームを組み立てる（モーダル・ダイアログ一覧M4：コメントは
    //   既存スケジュールの編集モーダル内に埋め込む仕様）。
    // 【結果】コメント欄のHTML文字列を返す。
    function renderModalCommentSectionToHtml(comments) {
      const sortedComments = comments.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const commentListHtml = sortedComments.length > 0
        ? sortedComments
            .map(
              (comment) => `<div class="panel-list-item" data-comment-id="${escapeHtmlText(comment.id)}">
                <div class="panel-list-item-main">
                  <div>${escapeHtmlText(comment.text)}</div>
                  <div class="panel-list-item-meta">${escapeHtmlText(comment.createdAt)}</div>
                </div>
                <div class="panel-list-item-actions">
                  <button type="button" class="wbs-icon-button" data-action="delete-modal-comment" title="削除">🗑</button>
                </div>
              </div>`
            )
            .join("")
        : '<p class="empty-state-message">コメントはまだありません。</p>';
      return `
        <div class="modal-field">
          <label>コメント</label>
          <div class="modal-comment-list">${commentListHtml}</div>
          <div class="modal-comment-post-form">
            <input type="text" id="scheduleModalCommentTextInput" placeholder="コメントを入力">
            <button type="button" class="panel-add-button" id="scheduleModalPostCommentButton">投稿</button>
          </div>
        </div>
      `;
    }

    function renderScheduleModalToHtml(schedule, hasChildren, comments) {
      const isEditMode = Boolean(schedule);
      // カレンダー系入力の初期値は「今日」にする（ユーザー指示）。編集時は既存値をそのまま使う。
      const todayDateString = new Date().toISOString().slice(0, 10);
      const nameValue = isEditMode ? schedule.name : "";
      const startDateValue = isEditMode ? schedule.startDate : todayDateString;
      const endDateValue = isEditMode ? schedule.endDate : todayDateString;
      const assigneeValue = isEditMode ? schedule.assignee : "";
      const taskStatusValue = isEditMode ? schedule.taskStatus : "todo";
      const notesValue = isEditMode ? schedule.notes : "";
      const selectedColor = isEditMode && schedule.color ? schedule.color : SCHEDULE_BAR_COLOR_PALETTE[0];
      const dateDisabledAttribute = hasChildren ? "disabled" : "";
      const dateHintHtml = hasChildren
        ? '<p class="empty-state-message" style="padding:0;font-size:11px;">子タスクから自動計算されます</p>'
        : "";

      const statusOptionsHtml = Object.entries(SCHEDULE_STATUS_LABELS)
        .map(([value, label]) => `<option value="${value}"${value === taskStatusValue ? " selected" : ""}>${label}</option>`)
        .join("");

      const colorSwatchesHtml = SCHEDULE_BAR_COLOR_PALETTE
        .map((color) => `<div class="modal-color-swatch${color === selectedColor ? " is-selected" : ""}" data-color="${color}" style="background:${color}"></div>`)
        .join("");

      return `
        <h2>${isEditMode ? "スケジュール編集" : "スケジュール新規作成"}</h2>
        <div class="modal-field">
          <label for="scheduleModalNameInput">スケジュール名</label>
          <input type="text" id="scheduleModalNameInput" value="${escapeHtmlText(nameValue)}">
        </div>
        <div class="modal-field-row">
          <div class="modal-field">
            <label for="scheduleModalStartDateInput">開始日</label>
            <input type="date" id="scheduleModalStartDateInput" value="${escapeHtmlText(startDateValue)}" ${dateDisabledAttribute}>
          </div>
          <div class="modal-field">
            <label for="scheduleModalEndDateInput">終了日</label>
            <input type="date" id="scheduleModalEndDateInput" value="${escapeHtmlText(endDateValue)}" ${dateDisabledAttribute}>
          </div>
        </div>
        ${dateHintHtml}
        <div class="modal-field">
          <label for="scheduleModalAssigneeInput">担当者</label>
          <input type="text" id="scheduleModalAssigneeInput" value="${escapeHtmlText(assigneeValue)}">
        </div>
        <div class="modal-field">
          <label for="scheduleModalStatusSelect">ステータス</label>
          <select id="scheduleModalStatusSelect">${statusOptionsHtml}</select>
        </div>
        <div class="modal-field">
          <label>カラー</label>
          <div class="modal-color-palette" id="scheduleModalColorPalette">${colorSwatchesHtml}</div>
        </div>
        <div class="modal-field">
          <label for="scheduleModalNotesTextarea">メモ</label>
          <textarea id="scheduleModalNotesTextarea" rows="3">${escapeHtmlText(notesValue)}</textarea>
        </div>
        ${isEditMode ? renderModalCommentSectionToHtml(comments) : ""}
        <div class="modal-actions">
          <button type="button" class="modal-button-secondary" id="scheduleModalCancelButton">キャンセル</button>
          <button type="button" class="modal-button-primary" id="scheduleModalSaveButton">保存</button>
        </div>
      `;
    }

    // 【前提】existingSchedule はnull（新規作成）または既存スケジュールオブジェクト（編集）。
    //   presetParentId は新規作成時にあらかじめ決めておく親id（ルート作成ならnull、
    //   子スケジュール追加ボタンから開く場合はそのスケジュールのid）。編集時は使わない。
    // 【処理】既存スケジュールの場合のみgetCommentsByTaskでコメントを取得してから
    //   モーダルを開き、キャンセル・保存・カラーパレット・コメント投稿/削除の
    //   イベントを登録する（コメント欄はモーダルの再描画のたびに新しいDOM要素になるため、
    //   カラースワッチと同じく直接addEventListenerしてよい＝二重登録の心配はない）。
    // 【結果】モーダルが操作可能な状態で表示される。
    async function openScheduleModal(existingSchedule, hasChildren, presetParentId) {
      const comments = existingSchedule ? await getCommentsByTask(existingSchedule.id) : [];
      openModal(renderScheduleModalToHtml(existingSchedule, hasChildren, comments));
      document.getElementById("scheduleModalCancelButton").addEventListener("click", closeModal);
      document.getElementById("scheduleModalSaveButton").addEventListener("click", () => handleScheduleModalSaveButtonClick(existingSchedule, presetParentId));
      for (const swatch of document.querySelectorAll(".modal-color-swatch")) {
        swatch.addEventListener("click", () => {
          for (const otherSwatch of document.querySelectorAll(".modal-color-swatch")) {
            otherSwatch.classList.remove("is-selected");
          }
          swatch.classList.add("is-selected");
        });
      }
      if (existingSchedule) {
        document.getElementById("scheduleModalPostCommentButton").addEventListener("click", () => handlePostModalCommentButtonClick(existingSchedule, hasChildren));
        for (const deleteButton of document.querySelectorAll('[data-action="delete-modal-comment"]')) {
          const commentId = deleteButton.closest("[data-comment-id]").dataset.commentId;
          deleteButton.addEventListener("click", () => handleDeleteModalCommentButtonClick(commentId, existingSchedule, hasChildren));
        }
      }
    }

    // 【前提】schedule は編集中のスケジュール（コメント欄はこの場合のみ表示される）。
    //   hasChildren はそのスケジュールが子を持つか（モーダル再描画時に必要な情報）。
    // 【処理】コメント入力欄のテキストを読み取り、空でなければaddCommentで保存する。
    // 【結果】投稿後、同じ編集モーダルを再度開き直して最新のコメント一覧を表示する。
    async function handlePostModalCommentButtonClick(schedule, hasChildren) {
      const textInput = document.getElementById("scheduleModalCommentTextInput");
      if (!textInput) return;
      const text = textInput.value.trim();
      if (!text) return;
      await addComment({ id: generateId(), taskId: schedule.id, text, createdAt: new Date().toISOString() });
      await openScheduleModal(schedule, hasChildren, null);
    }

    // 【前提】commentId は削除したいコメントのid。schedule・hasChildrenはモーダル再描画用。
    // 【処理】即時メモの個別削除と同じ方針（確認なし即削除）でdeleteCommentする。
    // 【結果】削除後、同じ編集モーダルを再度開き直す。
    async function handleDeleteModalCommentButtonClick(commentId, schedule, hasChildren) {
      await deleteComment(commentId);
      await openScheduleModal(schedule, hasChildren, null);
    }

    function handleAddScheduleButtonClick() {
      if (!currentSelectedProjectId) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      openScheduleModal(null, false, null);
    }

    // 【前提】parentScheduleId は子を追加したい親スケジュールのid（currentScheduleTreeRowsに
    //   含まれること）。呼び出し元（WBS行の＋ボタン）は、depthLevelが
    //   MAX_SCHEDULE_DEPTH_LEVEL_ALLOWING_CHILDREN未満の行にしかこのボタンを出さないため、
    //   通常はここに到達する時点で3階層制約は満たされている。
    // 【処理】親をpresetParentIdとして固定した新規作成モーダルを開く（基本設計書4.1節：
    //   親→子→孫の3階層まで作成可能）。
    // 【結果】子スケジュール作成モーダルが表示される。
    function handleAddChildScheduleButtonClick(parentScheduleId) {
      const parentRow = currentScheduleTreeRows.find((row) => row.schedule.id === parentScheduleId);
      if (!parentRow || parentRow.depthLevel >= MAX_SCHEDULE_DEPTH_LEVEL_ALLOWING_CHILDREN) {
        window.alert("これ以上深い階層のスケジュールは作成できません（親→子→孫の3階層まで）。");
        return;
      }
      openScheduleModal(null, false, parentScheduleId);
    }

    // 【前提】scheduleId は編集したいスケジュールの id（currentScheduleTreeRowsに含まれること）。
    // 【処理】WBSパネルの行クリックから呼ばれ、該当スケジュールの編集モーダルを開く
    //   （モーダル・ダイアログ一覧M4：ガント上の行クリックで編集）。
    // 【結果】編集モーダルが表示される。
    function handleWbsRowClick(scheduleId) {
      const targetRow = currentScheduleTreeRows.find((row) => row.schedule.id === scheduleId);
      if (!targetRow) return;
      openScheduleModal(targetRow.schedule, targetRow.hasChildren, null);
    }

    // 【前提】input は {name, startDate, endDate, hasChildren}（スケジュールモーダルの入力値）。
    //   子を持つ行は開始日・終了日が自動計算のため、日付のバリデーション自体を行わない。
    // 【処理】モーダル・ダイアログ一覧A5〜A7のバリデーションを順に判定する（DOMには触れない）。
    // 【結果】エラーがあればそのアラート文言（string）を、無ければnullを返す。
    function validateScheduleModalInput(input) {
      if (!input.name) return "スケジュールを入力してください";
      if (input.hasChildren) return null;
      if (!input.startDate || !input.endDate) return "日付を入力してください";
      if (input.endDate < input.startDate) return "終了日は開始日以降にしてください";
      return null;
    }

    // 変更履歴（changelog）に記録するスケジュールの対象フィールド（データモデル設計6章）。
    // projectId/parentId/orderはユーザーが直接編集する値ではないため対象外。
    const SCHEDULE_LOGGED_FIELD_LABELS = {
      name: "名前",
      startDate: "開始日",
      endDate: "終了日",
      assignee: "担当者",
      taskStatus: "ステータス",
      notes: "メモ",
      color: "カラー",
    };

    // 【前提】existingSchedule はnull（新規作成）または既存スケジュールオブジェクト（編集）。
    //   presetParentId は新規作成時の親id（ルート作成ならnull、子スケジュール追加なら
    //   そのスケジュールのid）。existingSchedule有り（編集）の場合は無視する
    //   （編集では親を変更する機能を持たせないため）。
    // 【処理】モーダル内の入力値を読み取り、validateScheduleModalInputでバリデーションし、
    //   OKならaddScheduleで保存する。子を持つ行は開始日・終了日を既存値のまま維持する
    //   （手入力欄は読み取り専用にしているため）。
    //   新規作成後、親を持つ場合はsyncAncestorDatesで祖先の日付を再計算する
    //   （子を追加すると親の期間が変わりうるため。基本設計書4.3節）。保存後、追加/変更の
    //   変更履歴をrecordChangelogEntryで記録する（詳細設計書3.6.1）。なおsyncAncestorDates
    //   による祖先スケジュールの日付再計算自体は、子の追加/編集操作の副作用であり独立した
    //   ユーザー操作ではないため、別途ログは残さない（記録するとノイズになるため）。
    //   ロック中は保存させない（詳細設計書3.1.3：個別関数側でもisLocked相当のチェックを持つ
    //   方針。「＋スケジュール追加」ボタン自体の無効化だけでは、既存行クリックでの編集を防げないため）。
    // 【結果】保存成功時はモーダルを閉じ、ガントパネルを更新し、トースト「保存しました」を
    //   表示する（詳細設計書3.2.1 step5）。ロック中はトースト「ロック中のため編集できません」を
    //   表示して保存しない。
    async function handleScheduleModalSaveButtonClick(existingSchedule, presetParentId) {
      if (currentProjectObject?.locked) {
        showToast("ロック中のため編集できません");
        return;
      }
      const name = document.getElementById("scheduleModalNameInput").value.trim();
      const assignee = document.getElementById("scheduleModalAssigneeInput").value.trim();
      const taskStatus = document.getElementById("scheduleModalStatusSelect").value;
      const notes = document.getElementById("scheduleModalNotesTextarea").value;
      const selectedSwatch = document.querySelector(".modal-color-swatch.is-selected");
      const color = selectedSwatch ? selectedSwatch.dataset.color : SCHEDULE_BAR_COLOR_PALETTE[0];

      const existingRow = existingSchedule ? currentScheduleTreeRows.find((row) => row.schedule.id === existingSchedule.id) : null;
      const hasChildren = Boolean(existingRow?.hasChildren);

      let startDate = existingSchedule ? existingSchedule.startDate : "";
      let endDate = existingSchedule ? existingSchedule.endDate : "";
      if (!hasChildren) {
        startDate = document.getElementById("scheduleModalStartDateInput").value;
        endDate = document.getElementById("scheduleModalEndDateInput").value;
      }

      const validationError = validateScheduleModalInput({ name, startDate, endDate, hasChildren });
      if (validationError) {
        window.alert(validationError);
        return;
      }

      const scheduleToSave = existingSchedule
        ? { ...existingSchedule, name, startDate, endDate, assignee, taskStatus, notes, color }
        : {
            id: generateId(),
            projectId: currentSelectedProjectId,
            parentId: presetParentId ?? null,
            name,
            startDate,
            endDate,
            assignee,
            taskStatus,
            notes,
            color,
            order: currentScheduleTreeRows.length,
          };
      await addSchedule(scheduleToSave);
      await recordChangelogEntry(
        existingSchedule ? "edit" : "add",
        scheduleToSave.projectId,
        "schedules",
        "スケジュール",
        scheduleToSave.id,
        scheduleToSave.name,
        existingSchedule,
        scheduleToSave,
        SCHEDULE_LOGGED_FIELD_LABELS
      );
      if (scheduleToSave.parentId !== null && scheduleToSave.parentId !== undefined) {
        await syncAncestorDates(scheduleToSave.parentId);
      }
      closeModal();
      await refreshGanttPanel(currentSelectedProjectId);
      showToast("保存しました");
    }

    // 【前提】scheduleId は移動したいスケジュールのid。direction は "up" | "down"。
    //   呼び出し元（WBS行の上下矢印）は、兄弟内の先頭で"up"・末尾で"down"のボタンを
    //   無効化しているため、通常はここに到達する時点で境界チェックは満たされている。
    // 【処理】同じ親を持つ兄弟同士（parentIdが一致するスケジュール）をorder順に並べ、
    //   指定方向の隣接する兄弟とorder値を入れ替えて保存する（基本設計書4.1節：
    //   「並び替えは同一階層内でのみ可能」を、parentId一致という条件でそのまま満たす）。
    // 【結果】隣接する2件のorderが入れ替わり、ガントパネルが再描画され、
    //   トースト「並び順を変更しました」を表示する（詳細設計書3.2.4）。
    //   ロック中は何もしない（トースト「ロック中のため編集できません」）。
    async function handleMoveScheduleOrderClick(scheduleId, direction) {
      if (currentProjectObject?.locked) {
        showToast("ロック中のため編集できません");
        return;
      }
      const targetRow = currentScheduleTreeRows.find((row) => row.schedule.id === scheduleId);
      if (!targetRow) return;

      const siblingSchedules = currentScheduleTreeRows
        .filter((row) => row.schedule.parentId === targetRow.schedule.parentId)
        .map((row) => row.schedule)
        .sort((a, b) => a.order - b.order);
      const currentIndex = siblingSchedules.findIndex((schedule) => schedule.id === scheduleId);
      const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= siblingSchedules.length) return;

      const currentSchedule = siblingSchedules[currentIndex];
      const swapSchedule = siblingSchedules[swapIndex];
      const currentOrder = currentSchedule.order;
      await addSchedule({ ...currentSchedule, order: swapSchedule.order });
      await addSchedule({ ...swapSchedule, order: currentOrder });
      await refreshGanttPanel(currentSelectedProjectId);
      showToast("並び順を変更しました");
    }

    // 【前提】draggedId は掴んで動かしたスケジュールのid。targetId はドロップ先の行のid。
    //   同じidの場合、または親（parentId）が異なる場合（基本設計書4.1節「並び替えは同一階層
    //   内でのみ可能」）は何もしない。
    // 【処理】ドラッグ対象と同じ兄弟グループ内で、ドロップ先の位置へドラッグ対象を移動し、
    //   兄弟全員のorderを0番から振り直して保存する（クリックでの上下移動は隣接swapで済むが、
    //   ドラッグは任意の位置へ一気に移動できるため、隣接swapでは対応できず全員の振り直しが必要）。
    // 【結果】兄弟内の並び順が変わり、ガントパネルが再描画され、
    //   トースト「並び順を変更しました」を表示する（詳細設計書3.2.4）。
    //   ロック中は何もしない（トースト「ロック中のため編集できません」）。
    async function handleScheduleDragDrop(draggedId, targetId) {
      if (draggedId === targetId) return;
      if (currentProjectObject?.locked) {
        showToast("ロック中のため編集できません");
        return;
      }
      const draggedRow = currentScheduleTreeRows.find((row) => row.schedule.id === draggedId);
      const targetRow = currentScheduleTreeRows.find((row) => row.schedule.id === targetId);
      if (!draggedRow || !targetRow) return;
      if (draggedRow.schedule.parentId !== targetRow.schedule.parentId) return;

      const siblingSchedules = currentScheduleTreeRows
        .filter((row) => row.schedule.parentId === draggedRow.schedule.parentId)
        .map((row) => row.schedule)
        .sort((a, b) => a.order - b.order);
      const fromIndex = siblingSchedules.findIndex((schedule) => schedule.id === draggedId);
      const toIndex = siblingSchedules.findIndex((schedule) => schedule.id === targetId);
      const [movedSchedule] = siblingSchedules.splice(fromIndex, 1);
      siblingSchedules.splice(toIndex, 0, movedSchedule);

      for (let index = 0; index < siblingSchedules.length; index++) {
        await addSchedule({ ...siblingSchedules[index], order: index });
      }
      await refreshGanttPanel(currentSelectedProjectId);
      showToast("並び順を変更しました");
    }

