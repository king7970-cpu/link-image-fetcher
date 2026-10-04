require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const { isChatGptShareLink, extractChatGptImages } = require('./lib/chatgptExtractor');
const { extractGenericImages } = require('./lib/genericExtractor');
const { driveConfigured, listAccounts, getAuthUrl, exchangeCode, mergedAccountsJson, uploadToDrive } = require('./lib/drive');
const { readHistory, addHistoryEntries } = require('./lib/history');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
app.use('/downloads', express.static(DOWNLOADS_DIR));

const APP_TOKEN = process.env.APP_TOKEN || '';
const LABEL_RE = /^[a-zA-Z0-9_-]{1,20}$/;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function checkToken(req, res, next) {
  if (!APP_TOKEN) return next();
  if (req.headers['x-app-token'] === APP_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/auth/google', (req, res) => {
  const label = req.query.label;
  if (!label || !LABEL_RE.test(label)) {
    return res.status(400).send('שם החשבון חייב להיות אנגלית/מספרים בלבד (עד 20 תווים), למשל ?label=mine');
  }
  res.redirect(getAuthUrl(label));
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const label = req.query.state;
    if (!label || !LABEL_RE.test(label)) throw new Error('חסר שם חשבון בבקשה');
    const refreshToken = await exchangeCode(req.query.code);
    if (!refreshToken) throw new Error('גוגל לא החזירה הרשאה מתמשכת, נסה שוב');
    const json = mergedAccountsJson(label, refreshToken);
    res.send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>החשבון נוסף</title>
      <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1a1b1e}
      textarea{width:100%;height:160px;font-family:monospace;font-size:12px;direction:ltr}</style></head><body>
      <h2>החשבון "${escapeHtml(label)}" אושר בהצלחה</h2>
      <p>העתק את התוכן הבא, והדבק אותו כערך של המשתנה <b>DRIVE_ACCOUNTS</b> בהגדרות Render (Environment), ואז שמור.</p>
      <textarea readonly onclick="this.select()">${escapeHtml(json)}</textarea>
      </body></html>`);
  } catch (e) {
    res.status(500).send('שגיאת הרשאה: ' + escapeHtml(e.message));
  }
});

app.get('/api/auth-check', checkToken, (req, res) => {
  res.json({ ok: true, driveConfigured: driveConfigured(), accounts: listAccounts() });
});

app.get('/api/history', checkToken, (req, res) => {
  res.json({ files: readHistory() });
});

app.post('/api/download', checkToken, async (req, res) => {
  const { url, account } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }
  if (!account || !listAccounts().includes(account)) {
    return res.status(400).json({ error: 'בחר חשבון יעד' });
  }

  try {
    const images = isChatGptShareLink(url)
      ? await extractChatGptImages(url)
      : await extractGenericImages(url);

    if (images.length === 0) {
      return res.status(404).json({ error: 'No images found at that link' });
    }

    const saved = [];
    for (const img of images) {
      const safeName = `${Date.now()}-${img.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fs.writeFileSync(path.join(DOWNLOADS_DIR, safeName), img.buffer);

      const entry = { filename: safeName, localUrl: `/downloads/${safeName}`, sourceUrl: url, account, time: new Date().toISOString() };
      try {
        const driveFile = await uploadToDrive(account, { filename: img.filename, buffer: img.buffer, mimeType: img.mimeType });
        entry.driveLink = driveFile.webViewLink;
      } catch (e) {
        entry.driveError = e.message;
      }
      saved.push(entry);
    }

    addHistoryEntries(saved);
    res.json({ files: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch image' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`link-image-fetcher listening on port ${PORT}`));
