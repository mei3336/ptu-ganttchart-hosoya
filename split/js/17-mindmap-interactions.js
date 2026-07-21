    // ===== 追加実装仕様書8.1節：マインドマップのインライン編集 =====
    // 【設計判断】お手本ganttforge.html mmAddChild/mmAddSibling/mmSaveEdit/mmEditKeyを踏襲する。
    //   確認モーダル（prompt）は廃止し、「タイトル未確定（空文字）のノードを直接キャンバス上に
    //   出現させ、その場でタイトルを入力させる」方式に統一する。本アプリはDBの状態から
    //   毎回HTML文字列を再構築する設計のため、お手本のように既存DOM要素へ直接<input>を
    //   差し込むのではなく、「どのissueがインライン編集中か」をmindmapIssueIdPendingInlineEdit
    //   に持たせ、renderMindmapCanvasToHtmlにその状態を反映させる形で実現する。

    // 【前提】parentIssueId は新規ノードの親issueのid（現在のプロジェクトの実在issueであること）。
    // 【処理】タイトル未確定（空文字）の子ノードを作成し、自動レイアウトを再計算してから、
    //   そのノードをインライン編集中としてマークして再描画する（追加実装仕様書8.1・8.3節）。
    //   親が折りたたまれていた場合は展開する（新規ノードが隠れて見えなくなるのを防ぐため）。
    // 【結果】キャンバス上に無題ノードが出現し、タイトル入力可能な状態になる。
    async function createMindmapChildNodeWithInlineEdit(parentIssueId) {
      if (!currentSelectedProjectId) return;
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const parentIssue = issueList.find((issue) => issue.id === parentIssueId);
      if (!parentIssue) return;
      const depthLevel = calculateIssueDepthLevel(parentIssueId, issueList) + 1;
      const colorIndex = Math.floor(Math.random() * MINDMAP_NODE_COLORS.length);
      const newIssue = {
        id: generateId(),
        projectId: currentSelectedProjectId,
        title: "",
        parentNodeId: parentIssueId,
        x: parentIssue.x,
        y: parentIssue.y,
        color: MINDMAP_NODE_COLORS[colorIndex],
        order: issueList.length * 10,
      };
      await addIssue(newIssue);
      await applyMindmapAutoLayout(currentSelectedProjectId);
      collapsedMindmapIssueIds.delete(parentIssueId);
      mindmapIssueIdPendingInlineEdit = newIssue.id;
      await refreshMindmapPanel(currentSelectedProjectId);
    }

    // 【前提】issueId は入力中のノードのid。inputElement は対応する<input>要素。
    // 【処理】入力値を確定する。Escapeでキャンセルされていた場合、または空文字のままの場合は
    //   ノード自体を削除する（お手本mmSaveEditと同じ「空のまま保存→新規ノードを削除」の挙動）。
    //   それ以外は入力値をタイトルとして保存し、変更履歴に「追加」として記録する
    //   （新規ノードの追加操作自体は、タイトルが確定した時点で完了とみなす）。
    // 【結果】インライン編集状態を解除し、パネルを再描画する。
    async function handleMindmapInlineEditInputBlur(issueId, inputElement) {
      const wasCancelledByEscape = mindmapInlineEditCancelledByEscape;
      mindmapInlineEditCancelledByEscape = false;
      mindmapIssueIdPendingInlineEdit = null;

      const trimmedTitle = inputElement.value.trim();
      if (wasCancelledByEscape || !trimmedTitle) {
        await deleteIssue(issueId);
        await applyMindmapAutoLayout(currentSelectedProjectId);
        await refreshMindmapPanel(currentSelectedProjectId);
        return;
      }

      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const existingIssue = issueList.find((issue) => issue.id === issueId);
      if (!existingIssue) return;
      const issueToSave = { ...existingIssue, title: trimmedTitle };
      await addIssue(issueToSave);
      await recordChangelogEntry("add", issueToSave.projectId, "issues", "マインドマップノード", issueToSave.id, issueToSave.title, null, issueToSave, ISSUE_LOGGED_FIELD_LABELS);
      await refreshMindmapPanel(currentSelectedProjectId);
    }

    // 【前提】event はインライン編集<input>のkeydownイベント。
    // 【処理】Enterで確定（blurさせて保存処理に委ねる）、Escapeで破棄（キャンセルフラグを
    //   立ててからblurさせる）。お手本mmEditKeyと同じ挙動。
    // 【結果】inputからフォーカスが外れ、handleMindmapInlineEditInputBlurが呼ばれる。
    function handleMindmapInlineEditInputKeydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        mindmapInlineEditCancelledByEscape = true;
        event.target.blur();
      }
    }

    // 【前提】renderMindmapCanvasToHtmlの結果がすでにDOMへ反映済みであること。
    // 【処理】mindmapIssueIdPendingInlineEdit相当の<input>要素が存在すれば、フォーカス・
    //   全選択し、keydown/blurのイベントを結びつける（innerHTML差し替えのたびにイベント
    //   リスナーは失われるため、描画後は必ずこの関数を呼び直す必要がある）。
    // 【結果】インライン編集中の<input>が操作可能になる。
    function attachMindmapInlineEditInputEvents() {
      const inputElement = document.querySelector(".mindmap-inline-edit-input");
      if (!inputElement) return;
      const issueId = inputElement.dataset.issueId;
      inputElement.addEventListener("keydown", handleMindmapInlineEditInputKeydown);
      inputElement.addEventListener("blur", () => handleMindmapInlineEditInputBlur(issueId, inputElement));
      inputElement.focus();
      inputElement.select();
    }

    // 【前提】currentSelectedProjectIdが設定済みであること。refreshMindmapPanel（8.2節）に
    //   より、ルートノード（プロジェクト名）は必ず1件存在する前提。
    // 【処理】ルートノードの子として、インライン編集中の無題ノードを作成する
    //   （追加実装仕様書8.1節：トップの「＋ノード追加」ボタンも、お手本と同じ追加操作として
    //   インライン編集方式に統一する）。
    // 【結果】createMindmapChildNodeWithInlineEditと同じ。
    async function handleAddIssueButtonClick() {
      if (!currentSelectedProjectId) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const rootIssue = issueList.find((issue) => issue.parentNodeId === null || issue.parentNodeId === undefined);
      if (!rootIssue) return;
      await createMindmapChildNodeWithInlineEdit(rootIssue.id);
    }

    // ===== マインドマップ：ノードのドラッグ配置 =====
    // 【設計判断】ノードの自由な2次元配置の変更は、HTML5のdraggable属性（discreteな
    //   ドロップ先を前提とするAPIで、WBS行の並び替えのような「入れ替え」向き）ではなく、
    //   pointerdown/pointermove/pointerupで座標を直接計算する方式にする。
    //   ドラッグ中は見た目（left/top）だけを更新し、DBへの保存はpointerup時の1回だけ行う
    //   （ドラッグ中に毎回addIssueするのは書き込み回数・再描画の面で無駄なため）。

    // ドラッグ中のノードのissueId。ドラッグしていない時はnull。
    let draggedMindmapIssueId = null;
    let mindmapDragStartPointerX = 0;
    let mindmapDragStartPointerY = 0;
    let mindmapDragStartNodeX = 0;
    let mindmapDragStartNodeY = 0;
    // これ未満の移動量は「クリック」とみなし、座標の保存を行わない（誤操作での無駄な書き込み防止）。
    const MINDMAP_DRAG_THRESHOLD_PX = 3;

    // 【前提】event はmindmap-node要素上でのpointerdownイベント。issueId はそのノードのid。
    //   nodeElement はイベントが発生した実際のDOM要素。
    // 【処理】ドラッグ開始時点のポインタ座標・ノード座標を記録する（以降のpointermoveで
    //   差分計算するための基準点）。
    // 【結果】ドラッグ状態が開始される（実際の座標更新はpointermoveハンドラが行う）。
    function handleMindmapNodePointerDown(event, issueId, nodeElement) {
      draggedMindmapIssueId = issueId;
      mindmapDragStartPointerX = event.clientX;
      mindmapDragStartPointerY = event.clientY;
      mindmapDragStartNodeX = parseFloat(nodeElement.style.left) || 0;
      mindmapDragStartNodeY = parseFloat(nodeElement.style.top) || 0;
      nodeElement.classList.add("is-dragging");
      nodeElement.setPointerCapture(event.pointerId);
    }

    // 【前提】draggedMindmapIssueIdが設定済み（ドラッグ中）であること。
    // 【処理】ポインタの移動量ぶん、ドラッグ中ノードのleft/topスタイルを直接書き換える。
    //   DBへの保存はしない（見た目だけをポインタに追従させる）。
    // 【結果】ノードが視覚的にポインタへ追従する。
    function handleMindmapNodePointerMove(event) {
      if (!draggedMindmapIssueId) return;
      const nodeElement = document.querySelector(`.mindmap-node[data-issue-id="${draggedMindmapIssueId}"]`);
      if (!nodeElement) return;
      const deltaX = event.clientX - mindmapDragStartPointerX;
      const deltaY = event.clientY - mindmapDragStartPointerY;
      nodeElement.style.left = `${mindmapDragStartNodeX + deltaX}px`;
      nodeElement.style.top = `${mindmapDragStartNodeY + deltaY}px`;
    }

    // 【前提】ドラッグ中であること。
    // 【処理】移動量がMINDMAP_DRAG_THRESHOLD_PX未満なら「クリック」とみなし何もしない。
    //   それ以上動いていれば、最終的なleft/topをissueのx/yとしてaddIssueで保存する
    //   （辺の再描画はrefreshMindmapPanelに任せる）。
    // 【結果】ノードの新しい座標がDBに保存され、パネルが再描画される。
    async function handleMindmapNodePointerUp(event) {
      if (!draggedMindmapIssueId) return;
      const issueId = draggedMindmapIssueId;
      draggedMindmapIssueId = null;
      const nodeElement = document.querySelector(`.mindmap-node[data-issue-id="${issueId}"]`);
      if (!nodeElement) return;
      nodeElement.classList.remove("is-dragging");

      const deltaX = event.clientX - mindmapDragStartPointerX;
      const deltaY = event.clientY - mindmapDragStartPointerY;
      if (Math.abs(deltaX) < MINDMAP_DRAG_THRESHOLD_PX && Math.abs(deltaY) < MINDMAP_DRAG_THRESHOLD_PX) {
        return;
      }

      const newX = Math.round(mindmapDragStartNodeX + deltaX);
      const newY = Math.round(mindmapDragStartNodeY + deltaY);
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const existingIssue = issueList.find((issue) => issue.id === issueId);
      if (!existingIssue) return;
      await addIssue({ ...existingIssue, x: newX, y: newY });
      await refreshMindmapPanel(currentSelectedProjectId);
    }

    // ===== マインドマップ：右クリックメニュー =====
    // 【設計判断】メニューはDOM上に1つだけ常設し（#mindmapContextMenu）、開くたびに
    //   表示位置（クリック位置）とcurrentContextMenuIssueId（対象ノード）を差し替える。
    //   モーダルと同じ「入れ物を使い回す」設計に揃えている。

    // 現在メニューが開いている対象ノードのissueId。閉じている間はnull。
    let currentContextMenuIssueId = null;

    // 【前提】issueId は右クリックされたノードのid。clientX/clientY はイベント発生位置。
    // 【処理】メニューを対象ノードのidと紐づけて、クリックされた座標に表示する。
    // 【結果】右クリックメニューが画面上に表示される。
    function openMindmapContextMenu(issueId, clientX, clientY) {
      currentContextMenuIssueId = issueId;
      const menuElement = document.getElementById("mindmapContextMenu");
      menuElement.style.left = `${clientX}px`;
      menuElement.style.top = `${clientY}px`;
      menuElement.hidden = false;
    }

    // 【前提】なし。
    // 【処理】メニューを非表示にし、対象ノードの紐づけを解除する。
    // 【結果】右クリックメニューが閉じる。
    function closeMindmapContextMenu() {
      currentContextMenuIssueId = null;
      document.getElementById("mindmapContextMenu").hidden = true;
    }

    // 変更履歴（changelog）に記録するissue(マインドマップノード)の対象フィールド。
    // 現状ユーザーが直接編集できる値はtitle（名前変更）のみのため、これだけを対象にする
    // （x/y座標はドラッグのたびに変わるため対象に含めない＝下記の判断ポイント参照）。
    const ISSUE_LOGGED_FIELD_LABELS = { title: "名前" };

    // 【前提】issueId は名前を変更したいノードのid。
    // 【処理】prompt()で新しい名前を受け取り、空でなければaddIssueで保存する
    //   （モーダル・ダイアログ一覧P7：右クリックメニュー「名前を変更」に対応）。
    // 【結果】保存後、変更履歴を記録し、パネルを再描画する。
    async function handleRenameIssueButtonClick(issueId) {
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const existingIssue = issueList.find((issue) => issue.id === issueId);
      if (!existingIssue) return;
      const newTitle = window.prompt("新しいノード名を入力してください", existingIssue.title);
      if (!newTitle) return;
      const issueToSave = { ...existingIssue, title: newTitle };
      await addIssue(issueToSave);
      await recordChangelogEntry("edit", issueToSave.projectId, "issues", "マインドマップノード", issueToSave.id, issueToSave.title, existingIssue, issueToSave, ISSUE_LOGGED_FIELD_LABELS);
      await refreshMindmapPanel(currentSelectedProjectId);
    }

    // 【前提】parentIssueId は子ノードを追加したい親ノードのid。
    // 【処理】createMindmapChildNodeWithInlineEditへ委譲する（モーダル・ダイアログ一覧P7：
    //   右クリックメニュー「子ノード追加」に対応。追加実装仕様書8.1節：インライン編集方式）。
    // 【結果】createMindmapChildNodeWithInlineEditと同じ。
    async function handleAddChildIssueButtonClick(parentIssueId) {
      await createMindmapChildNodeWithInlineEdit(parentIssueId);
    }

    // 【前提】siblingIssueId は兄弟ノードを追加したい基準ノードのid。
    // 【処理】siblingIssueIdと同じparentNodeIdを持つ位置に、createMindmapChildNodeWithInlineEdit
    //   経由でインライン編集中の新規ノードを作成する（モーダル・ダイアログ一覧P7：右クリック
    //   メニュー「兄弟ノード追加」に対応。追加実装仕様書8.1節）。基準ノードがルート
    //   （parentNodeId:null）の場合は何もしない（お手本mmAddSiblingと同じ制約。ルートは
    //   8.2節により常に1件の前提を保つ）。
    // 【結果】createMindmapChildNodeWithInlineEditと同じ。
    async function handleAddSiblingIssueButtonClick(siblingIssueId) {
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const siblingIssue = issueList.find((issue) => issue.id === siblingIssueId);
      if (!siblingIssue) return;
      if (siblingIssue.parentNodeId === null || siblingIssue.parentNodeId === undefined) return;
      await createMindmapChildNodeWithInlineEdit(siblingIssue.parentNodeId);
    }

    // 【前提】action は右クリックメニューのdata-action値（"rename"|"add-child"|"add-sibling"|
    //   "toggle-collapse"|"delete"）。currentContextMenuIssueIdがメニューを開いた時点の
    //   対象ノードを保持している。
    // 【処理】メニューを閉じてから、actionに応じた処理へ委譲する。
    // 【結果】選択した操作が実行される。
    async function handleMindmapContextMenuAction(action) {
      const issueId = currentContextMenuIssueId;
      closeMindmapContextMenu();
      if (!issueId) return;
      if (action === "rename") {
        await handleRenameIssueButtonClick(issueId);
      } else if (action === "add-child") {
        await handleAddChildIssueButtonClick(issueId);
      } else if (action === "add-sibling") {
        await handleAddSiblingIssueButtonClick(issueId);
      } else if (action === "toggle-collapse") {
        handleToggleIssueCollapseButtonClick(issueId);
      } else if (action === "delete") {
        await handleDeleteIssueButtonClick(issueId);
      }
    }

    // 【前提】issueId は削除起点のノードid。
    // 【処理】削除対象件数（起点＋子孫）をcollectIssueSubtreeIdsで数え、詳細設計書3.5.3節の
    //   仕様どおり3件を超える場合のみconfirm()で確認する（3件以下は誤操作しても
    //   取り返しがつく範囲とみなし、即削除する）。
    // 【結果】確認OK、または3件以下ならdeleteIssueCascadeで削除し、自動レイアウトを
    //   再計算してから（追加実装仕様書8.3節：削除のたびに再計算）パネルを再描画する。
    //   キャンセル時は何もしない。
    async function handleDeleteIssueButtonClick(issueId) {
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      if (!issueList.some((issue) => issue.id === issueId)) return;
      const subtreeIds = collectIssueSubtreeIds(issueList, issueId);
      if (subtreeIds.length > 3) {
        const confirmMessage = `このノードと子孫ノード計${subtreeIds.length}件を削除しますか？`;
        if (!window.confirm(confirmMessage)) return;
      }
      await deleteIssueCascade(issueId, currentSelectedProjectId);
      await applyMindmapAutoLayout(currentSelectedProjectId);
      await refreshMindmapPanel(currentSelectedProjectId);
    }

    // 【前提】issueId は開閉を切り替えたいノードのid。
    // 【処理】collapsedMindmapIssueIdsへの追加/削除だけを行い、パネルを再描画する
    //   （折りたたみ状態はDB非保存の画面上だけの一時状態。collapsedScheduleIdsと同じ設計）。
    // 【結果】対象ノードの子孫が表示/非表示になる。
    function handleToggleIssueCollapseButtonClick(issueId) {
      if (collapsedMindmapIssueIds.has(issueId)) {
        collapsedMindmapIssueIds.delete(issueId);
      } else {
        collapsedMindmapIssueIds.add(issueId);
      }
      refreshMindmapPanel(currentSelectedProjectId);
    }

    // 【前提】currentProjectObjectが設定済み（プロジェクト選択済み）であること。
    // 【処理】現在のプロジェクトのlockedを反転させて保存し、画面のロック表示を更新する
    //   （基本設計書3.3節：ロックONで薄赤帯表示・スケジュール追加ボタン無効化）。
    // 【結果】ロック状態がDBに保存され、画面にも反映される。トースト「ロックしました」／
    //   「ロックを解除しました」を、切替後の状態に応じて表示する（詳細設計書3.1.3）。
    async function handleLockToggleButtonClick() {
      if (!currentProjectObject) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const updatedProject = { ...currentProjectObject, locked: !currentProjectObject.locked };
      await addProject(updatedProject);
      currentProjectObject = updatedProject;
      applyLockState(updatedProject.locked);
      showToast(updatedProject.locked ? "ロックしました" : "ロックを解除しました");
    }

    // 【前提】currentTimelineStartDateStringが設定済み（ガントパネルが1度は描画済み）であること。
    // 【処理】今日の日付がタイムライン先頭から何日目かを計算し、その位置が見えるよう
    //   ガントのスクロール領域を横スクロールする（基本設計書2.2節「今日」ボタンの仕様）。
    // 【結果】ガントチャートが今日の日付付近までスクロールされる。
    function handleTodayButtonClick() {
      if (!currentTimelineStartDateString) return;
      const todayDateString = new Date().toISOString().slice(0, 10);
      const dayOffset = calculateDayOffsetFromTimelineStart(todayDateString, currentTimelineStartDateString);
      const pixelsPerDay = GRANULARITY_PIXELS_PER_DAY[currentGranularity];
      document.querySelector(".gantt-scroll-area").scrollLeft = Math.max(dayOffset * pixelsPerDay - 100, 0);
    }

