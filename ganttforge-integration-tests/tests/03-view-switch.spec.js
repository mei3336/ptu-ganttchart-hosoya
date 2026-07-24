/**
 * 03 表示・ビュー切替 — 結合試験（spec/test-items.json 03-01-01 〜 03-09-02、全19項目）
 */

const { test, expect } = require("@playwright/test");
const { captureScreen, resetSeq } = require("../helpers/evidence");
const { resetToInitialState } = require("../helpers/ui-actions");
const { recordResult } = require("../helpers/results-tracker");
const { seedProject, seedSchedule, selectProject } = require("../helpers/seed");

async function seedProjectWithParentChildSchedules(page) {
  const project = await seedProject(page, { name: "ビュー切替試験プロジェクト", startDate: "2026-01-01", endDate: "2026-12-31" });
  const parent = await seedSchedule(page, project.id, { name: "親スケジュール", startDate: "2026-03-01", endDate: "2026-03-20", order: 0 });
  await seedSchedule(page, project.id, { name: "子スケジュール", parentId: parent.id, startDate: "2026-03-01", endDate: "2026-03-10", order: 1 });
  await selectProject(page, project.id);
  return { project, parent };
}

test.describe("03-01/02/03/04 表示粒度（日・週・1ヶ月・3ヶ月）", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    await seedProjectWithParentChildSchedules(page);
  });

  test("03-01-01 「日」ボタンで1日1列の粒度・土日縞背景", async ({ page }) => {
    const testId = "03-01-01";
    resetSeq(testId);

    await page.locator('[data-granularity="day"]').click();
    await expect(page.locator(".gantt-day-column-bg.is-saturday").first()).toBeVisible();
    await expect(page.locator(".gantt-day-column-bg.is-sunday").first()).toBeVisible();

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-01-02 「日」ボタンが選択状態（青）になる", async ({ page }) => {
    const testId = "03-01-02";
    resetSeq(testId);

    await page.locator('[data-granularity="day"]').click();
    await expect(page.locator('[data-granularity="day"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-granularity="week"]')).not.toHaveClass(/is-active/);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-02-01 「週」ボタンで1日あたり幅が縮小する", async ({ page }) => {
    const testId = "03-02-01";
    resetSeq(testId);

    const dayWidth = (await page.locator(".gantt-timeline-header").boundingBox()).width;
    await page.locator('[data-granularity="week"]').click();
    const weekWidth = (await page.locator(".gantt-timeline-header").boundingBox()).width;
    expect(weekWidth).toBeLessThan(dayWidth);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-02-02 「週」ボタンが選択状態（青）になる", async ({ page }) => {
    const testId = "03-02-02";
    resetSeq(testId);

    await page.locator('[data-granularity="week"]').click();
    await expect(page.locator('[data-granularity="week"]')).toHaveClass(/is-active/);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-03-01 「1ヶ月」ボタンで1ヶ月粒度に描画される", async ({ page }) => {
    const testId = "03-03-01";
    resetSeq(testId);

    const weekWidth = (await page.locator(".gantt-timeline-header").boundingBox()).width;
    await page.locator('[data-granularity="month"]').click();
    const monthWidth = (await page.locator(".gantt-timeline-header").boundingBox()).width;
    expect(monthWidth).toBeLessThan(weekWidth);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-03-02 「1ヶ月」ボタンが選択状態（青）になる", async ({ page }) => {
    const testId = "03-03-02";
    resetSeq(testId);

    await page.locator('[data-granularity="month"]').click();
    await expect(page.locator('[data-granularity="month"]')).toHaveClass(/is-active/);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-04-01 「3ヶ月」ボタンで3ヶ月粒度に描画される", async ({ page }) => {
    const testId = "03-04-01";
    resetSeq(testId);

    const monthWidth = (await page.locator(".gantt-timeline-header").boundingBox()).width;
    await page.locator('[data-granularity="quarter"]').click();
    const quarterWidth = (await page.locator(".gantt-timeline-header").boundingBox()).width;
    expect(quarterWidth).toBeLessThan(monthWidth);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-04-02 「3ヶ月」ボタンが選択状態（青）になる", async ({ page }) => {
    const testId = "03-04-02";
    resetSeq(testId);

    await page.locator('[data-granularity="quarter"]').click();
    await expect(page.locator('[data-granularity="quarter"]')).toHaveClass(/is-active/);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("03-05 今日", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    await seedProjectWithParentChildSchedules(page);
  });

  test("03-05-01 「今日」ボタンで今日の位置まで横スクロールする", async ({ page }) => {
    const testId = "03-05-01";
    resetSeq(testId);

    // 事前にスクロール位置を先頭（0）にしておき、「今日」ボタンで「今日位置-100px」まで
    // 移動することを、アプリ内の計算関数（calculateDayOffsetFromTimelineStart）と同じ式で検証する。
    await page.locator(".gantt-scroll-area").evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.locator("#todayButton").click();

    const { scrollLeft, expectedScrollLeft } = await page.evaluate(() => {
      const todayDateString = new Date().toISOString().slice(0, 10);
      const dayOffset = calculateDayOffsetFromTimelineStart(todayDateString, currentTimelineStartDateString);
      const pixelsPerDay = GRANULARITY_PIXELS_PER_DAY[currentGranularity];
      return {
        scrollLeft: document.querySelector(".gantt-scroll-area").scrollLeft,
        expectedScrollLeft: Math.max(dayOffset * pixelsPerDay - 100, 0),
      };
    });
    expect(scrollLeft).toBe(expectedScrollLeft);
    expect(scrollLeft).toBeGreaterThan(0);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-05-02 今日の位置に縦線マーカーが表示される", async ({ page }) => {
    const testId = "03-05-02";
    resetSeq(testId);

    // プロジェクト期間（2026-01-01〜2026-12-31）に今日を含むため、マーカーが表示される。
    await expect(page.locator(".gantt-today-marker")).toHaveCount(1);

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("03-06 全て閉じる/全て開く", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    await seedProjectWithParentChildSchedules(page);
  });

  test("03-06-01 「全て閉じる」で子行が非表示になりラベルが「全て開く」になる", async ({ page }) => {
    const testId = "03-06-01";
    resetSeq(testId);

    await expect(page.locator("#toggleAllScheduleRowsButton")).toHaveText("全て閉じる");
    await page.locator("#toggleAllScheduleRowsButton").click();

    await expect(page.locator("#wbsPanel")).not.toContainText("子スケジュール");
    await expect(page.locator("#toggleAllScheduleRowsButton")).toHaveText("全て開く");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-06-02 「全て開く」で子行が表示されラベルが「全て閉じる」になる", async ({ page }) => {
    const testId = "03-06-02";
    resetSeq(testId);

    await page.locator("#toggleAllScheduleRowsButton").click();
    await expect(page.locator("#toggleAllScheduleRowsButton")).toHaveText("全て開く");

    await page.locator("#toggleAllScheduleRowsButton").click();
    await expect(page.locator("#wbsPanel")).toContainText("子スケジュール");
    await expect(page.locator("#toggleAllScheduleRowsButton")).toHaveText("全て閉じる");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-06-03 WBS行の＋／−ボタン操作でヘッダーラベルが連動する", async ({ page }) => {
    const testId = "03-06-03";
    resetSeq(testId);

    await page.locator(".wbs-toggle-button").click();
    await expect(page.locator("#wbsPanel")).not.toContainText("子スケジュール");
    await expect(page.locator("#toggleAllScheduleRowsButton")).toHaveText("全て開く");

    await page.locator(".wbs-toggle-button").click();
    await expect(page.locator("#wbsPanel")).toContainText("子スケジュール");
    await expect(page.locator("#toggleAllScheduleRowsButton")).toHaveText("全て閉じる");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});

test.describe("03-07/08/09 列トグル（開始・終了・状態）", () => {
  test.beforeEach(async ({ page }) => {
    await resetToInitialState(page);
    await seedProjectWithParentChildSchedules(page);
  });

  test("03-07-01 「開始」列トグルONでWBSに開始日列が表示される", async ({ page }) => {
    const testId = "03-07-01";
    resetSeq(testId);

    await page.locator("#toggleColumnStartDateButton").click();
    await expect(page.locator("#toggleColumnStartDateButton")).toHaveClass(/is-active/);
    await expect(page.locator(".wbs-header-row")).toContainText("開始日");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-07-02 「開始」列トグルOFFでWBSの開始日列が非表示になる", async ({ page }) => {
    const testId = "03-07-02";
    resetSeq(testId);

    await page.locator("#toggleColumnStartDateButton").click();
    await page.locator("#toggleColumnStartDateButton").click();
    await expect(page.locator("#toggleColumnStartDateButton")).not.toHaveClass(/is-active/);
    await expect(page.locator(".wbs-header-row")).not.toContainText("開始日");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-08-01 「終了」列トグルONでWBSに終了日列が表示される", async ({ page }) => {
    const testId = "03-08-01";
    resetSeq(testId);

    await page.locator("#toggleColumnEndDateButton").click();
    await expect(page.locator("#toggleColumnEndDateButton")).toHaveClass(/is-active/);
    await expect(page.locator(".wbs-header-row")).toContainText("終了日");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-08-02 「終了」列トグルOFFでWBSの終了日列が非表示になる", async ({ page }) => {
    const testId = "03-08-02";
    resetSeq(testId);

    await page.locator("#toggleColumnEndDateButton").click();
    await page.locator("#toggleColumnEndDateButton").click();
    await expect(page.locator("#toggleColumnEndDateButton")).not.toHaveClass(/is-active/);
    await expect(page.locator(".wbs-header-row")).not.toContainText("終了日");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-09-01 「状態」列トグルONでWBSに状態列が表示される", async ({ page }) => {
    const testId = "03-09-01";
    resetSeq(testId);

    await page.locator("#toggleColumnStatusButton").click();
    await expect(page.locator("#toggleColumnStatusButton")).toHaveClass(/is-active/);
    await expect(page.locator(".wbs-header-row")).toContainText("状態");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });

  test("03-09-02 「状態」列トグルOFFでWBSの状態列が非表示になる", async ({ page }) => {
    const testId = "03-09-02";
    resetSeq(testId);

    await page.locator("#toggleColumnStatusButton").click();
    await page.locator("#toggleColumnStatusButton").click();
    await expect(page.locator("#toggleColumnStatusButton")).not.toHaveClass(/is-active/);
    await expect(page.locator(".wbs-header-row")).not.toContainText("状態");

    const shot = await captureScreen(page, testId, "gantt");
    recordResult({ testId, judgement: "OK", evidenceFiles: [shot] });
  });
});
