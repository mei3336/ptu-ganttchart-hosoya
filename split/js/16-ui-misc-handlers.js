    // ===== UI：その他のイベントハンドラ =====
    // 【設計判断】issuesの追加は今回スコープの手前でprompt()ベースの最小限のまま据え置く
    //   （マインドマップのスライドパネル化自体を今回は見送っているため）。

    // 変更履歴（changelog）に記録するタスク管理(tasks)の対象フィールド。
    // 既存のタスク編集モーダル（handleTaskModalSaveButtonClick）自体は変更履歴を記録していないため、
    // 使用箇所は現時点でH2データ取込（差分適用の「変更」ログ）のみ。
    const TASK_LOGGED_FIELD_LABELS = {
      title: "タスク名",
      status: "ステータス",
      priority: "優先度",
      dueDate: "期日",
      description: "メモ",
    };

    // 【前提】columnStatus はクリックされた「＋追加」ボタンのdata-column-status値。
    // 【処理】openKanbanAddFormColumnStatusをその列に設定して再描画する（追加実装仕様書
    //   6.1節：押した時だけフォームを開く）。
    // 【結果】その列だけ追加フォームが開いた状態になり、タイトル入力欄にフォーカスが移る。
    async function handleOpenKanbanAddFormButtonClick(columnStatus) {
      openKanbanAddFormColumnStatus = columnStatus;
      await refreshKanbanPanel(currentSelectedProjectId);
      document.querySelector(".kanban-add-title-input")?.focus();
    }

    // 【前提】なし。
    // 【処理】openKanbanAddFormColumnStatusをnullに戻して再描画する（追加実装仕様書6.1節：
    //   ×ボタン・Escapeキーによるキャンセル）。
    // 【結果】開いていた追加フォームが閉じ、「＋追加」ボタンの表示に戻る。
    async function handleCloseKanbanAddFormButtonClick() {
      openKanbanAddFormColumnStatus = null;
      await refreshKanbanPanel(currentSelectedProjectId);
    }

    // 【前提】formElement は「.kanban-add-form」要素（data-column-status属性でstatus値を持つ）。
    // 【処理】開いているフォームの入力値を読み取り、タスク名が空でなければaddTaskで保存する
    //   （モーダル・ダイアログ一覧P1：モーダルを介さずその場で追加）。
    // 【結果】保存後、フォームを閉じてから（追加実装仕様書6.1節：保存後は自動的に閉じる
    //   単発フォームとする）カンバンパネルを再描画する。
    async function handleKanbanAddFormSubmit(formElement) {
      if (!currentSelectedProjectId) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const title = formElement.querySelector(".kanban-add-title-input").value.trim();
      if (!title) {
        window.alert("タスク名を入力してください");
        return;
      }
      const priority = Number(formElement.querySelector(".kanban-add-priority-select").value);
      const dueDate = formElement.querySelector(".kanban-add-duedate-input").value;
      const columnStatus = formElement.dataset.columnStatus;
      const taskToSave = {
        id: generateId(),
        projectId: currentSelectedProjectId,
        title,
        status: columnStatus,
        done: columnStatus === "done",
        doneAt: columnStatus === "done" ? new Date().toISOString() : null,
        priority,
        dueDate,
        description: "",
        order: 0,
      };
      await addTask(taskToSave);
      await recordChangelogEntry("add", currentSelectedProjectId, "tasks", "タスク", taskToSave.id, taskToSave.title, null, taskToSave, {});
      openKanbanAddFormColumnStatus = null;
      await refreshKanbanPanel(currentSelectedProjectId);
    }

    // 【前提】task は編集対象の既存タスクオブジェクト。
    // 【処理】タイトル・ステータス・優先度・期日・メモ（詳細）の入力欄を持つモーダルの
    //   HTML文字列を組み立てる（詳細設計書3.3.2：saveTodoEdit相当。作成後は一切編集
    //   できなかった従来の制約を解消する。新規作成は列埋め込みフォームで行うため、
    //   このモーダルは編集専用で新規作成モードを持たない）。
    // 【結果】モーダルパネルにそのまま入れられるHTML文字列を返す。
    function renderTaskModalToHtml(task) {
      const statusOptionsHtml = Object.entries(TASK_STATUS_LABELS)
        .map(([value, label]) => `<option value="${value}"${value === task.status ? " selected" : ""}>${label}</option>`)
        .join("");
      const priorityOptionsHtml = Object.entries(TASK_PRIORITY_LABELS)
        .map(([value, label]) => `<option value="${value}"${Number(value) === task.priority ? " selected" : ""}>${label}</option>`)
        .join("");
      return `
        <h2>タスク編集</h2>
        <div class="modal-field">
          <label for="taskModalTitleInput">タスク名</label>
          <input type="text" id="taskModalTitleInput" value="${escapeHtmlText(task.title)}">
        </div>
        <div class="modal-field">
          <label for="taskModalStatusSelect">ステータス</label>
          <select id="taskModalStatusSelect">${statusOptionsHtml}</select>
        </div>
        <div class="modal-field">
          <label for="taskModalPrioritySelect">優先度</label>
          <select id="taskModalPrioritySelect">${priorityOptionsHtml}</select>
        </div>
        <div class="modal-field">
          <label for="taskModalDueDateInput">期日</label>
          <input type="date" id="taskModalDueDateInput" value="${escapeHtmlText(task.dueDate || "")}">
        </div>
        <div class="modal-field">
          <label for="taskModalDescriptionTextarea">メモ（詳細）</label>
          <textarea id="taskModalDescriptionTextarea" rows="4">${escapeHtmlText(task.description || "")}</textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="modal-button-secondary" id="taskModalCancelButton">キャンセル</button>
          <button type="button" class="modal-button-primary" id="taskModalSaveButton">保存</button>
        </div>
      `;
    }

    // 【前提】task は編集対象の既存タスクオブジェクト。
    // 【処理】タスク編集モーダルを開き、キャンセル・保存にイベントを登録する。
    // 【結果】モーダルが操作可能な状態で表示される。
    function openTaskEditModal(task) {
      openModal(renderTaskModalToHtml(task));
      document.getElementById("taskModalCancelButton").addEventListener("click", closeModal);
      document.getElementById("taskModalSaveButton").addEventListener("click", () => handleTaskModalSaveButtonClick(task));
    }

    // 【前提】existingTask は編集開始時点のタスクオブジェクト。
    // 【処理】モーダル内の入力値を読み取り、タイトルが空でなければaddTaskで上書き保存する。
    //   ステータスを"done"に変更した場合はdoneAtを現在時刻にし、"done"以外に変更した場合は
    //   done/doneAtをリセットする（列埋め込みフォームでの新規作成時と同じ不変条件を維持する。
    //   すでに"done"だった場合はdoneAtの上書きをせず、最初に完了した時刻を保持する）。
    // 【結果】保存成功時はモーダルを閉じ、カンバンパネルを更新する。
    async function handleTaskModalSaveButtonClick(existingTask) {
      const title = document.getElementById("taskModalTitleInput").value.trim();
      if (!title) {
        window.alert("タスク名を入力してください");
        return;
      }
      const status = document.getElementById("taskModalStatusSelect").value;
      const priority = Number(document.getElementById("taskModalPrioritySelect").value);
      const dueDate = document.getElementById("taskModalDueDateInput").value;
      const description = document.getElementById("taskModalDescriptionTextarea").value;
      const taskToSave = {
        ...existingTask,
        title,
        status,
        priority,
        dueDate,
        description,
        done: status === "done",
        doneAt: status === "done" ? (existingTask.status === "done" ? existingTask.doneAt : new Date().toISOString()) : null,
      };
      await addTask(taskToSave);
      closeModal();
      await refreshKanbanPanel(currentSelectedProjectId);
    }

    // 【前提】taskId はクリックされたカードのタスクid。
    // 【処理】最新のタスク一覧から対象を探し、編集モーダルを開く。
    // 【結果】編集モーダルが表示される。
    async function handleOpenTaskEditModalClick(taskId) {
      const taskList = await getTasksByProject(currentSelectedProjectId);
      const task = taskList.find((candidateTask) => candidateTask.id === taskId);
      if (!task) return;
      openTaskEditModal(task);
    }

    // 【前提】taskId は移動対象のタスクid。targetColumnStatus はドロップ先の列status
    //   （"backlog"|"doing"|"done"）。
    // 【処理】対象タスクのstatusをtargetColumnStatusに更新する（詳細設計書3.3.3：
    //   dropTodoCard。基本設計書1.3節に明記されている既知の非整合どおり、タスクのstatusは
    //   スケジュールのtaskStatusとは独立した別概念のため、他ストアとの連動は行わない）。
    //   ステータスを"done"に変更した場合のみdoneAtを現在時刻にする（編集モーダル保存時と
    //   同じ不変条件を維持する）。
    // 【結果】ステータスが実際に変わっていれば保存してカンバンパネルを再描画する。同じ列への
    //   ドロップ等、変わっていなければ何もしない。
    async function handleTaskDragDrop(taskId, targetColumnStatus) {
      const taskList = await getTasksByProject(currentSelectedProjectId);
      const task = taskList.find((candidateTask) => candidateTask.id === taskId);
      if (!task || task.status === targetColumnStatus) return;
      await addTask({
        ...task,
        status: targetColumnStatus,
        done: targetColumnStatus === "done",
        doneAt: targetColumnStatus === "done" ? new Date().toISOString() : null,
      });
      await refreshKanbanPanel(currentSelectedProjectId);
    }

