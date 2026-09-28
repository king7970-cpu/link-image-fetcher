const { chromium } = require('playwright');

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;
const MIN_AREA = 40000;
const MAX_RESULTS = 3;

function extFromMime(mimeType) {
  if ((mimeType || '').includes('png')) return 'png';
  if ((mimeType || '').includes('webp')) return 'webp';
  if ((mimeType || '').includes('gif')) return 'gif';
  return 'jpg';
}

function guessFilename(url, index, mimeType) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop();
    if (last && IMAGE_EXT.test(last)) return last;
  } catch (_) {}
  return `image-${index}.${extFromMime(mimeType)}`;
}

function parseDataUri(uri) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(uri);
  if (!m) return null;
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function extractGenericImages(url) {
  if (IMAGE_EXT.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return [{ filename: guessFilename(url, 0, res.headers.get('content-type')), buffer, mimeType: res.headers.get('content-type') || 'image/jpeg' }];
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);

    // Primary strategy: read already-decoded pixels straight off each <img> via canvas.
    // Works uniformly for http/blob/data sources and sidesteps blob: URLs becoming
    // unfetchable once outside the page's original script context.
    const canvasResults = await page.$$eval('img', (els, minArea) =>
      els
        .map((img) => {
          const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
          if (area < minArea) return null;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            return { dataUrl: canvas.toDataURL('image/png'), area, src: img.currentSrc || img.src };
          } catch (e) {
            return { tainted: true, area, src: img.currentSrc || img.src };
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.area - a.area),
      MIN_AREA
    );

    let index = 0;
    for (const c of canvasResults) {
      if (results.length >= MAX_RESULTS) break;

      if (c.dataUrl) {
        const parsed = parseDataUri(c.dataUrl);
        if (parsed) {
          results.push({ filename: guessFilename(c.src || `image-${index}`, index++, parsed.mimeType), buffer: parsed.buffer, mimeType: parsed.mimeType });
        }
        continue;
      }

      // Canvas was tainted (cross-origin, no CORS) - fall back to a direct fetch if possible.
      if (c.src && c.src.startsWith('http')) {
        const resp = await context.request.get(c.src);
        if (!resp.ok()) continue;
        const mimeType = resp.headers()['content-type'] || '';
        if (!mimeType.startsWith('image/')) continue;
        const buffer = await resp.body();
        results.push({ filename: guessFilename(c.src, index++, mimeType), buffer, mimeType });
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { extractGenericImages };
