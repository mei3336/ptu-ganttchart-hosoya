/**
 * 12 共通右サイドパネル操作 — 結合試験（spec/test-items.json 12-01-01、全1項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, resetSeq } = require("../helpers/evidence");
const { recordResult } = require("../helpers/results-tracker");
const { resetToInitialState, openSidePanel } = require("../helpers/ui-actions");
const { seedProject, selectProject } = require("../helpers/seed");

test.describe("12-01 側面パネル幅のドラッグ変更", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    const project = await seedProject(page, { name: "パネル幅試験プロジェクト" });
    await selectProject(page, project.id);
    await openSidePanel(page, "quickMemo");
  });

  test("12-01-01 ハンドルドラッグで幅変更・上下限クランプ", async ({ page }) => {
    const testId = "12-01-01";
    resetSeq(testId);

    const panel = page.locator("#quickMemoSlidePanel");
    const handle = panel.locator(".panel-resize-handle");
    // パネルは.is-open付与時にtransform:translateX(0.2s)でスライドインするため、
    // アニメーション完了を待ってから幅を測らないと中間状態の座標を掴んでしまう。
    await page.waitForTimeout(300);
    const initialBox = await panel.boundingBox();

    // 左へドラッグ＝パネルは右端固定なので幅が広がる。
    const handleBoxBeforeWiden = await handle.boundingBox();
    await page.mouse.move(handleBoxBeforeWiden.x + handleBoxBeforeWiden.width / 2, handleBoxBeforeWiden.y + handleBoxBeforeWiden.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBoxBeforeWiden.x - 200, handleBoxBeforeWiden.y + handleBoxBeforeWiden.height / 2);
    await page.mouse.up();
    const widenedBox = await panel.boundingBox();
    expect(widenedBox.width).toBeGreaterThan(initialBox.width);

    // 右へ大きくドラッグ＝下限（280px）でクランプされる。
    const handleBoxBeforeShrink = await handle.boundingBox();
    await page.mouse.move(handleBoxBeforeShrink.x + handleBoxBeforeShrink.width / 2, handleBoxBeforeShrink.y + handleBoxBeforeShrink.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBoxBeforeShrink.x + 2000, handleBoxBeforeShrink.y + handleBoxBeforeShrink.height / 2);
    await page.mouse.up();
    const shrunkWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.round(shrunkWidth)).toBe(280);

    // 左へ大きくドラッグ＝上限（画面幅の92%）でクランプされる。
    const handleBoxBeforeMax = await handle.boundingBox();
    await page.mouse.move(handleBoxBeforeMax.x + handleBoxBeforeMax.width / 2, handleBoxBeforeMax.y + handleBoxBeforeMax.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBoxBeforeMax.x - 3000, handleBoxBeforeMax.y + handleBoxBeforeMax.height / 2);
    await page.mouse.up();
    const viewportWidth = page.viewportSize().width;
    const maxWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.round(maxWidth)).toBe(Math.round(viewportWidth * 0.92));

    const shot = await captureScreen(page, testId, "quickmemo-panel");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
