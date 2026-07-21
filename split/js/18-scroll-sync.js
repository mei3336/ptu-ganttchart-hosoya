    // ===== WBSパネルとガント本体の縦スクロール同期（対応表No.41） =====
    // 【設計判断】#wbsPanelと.gantt-scroll-areaは、それぞれ独立したoverflow-y:autoの
    //   スクロールコンテナ（CSS側でheight:100%＋overflow-y:autoを付与済み）。片方をscrollTopで
    //   追従させると、その操作自体がscrollイベントを発火させ、もう片方が今度は最初の要素を
    //   追従させようとして…と無限に呼び合う恐れがある。isSyncingVerticalScrollという
    //   同期中フラグを1つ持ち、「自分がスクロールを起こした側の処理中である間は、相手からの
    //   scrollイベントを無視する」ことでこの無限ループを防ぐ。
    let isSyncingVerticalScroll = false;

    // 【前提】WBSパネルのscrollイベントから呼ばれる。
    // 【処理】isSyncingVerticalScrollが立っていれば何もしない（ガント側の同期処理が今まさに
    //   WBSパネルのscrollTopを書き換えたことで発火したscrollイベントのため、ここで反応すると
    //   無限ループになる）。そうでなければフラグを立てて、ガント側のscrollTopをWBS側に
    //   合わせ、フラグを下ろす。
    // 【結果】ガント本体がWBSパネルと同じ縦位置までスクロールされる。
    function handleWbsPanelVerticalScroll() {
      if (isSyncingVerticalScroll) return;
      isSyncingVerticalScroll = true;
      document.querySelector(".gantt-scroll-area").scrollTop = document.getElementById("wbsPanel").scrollTop;
      isSyncingVerticalScroll = false;
    }

    // 【前提】ガント本体（.gantt-scroll-area）のscrollイベントから呼ばれる。
    // 【処理】handleWbsPanelVerticalScrollと対になる処理。isSyncingVerticalScrollが立っていれば
    //   何もしない（WBS側の同期処理由来のscrollイベントのため）。そうでなければフラグを立てて
    //   WBSパネルのscrollTopをガント側に合わせ、フラグを下ろす。
    // 【結果】WBSパネルがガント本体と同じ縦位置までスクロールされる。
    function handleGanttScrollAreaVerticalScroll() {
      if (isSyncingVerticalScroll) return;
      isSyncingVerticalScroll = true;
      document.getElementById("wbsPanel").scrollTop = document.querySelector(".gantt-scroll-area").scrollTop;
      isSyncingVerticalScroll = false;
    }

    // ===== ガント背景ドラッグによる自動スクロール（対応表No.42） =====
    // 【設計判断】ganttPanelBodyへのpointerdownは、既存のバードラッグ処理
    //   （handleBarPointerDown呼び出し側）が「.gantt-bar要素が見つかった場合のみ」処理する
    //   分岐になっている。背景ドラッグはその逆＝「.gantt-bar要素が見つからなかった場合」に
    //   だけ開始するため、既存のバー操作とは完全に排他で干渉しない（同じイベントの中で
    //   if/elseのどちらか一方だけが実行される）。
    //   ドラッグ中の状態はisBackgroundDraggingという専用フラグで管理し、バードラッグの
    //   draggedBarScheduleIdとは別の変数のため、document側のpointermove/pointerupリスナーも
    //   互いのフラグを見て自分の担当外なら何もしないだけで、取り合いにならない。
    //   スクロール位置の直接書き換えは.gantt-scroll-areaのscrollイベントを発火させるため、
    //   対応表No.41で実装したhandleGanttScrollAreaVerticalScrollが自動的にWBSパネルを
    //   追従させる（背景ドラッグ用に別の同期処理は不要）。

    // ドラッグ中かどうか。ドラッグ開始時点のポインタ座標・スクロール位置も保持する。
    let isBackgroundDragging = false;
    let backgroundDragStartClientX = 0;
    let backgroundDragStartClientY = 0;
    let backgroundDragStartScrollLeft = 0;
    let backgroundDragStartScrollTop = 0;

    // 【前提】event はganttPanelBody上でのpointerdownイベントのうち、.gantt-bar要素にも
    //   .gantt-bar-handleにも当たらなかった場合（＝何もない背景／グリッド部分）にのみ呼ばれる。
    // 【処理】ドラッグ開始時点のポインタ座標と、.gantt-scroll-areaの現在のスクロール位置を
    //   記録する。カーソルを「掴んでいる」見た目にするクラスを付ける。
    // 【結果】背景ドラッグの状態が開始される（実際のスクロールはpointermoveハンドラが行う）。
    function handleGanttBackgroundPointerDown(event) {
      isBackgroundDragging = true;
      backgroundDragStartClientX = event.clientX;
      backgroundDragStartClientY = event.clientY;
      const scrollAreaElement = document.querySelector(".gantt-scroll-area");
      backgroundDragStartScrollLeft = scrollAreaElement.scrollLeft;
      backgroundDragStartScrollTop = scrollAreaElement.scrollTop;
      scrollAreaElement.classList.add("is-background-dragging");
    }

    // 【前提】isBackgroundDraggingが設定済み（ドラッグ中）であること。
    // 【処理】ポインタの移動量を計算し、地図アプリと同じ向き（ポインタを右へ動かす＝
    //   コンテンツを右へ引く＝スクロール位置は左へ動く）でscrollLeft/scrollTopを
    //   「開始時のスクロール位置－移動量」に設定する。
    // 【結果】ガント本体（および対応表No.41の同期によりWBSパネルも）がポインタに追従してスクロールする。
    function handleGanttBackgroundPointerMove(event) {
      if (!isBackgroundDragging) return;
      const deltaX = event.clientX - backgroundDragStartClientX;
      const deltaY = event.clientY - backgroundDragStartClientY;
      const scrollAreaElement = document.querySelector(".gantt-scroll-area");
      scrollAreaElement.scrollLeft = backgroundDragStartScrollLeft - deltaX;
      scrollAreaElement.scrollTop = backgroundDragStartScrollTop - deltaY;
    }

    // 【前提】なし。
    // 【処理】ドラッグ状態を終了し、カーソルの見た目を元に戻す。
    // 【結果】背景ドラッグが終了する。
    function handleGanttBackgroundPointerUp() {
      if (!isBackgroundDragging) return;
      isBackgroundDragging = false;
      document.querySelector(".gantt-scroll-area").classList.remove("is-background-dragging");
    }

    // 【前提】granularity は "day" | "week" | "month" | "quarter"。buttonElement はクリックされたボタン。
    // 【処理】表示粒度を切り替え、ボタンの選択状態を更新した上でガントパネルを再描画する
    //   （DBへの再問い合わせは不要。currentProjectObjectの日付情報だけで再計算できるため）。
    // 【結果】ガントチャートが新しい粒度の見出し・列幅で再描画される。
    function handleGranularityButtonClick(granularity, buttonElement) {
      currentGranularity = granularity;
      for (const granularityButton of document.querySelectorAll("[data-granularity]")) {
        granularityButton.classList.toggle("is-active", granularityButton === buttonElement);
      }
      refreshGanttPanel(currentSelectedProjectId);
    }

    // 【前提】columnKey は "startDate" | "endDate" | "status"。buttonElement はクリックされたボタン。
    // 【処理】該当列の表示/非表示を反転させ、ボタンの選択状態を更新した上で、
    //   キャッシュ済みのcurrentScheduleTreeRowsを使ってWBSパネルだけを再描画する
    //   （DBへの再問い合わせは不要。表示/非表示の切り替えだけなのでガント本体は再描画しない）。
    // 【結果】WBSパネルに列が追加/削除された状態が反映される。
    function handleToggleColumnClick(columnKey, buttonElement) {
      visibleWbsColumns[columnKey] = !visibleWbsColumns[columnKey];
      buttonElement.classList.toggle("is-active", visibleWbsColumns[columnKey]);
      applyWbsPanel(renderWbsPanelToHtml(currentScheduleTreeRows, visibleWbsColumns, collapsedScheduleIds));
    }

    // 【前提】なし。
    // 【処理】タスク管理（P1）は右側スライドパネルの開閉トグル（toggleSlidePanel）。
    //   マインドマップ（P7）もSIDE_PANEL_DEFINITIONS経由の共通配線に統合済みのため、
    //   ここではP1のみを扱う（P1は既存の専用ハンドラのまま据え置いている）。
    // 【結果】タスク管理パネルの開閉が行われる。
    function handleSwitchToKanbanButtonClick() {
      toggleSlidePanel("kanbanSlidePanel");
      document.getElementById("switchToKanbanButton").classList.toggle(
        "is-active",
        document.getElementById("kanbanSlidePanel").classList.contains("is-open")
      );
    }

    // 【前提】event.currentTargetがdata-out-of-scope-label属性を持つボタンであること。
    // 【処理】今回のスコープ外機能（サイドパネル・モーダル・インポート/エクスポート等）を
    //   クリックした際、「未実装ではなく意図的なスコープ外」であることを利用者に伝える。
    // 【結果】アラートで機能名とスコープ外である旨を表示する（データは変更しない）。
    function handleOutOfScopeButtonClick(event) {
      const featureLabel = event.currentTarget.dataset.outOfScopeLabel;
      window.alert(`「${featureLabel}」は今回のスコープ外です（別工程で実装予定）。`);
    }

