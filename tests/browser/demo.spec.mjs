import { fileURLToPath } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { createMatch, createRecording, healthRules, playRecording, snapshotChecksum } from '@ashears/2d-fighter-framework';
import { deterministicFixture } from '../fixtures.mjs';

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', ({ message }) => errors.push(message));
  return errors;
}

async function open(page) {
  await page.goto('./');
  await expect(page.locator('#viewport canvas')).toBeVisible();
}

async function stock(page) {
  await page.getByRole('combobox', { name: 'Rules', exact: true }).selectOption('stock');
  await expect(page.getByRole('combobox', { name: 'Arena', exact: true })).toHaveValue('overpass');
}

async function holdFor(page, key, duration) {
  await page.keyboard.down(key);
  await page.clock.runFor(duration);
  await page.keyboard.up(key);
  await page.clock.runFor(100);
}

test('production preview, CPU mode, training hitboxes, and desktop layout', async ({ page }, testInfo) => {
  const errors = captureErrors(page);
  await page.clock.install();
  await open(page);
  await expect(page.getByRole('heading', { name: 'Aftershift.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start fight' }).click();
  await expect(page.locator('#session-label')).toHaveText('CPU fight');
  await holdFor(page, 'd', 400);
  await holdFor(page, 'g', 350);
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Fight in progress.');
  await page.getByRole('button', { name: 'End session' }).click();
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page.locator('#hud .clock')).toHaveText('∞');
  await page.getByRole('button', { name: 'Show hitboxes' }).click();
  await expect(page.getByRole('button', { name: 'Hide hitboxes' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('h');
  await page.clock.runFor(50);
  await expect(page.locator('#frame-data')).toContainText('Shoulder Charge');
  await page.keyboard.up('h');
  await page.clock.runFor(155);
  await expect(page.locator('#hud .hud-value').last()).toHaveText('66 HP · 0');
  await expect(page.locator('#frame-data')).toBeVisible();
  expect(errors).toEqual([]);
});

test('local stock match uses both keyboard mappings, ends, and replays after reload', async ({ page }) => {
  const errors = captureErrors(page);
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await stock(page);
  await page.getByRole('button', { name: 'Start fight' }).click();
  await expect(page.locator('#session-label')).toHaveText('Local versus');
  await page.keyboard.down('ArrowRight');
  await holdFor(page, 'a', 200);
  await page.keyboard.up('ArrowRight');
  await holdFor(page, 'a', 8000);
  await expect(page.getByRole('heading', { name: 'Relay wins' })).toBeVisible();
  await expect(page.locator('#result-detail')).toHaveText('Stocks remaining 0–3.');
  await page.reload();
  await page.getByRole('button', { name: 'Replay last match' }).click();
  await expect(page.locator('#session-label')).toHaveText('Replay');
  await page.clock.runFor(8700);
  await expect(page.getByRole('heading', { name: 'Relay wins' })).toBeVisible();
  await expect(page.locator('#session-label')).toHaveText('Replay complete');
  expect(errors).toEqual([]);
});

test('solo touch inputs run a move and the mobile layout fits the viewport', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });
  try {
    const page = await context.newPage();
    const errors = captureErrors(page);
    await page.clock.install();
    await open(page);
    await page.getByRole('button', { name: 'Training', exact: true }).tap();
    await page.getByRole('button', { name: 'Start training' }).tap();
    await expect(page.getByRole('button', { name: 'Move left' })).toBeVisible();
    await page.getByRole('button', { name: 'Light attack' }).tap();
    await page.clock.runFor(34);
    await expect(page.locator('#frame-data')).toContainText('Quick Jab');
    expect(await page.locator('body').evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a shared invite opens the lobby in a fresh browser, then players can play, rematch and leave', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const errors = [captureErrors(host), captureErrors(guest)];
    await open(host);
    await host.getByRole('button', { name: 'Online', exact: true }).click();
    await stock(host);
    const externalSockets = [];
    for (const page of [host, guest]) page.on('websocket', ({ url }) => externalSockets.push(url));
    await hostContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await host.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(host.getByRole('status')).toHaveText('Invite link copied.', { timeout: 11_000 });
    const invite = await host.evaluate(() => navigator.clipboard.readText());
    expect(invite).toBe(await host.locator('#pairing-code').inputValue());
    expect(new URL(invite).hash).toMatch(/^#invite=FIGHT1\./);
    await guest.goto(invite);
    await expect(guest.getByRole('heading', { name: 'Multiplayer lobby' })).toBeVisible();
    await expect(guest.locator('#setup-form')).toBeHidden();
    expect(new URL(guest.url()).hash).toBe('');
    await expect(guest.locator('#pairing-code')).toHaveValue(/^FIGHT1\./);
    const reply = await guest.locator('#pairing-code').inputValue();
    await host.locator('#reply-input').fill(invite);
    await host.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(host.getByRole('status')).toContainText('full reply code');
    await host.locator('#reply-input').fill(reply);
    await host.getByRole('button', { name: 'Connect', exact: true }).click();
    for (const page of [host, guest]) await expect(page.getByRole('heading', { name: 'Private room' })).toBeVisible();
    expect(externalSockets).toEqual([]);
    await Promise.all([
      host.getByRole('combobox', { name: 'Your fighter' }).selectOption('forge'),
      guest.getByRole('combobox', { name: 'Your fighter' }).selectOption('relay'),
    ]);
    await Promise.all([host, guest].map((page) => page.getByRole('button', { name: 'Ready', exact: true }).click()));
    await expect(host.locator('#session-label')).toHaveText('Online · P1');
    await expect(guest.locator('#session-label')).toHaveText('Online · P2');
    await guest.keyboard.down('d');
    await expect(guest.getByRole('heading', { name: 'Forge wins' })).toBeVisible({ timeout: 13_000 });
    await guest.keyboard.up('d');
    await expect(host.getByRole('heading', { name: 'Forge wins' })).toBeVisible();
    await expect(host.locator('#result-detail')).toHaveText('Stocks remaining 3–0.');

    await host.getByRole('button', { name: 'Rematch' }).click();
    await expect(host.getByRole('status')).toContainText('Waiting');
    await guest.getByRole('button', { name: 'Rematch' }).click();
    await expect(host.locator('#session-label')).toHaveText('Online · P1');
    await expect(guest.locator('#session-label')).toHaveText('Online · P2');
    await guest.getByRole('button', { name: 'Leave room', exact: true }).click();
    await expect(host.getByRole('status')).toHaveText('Your opponent left the room.');
    await expect(host.getByRole('heading', { name: 'Match setup' })).toBeVisible();
    await expect(host.getByRole('button', { name: 'Replay last match' })).toBeEnabled();
    expect(errors).toEqual([[], []]);
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});

test('a recorded fight reaches exactly the same result, state and event order in Node and Chromium', async ({ page }) => {
  const { definition, inputs } = deterministicFixture();
  const match = createMatch(definition, healthRules);
  const recording = createRecording(match, inputs);
  const expected = playRecording(definition, healthRules, recording);
  expect(expected.snapshot.phase).toBe('finished');
  await page.route('**/__core/*.js', (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    const path = fileURLToPath(new URL(`../../packages/core/dist/${filename}`, import.meta.url));
    return route.fulfill({ path, contentType: 'application/javascript' });
  });
  await open(page);
  const browser = await page.evaluate(async ({ definition, recording }) => {
    const path = '/__core/index.js';
    const core = await import(path);
    const outcome = core.playRecording(definition, core.healthRules, recording);
    return { outcome, checksum: core.snapshotChecksum(outcome.snapshot) };
  }, { definition, recording });
  expect(browser.checksum).toBe(snapshotChecksum(expected.snapshot));
  expect(browser.outcome).toEqual(expected);
});

test('health mode completes two rounds and clears the intermission HUD', async ({ page }) => {
  const errors = captureErrors(page);
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('combobox', { name: 'Arena', exact: true }).selectOption('overpass');
  await expect(page.getByRole('combobox', { name: 'Rules', exact: true })).toHaveValue('health');
  await page.getByRole('button', { name: 'Start fight' }).click();
  await page.keyboard.down('ArrowRight');
  await page.clock.runFor(1400);
  await expect(page.locator('#arena-message')).toHaveText('Forge takes the round');
  await page.clock.runFor(3600);
  await page.keyboard.up('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Forge wins' })).toBeVisible();
  await expect(page.locator('#result-detail')).toHaveText('Rounds 2–0 at Skyline Overpass.');
  await expect(page.locator('#arena-message')).toBeHidden();
  expect(errors).toEqual([]);
});

test('stock training respawns after a stock loss and restarts after the final stock', async ({ page }) => {
  const errors = captureErrors(page);
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await stock(page);
  await page.getByRole('button', { name: 'Start training' }).click();
  await page.getByRole('button', { name: 'Show hitboxes' }).click();
  await page.keyboard.down('a');
  await page.clock.runFor(1750);
  await expect(page.locator('.hud-value').first()).toHaveText('0% · 2 ◆');
  await page.clock.runFor(5100);
  await page.keyboard.up('a');
  await expect(page.locator('.hud-value').first()).toHaveText('0% · 3 ◆');
  await expect(page.locator('#hud .clock')).toHaveText('∞');
  await expect(page.getByRole('button', { name: 'Hide hitboxes' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
