const { chromium } = require('playwright');

function isChatGptShareLink(url) {
  return /^https:\/\/chatgpt\.com\/s\/(m_[a-f0-9]+)/i.test(url);
}

async function extractChatGptImages(url) {
  const postIdMatch = url.match(/\/s\/(m_[a-f0-9]+)/i);
  if (!postIdMatch) throw new Error('Not a valid chatgpt.com share link');
  const postId = postIdMatch[1];

  const browser = await chromium.launch({ headless: true });
  let results = [];
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

    const html = await page.content();
    const fileIds = Array.from(new Set(html.match(/file_[0-9a-f]{32}/g) || []));

    for (const fileId of fileIds) {
      const apiUrl = `/backend-anon/files/download/${fileId}?post_id=${postId}&include_library_file_state=true&inline=false&download_intent=false`;
      const info = await page.evaluate(async (u) => {
        const res = await fetch(u);
        if (!res.ok) return null;
        return res.json();
      }, apiUrl);

      if (!info || info.status !== 'success' || !info.download_url) continue;

      const imgRes = await fetch(info.download_url);
      if (!imgRes.ok) continue;
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const baseName = (info.file_name || fileId).split('/').pop();
      results.push({ filename: baseName, buffer, mimeType: imgRes.headers.get('content-type') || 'image/png' });
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { isChatGptShareLink, extractChatGptImages };
