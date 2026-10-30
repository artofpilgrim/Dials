import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const dial = page => page.locator('.stage-inner > svg');
async function typeNumber(page, label, text) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.focus();
  await input.selectText();
  await input.pressSequentially(text, { delay: 30 });
  await input.press('Tab');
  return input;
}
async function download(page, button) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  return fs.readFile(await (await pending).path());
}

test('numeric fields preserve a full typing sequence', async ({ page }) => {
  await page.goto('');
  await expect(await typeNumber(page, 'Width', '1024')).toHaveValue('1024');
  await expect(await typeNumber(page, 'Width', '512')).toHaveValue('512');
  await expect(await typeNumber(page, 'Major step', '0.5')).toHaveValue('0.5');
  await expect(dial(page).locator('text')).not.toHaveCount(0);
  await page.getByRole('switch', { name: 'Show band' }).check();
  await expect(await typeNumber(page, 'Zone 2 end', '65')).toHaveValue('65');
});

test('deleting a zone leaves defaults and saved presets intact', async ({ page }) => {
  await page.goto('');
  await page.getByRole('switch', { name: 'Show band' }).check();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('Original'));
  await page.getByRole('button', { name: '+ Save current as preset', exact: true }).click();
  await page.getByRole('button', { name: 'Delete zone 3' }).click();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Zone 2 end' })).toHaveValue('80');
  await page.getByRole('button', { name: 'Delete zone 3' }).click();
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.getByRole('switch', { name: 'Show band' }).check();
  await expect(page.getByRole('spinbutton', { name: 'Zone 2 end' })).toHaveValue('80');
});

test('single-zone full-circle band has the same centre as the rim', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Full circle', exact: true }).click();
  await page.getByRole('switch', { name: 'Show band' }).check();
  await page.getByRole('button', { name: 'Delete zone 3' }).click();
  await page.getByRole('button', { name: 'Delete zone 2' }).click();
  const circles = dial(page).locator('circle');
  await expect(circles).toHaveCount(2);
  await expect(circles.nth(0)).toHaveAttribute('cx', await circles.nth(1).getAttribute('cx'));
  await expect(circles.nth(0)).toHaveAttribute('cy', await circles.nth(1).getAttribute('cy'));
  await page.getByRole('switch', { name: 'Reverse direction' }).check();
  await expect(dial(page).locator('circle[data-band]')).toHaveCount(1);
});

test('semicircles have balanced vertical margins in the preview and PNG', async ({ page }) => {
  for (const settings of [
    'w=600&h=600',
    'w=600&h=600&td=outward&np=outside&tcr=100&rt=6&ml=30',
    'w=600&h=380&td=outward&np=outside',
  ]) {
    await page.goto('#s=semi&iv=1&ps=1&' + settings);
    const previewMargins = await dial(page).evaluate(svg => {
      const bounds = svg.querySelector(':scope > g').getBBox();
      return { top: bounds.y, bottom: svg.viewBox.baseVal.height - bounds.y - bounds.height };
    });
    expect(Math.abs(previewMargins.top - previewMargins.bottom)).toBeLessThan(10);

    const png = await download(page, 'Download PNG');
    const margins = await page.evaluate(async encoded => {
      const img = new Image(); img.src = 'data:image/png;base64,' + encoded; await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
      const { data } = context.getImageData(0, 0, img.width, img.height);
      let top = img.height, bottom = -1;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (data[(y * img.width + x) * 4] > 200) {
            top = Math.min(top, y); bottom = y; break;
          }
        }
      }
      return { top, bottom: img.height - bottom - 1 };
    }, png.toString('base64'));
    expect(margins.top).toBeGreaterThan(0);
    expect(margins.bottom).toBeGreaterThan(0);
    expect(Math.abs(margins.top - margins.bottom)).toBeLessThan(8);
  }
});

test('share link includes the latest edit before the debounce expires', async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedLink = '';
    // Keep the URL stale deterministically, regardless of the machine's speed.
    history.replaceState = () => {};
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedLink = text; } } });
  });
  await page.goto('');
  await page.getByRole('switch', { name: 'Show band' }).check();
  await typeNumber(page, 'Max', '200');
  const before = await dial(page).innerHTML();
  await page.getByRole('button', { name: 'Copy share link', exact: true }).click();
  const link = await page.evaluate(() => window.copiedLink);
  expect(link).toContain('mx=200');
  await page.goto(link);
  await expect(dial(page)).toHaveJSProperty('innerHTML', before);
});

for (const font of ['Inter', 'IBM Plex Mono', 'JetBrains Mono', 'Space Mono']) {
  test(`production SVG outlines ${font} at the requested weight`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('');
    await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption({ label: font });
    await page.getByRole('switch', { name: 'Outline text on export' }).check();
    const regular = (await download(page, 'Download SVG')).toString();
    expect(regular).not.toContain('<text');
    expect(regular).toContain('<path');
    await typeNumber(page, 'Weight', '700');
    const bold = (await download(page, 'Download SVG')).toString();
    expect(bold).not.toEqual(regular);
    expect(errors).toEqual([]);
  });
}

test('SVG embeds fonts and PNG keeps typography, resolution and transparency', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: '1×', exact: true }).click();
  const systemPng = await download(page, 'Download PNG');
  await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption({ label: 'Space Mono' });
  const svg = (await download(page, 'Download SVG')).toString();
  expect(svg).toContain('data:font/ttf;base64,');
  const customPng = await download(page, 'Download PNG');
  expect(customPng.equals(systemPng)).toBe(false);
  expect(customPng.readUInt32BE(16)).toBe(600);
  expect(customPng.readUInt32BE(20)).toBe(600);
  await page.getByRole('switch', { name: 'Transparent PNG' }).check();
  const transparent = await download(page, 'Download PNG');
  const alpha = await page.evaluate(async encoded => {
    const img = new Image(); img.src = 'data:image/png;base64,' + encoded; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  }, transparent.toString('base64'));
  expect(alpha).toBe(0);
});

test('export errors are visible and do not move the controls', async ({ page }) => {
  await page.goto('');
  await page.getByRole('switch', { name: 'Outline text on export' }).check();
  const button = page.getByRole('button', { name: 'Download SVG', exact: true });
  await button.scrollIntoViewIfNeeded();
  const before = await button.boundingBox();
  await button.click();
  await expect(page.locator('.export-status')).toContainText('Choose Inter');
  expect(await button.boundingBox()).toEqual(before);
  await page.getByRole('switch', { name: 'Outline text on export' }).uncheck();
  await typeNumber(page, 'Width', '8192');
  await typeNumber(page, 'Height', '8192');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  await expect(page.locator('.export-status')).toContainText('16 megapixels');
});

test('null preset storage is recoverable and legacy links migrate', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dialMaker.presets.v1', 'null'));
  const legacy = Buffer.from(JSON.stringify({ majorStep: 10, minorStep: 5 })).toString('base64');
  await page.goto('#' + legacy);
  await expect(page.getByRole('spinbutton', { name: 'Subdivisions', exact: true })).toHaveValue('1');
  await expect(dial(page)).toBeVisible();
});
