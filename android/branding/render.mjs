#!/usr/bin/env node
/**
 * Story 9.1: renders the launcher artwork from the sources in this folder.
 *
 * Usage: node android/branding/render.mjs
 *   CHROME=/path/to/chrome overrides the Chrome binary (default: macOS Google Chrome).
 *
 * Writes into android/app/src/main/res:
 * - drawable-xhdpi/tv_banner.png              320x180, from banner.html
 * - mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png and ic_launcher_round.png,
 *   the legacy icons (API < 26), from icon.svg
 * - drawable/ic_launcher_foreground.xml        the adaptive foreground, from the
 *   `data-layer="foreground"` paths of icon.svg
 * - values/ic_launcher_background.xml          the adaptive background colour,
 *   from the `data-layer="background"` rect of icon.svg
 *
 * Rasterizing uses headless Chrome screenshots (no other raster tool is
 * needed). Every PNG is checked for its expected size after rendering.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = resolve(here, '../app/src/main/res');
const font = resolve(here, '../app/src/main/assets/fonts/GolosText-SemiBold.ttf');
const chrome =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Legacy launcher icon sizes in px per density (48 dp). */
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** The visible part of the 108 dp adaptive canvas (72 dp, centred). */
const VISIBLE = '18 18 72 72';

const iconSvg = readFileSync(join(here, 'icon.svg'), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'boostytv-branding-'));

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function layer(name) {
  return [...iconSvg.matchAll(/<(path|rect)\b[^>]*>/g)]
    .map(m => m[0])
    .filter(tag => attr(tag, 'data-layer') === name);
}

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.toString('latin1', 1, 4) !== 'PNG') {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function screenshot(html, width, height, out) {
  const page = join(work, 'page.html');
  writeFileSync(page, html);
  const shot = join(work, 'shot.png');
  rmSync(shot, { force: true });
  execFileSync(
    chrome,
    [
      '--headless=new',
      `--user-data-dir=${join(work, 'profile')}`,
      '--no-first-run',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=3000',
      `--screenshot=${shot}`,
      pathToFileURL(page).href,
    ],
    { stdio: 'pipe' },
  );
  const size = pngSize(shot);
  if (size.width !== width || size.height !== height) {
    throw new Error(`${out}: rendered ${size.width}x${size.height}, expected ${width}x${height}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, readFileSync(shot));
  console.log(`wrote ${out.slice(res.length + 1)} (${width}x${height})`);
}

function banner() {
  const fontUrl = `data:font/ttf;base64,${readFileSync(font).toString('base64')}`;
  const html = readFileSync(join(here, 'banner.html'), 'utf8').replace(
    'url("../app/src/main/assets/fonts/GolosText-SemiBold.ttf")',
    `url("${fontUrl}")`,
  );
  if (!html.includes(fontUrl)) {
    throw new Error('banner.html: font url placeholder not found');
  }
  screenshot(html, 320, 180, join(res, 'drawable-xhdpi/tv_banner.png'));
}

function legacyIcons() {
  // The legacy icon shows the same visible 72 dp window as the adaptive icon,
  // masked to a rounded square (ic_launcher) or a circle (ic_launcher_round).
  const svg = iconSvg.replace(/viewBox="[^"]*"/, `viewBox="${VISIBLE}"`);
  for (const [density, size] of Object.entries(DENSITIES)) {
    for (const [name, radius] of [
      ['ic_launcher', '18%'],
      ['ic_launcher_round', '50%'],
    ]) {
      const sized = svg.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`);
      const html = `<!doctype html><html><head><style>
html,body{margin:0;padding:0;background:transparent}
div{width:${size}px;height:${size}px;border-radius:${radius};overflow:hidden}
svg{display:block}
</style></head><body><div>${sized}</div></body></html>`;
      screenshot(html, size, size, join(res, `mipmap-${density}/${name}.png`));
    }
  }
}

function adaptiveXml() {
  const paths = layer('foreground').map(tag => {
    const fillType = attr(tag, 'fill-rule') === 'evenodd' ? 'evenOdd' : 'nonZero';
    return `    <path
        android:fillColor="${attr(tag, 'fill')}"
        android:fillType="${fillType}"
        android:pathData="${attr(tag, 'd')}" />`;
  });
  if (paths.length === 0) {
    throw new Error('icon.svg: no data-layer="foreground" paths');
  }
  const foreground = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by android/branding/render.mjs from icon.svg. Do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${paths.join('\n')}
</vector>
`;
  const background = layer('background').map(tag => attr(tag, 'fill'));
  if (background.length !== 1) {
    throw new Error('icon.svg: expected one data-layer="background" rect');
  }
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by android/branding/render.mjs from icon.svg. Do not edit by hand. -->
<resources>
    <color name="ic_launcher_background">${background[0]}</color>
</resources>
`;
  writeFileSync(join(res, 'drawable/ic_launcher_foreground.xml'), foreground);
  writeFileSync(join(res, 'values/ic_launcher_background.xml'), colors);
  console.log('wrote drawable/ic_launcher_foreground.xml, values/ic_launcher_background.xml');
}

try {
  banner();
  legacyIcons();
  adaptiveXml();
} finally {
  rmSync(work, { recursive: true, force: true });
}
