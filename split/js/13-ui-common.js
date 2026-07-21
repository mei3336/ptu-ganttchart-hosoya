    // ===== サイドパネルのリサイズハンドル（UI差分表No.76） =====
    // 【設計判断】7つのスライドパネル（P1〜P6＋マインドマップ）はすべて.slide-panel共通CSSで
    //   幅640px固定になっている（UI差分表8-3備考）。7箇所のHTMLへ同じハンドルを書く代わりに、
    //   初期化時に全.slide-panelの先頭へ動的挿入する。ドラッグ処理はマインドマップノードの
    //   pointerdown/pointermove/pointerupと同じパターン。

    // これ未満の幅にはできない（UIデザイン仕様書：メモパネル同種の記述「最小280px」を
    // 全パネル共通の下限として採用）。
    const PANEL_RESIZE_MIN_WIDTH_PX = 280;

    // リサイズ中のパネル要素。ドラッグしていない時はnull。
    let resizingPanelElement = null;
    let panelResizeStartPointerX = 0;
    let panelResizeStartWidthPx = 0;

    // 【前提】なし（DOMContentLoaded後に1度だけ呼ぶ）。
    // 【処理】すべての.slide-panelの先頭に.panel-resize-handleを1つ挿入する。
    // 【結果】各パネルの左端にリサイズハンドルが表示される。
    function initializePanelResizeHandles() {
      for (const panelElement of document.querySelectorAll(".slide-panel")) {
        const handleElement = document.createElement("div");
        handleElement.className = "panel-resize-handle";
        panelElement.prepend(handleElement);
      }
    }

    // 【前提】event は.panel-resize-handle上でのpointerdownイベント。
    // 【処理】対象パネルとドラッグ開始時点のポインタ座標・パネル幅を記録する。
    // 【結果】リサイズ状態が開始される（実際の幅変更はpointermoveハンドラが行う）。
    function handlePanelResizePointerDown(event) {
      const handleElement = event.target.closest(".panel-resize-handle");
      if (!handleElement) return;
      resizingPanelElement = handleElement.closest(".slide-panel");
      if (!resizingPanelElement) return;
      panelResizeStartPointerX = event.clientX;
      panelResizeStartWidthPx = resizingPanelElement.getBoundingClientRect().width;
      handleElement.classList.add("is-resizing");
      handleElement.setPointerCapture(event.pointerId);
    }

    // 【前提】resizingPanelElementが設定済み（リサイズ中）であること。
    // 【処理】ポインタの移動量ぶん幅を変更する。パネルは画面右端に固定（right:0）のため、
    //   左端のハンドルを左へ引くほど幅が増える（移動量の符号を反転させて加算）。
    //   下限PANEL_RESIZE_MIN_WIDTH_PX・上限92vw（既存のmax-widthと同じ）でクランプする。
    // 【結果】パネルの見た目の幅がポインタに追従する。
    function handlePanelResizePointerMove(event) {
      if (!resizingPanelElement) return;
      const deltaX = event.clientX - panelResizeStartPointerX;
      const newWidthPx = panelResizeStartWidthPx - deltaX;
      const maxWidthPx = window.innerWidth * 0.92;
      const clampedWidthPx = Math.min(Math.max(newWidthPx, PANEL_RESIZE_MIN_WIDTH_PX), maxWidthPx);
      resizingPanelElement.style.width = `${clampedWidthPx}px`;
    }

    // 【前提】なし。
    // 【処理】リサイズ中のハンドルからis-resizingクラスを外し、状態をリセットする。
    // 【結果】ドラッグが終了する（幅はその時点の値のまま維持される。DB保存はしない＝
    //   画面上だけの一時状態。collapsedScheduleIds等と同じ設計判断）。
    function handlePanelResizePointerUp() {
      if (!resizingPanelElement) return;
      resizingPanelElement.querySelector(".panel-resize-handle.is-resizing")?.classList.remove("is-resizing");
      resizingPanelElement = null;
    }

    // ===== 共通UI：トースト通知（UIデザイン仕様書2.4節） =====

    // トーストを消すタイマーのID。連続してshowToastを呼んだとき、前回のタイマーを
    // clearTimeoutでリセットし「最後の呼び出しから一定時間後に消える」を保証するために保持する
    // （初期値null＝まだ一度も表示していない）。
    let toastHideTimeoutId = null;

    // トーストが表示され続ける時間（ミリ秒）。UIデザイン仕様書2.4節「約2.8秒で自動的に消える」。
    const TOAST_VISIBLE_DURATION_MS = 2800;

    // 【前提】message は画面右下に表示したい通知文。
    // 【処理】#toast要素にmessageを差し込み、showクラスを付けてCSSトランジションで表示する。
    //   すでに表示中のトーストがある場合は、そのタイマーをclearTimeoutで打ち切ってから
    //   新しいタイマーを仕掛け直す（連続呼び出し時に、古いタイマーで消えてしまわないようにするため）。
    // 【結果】TOAST_VISIBLE_DURATION_MS後にshowクラスが外れ、トーストが消える（戻り値なし）。
    function showToast(message) {
      const toastElement = document.getElementById("toast");
      toastElement.textContent = message;
      toastElement.classList.add("show");
      if (toastHideTimeoutId !== null) {
        clearTimeout(toastHideTimeoutId);
      }
      toastHideTimeoutId = setTimeout(() => {
        toastElement.classList.remove("show");
      }, TOAST_VISIBLE_DURATION_MS);
    }

