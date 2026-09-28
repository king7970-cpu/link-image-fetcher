require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const { isChatGptShareLink, extractChatGptImages } = require('./lib/chatgptExtractor');
const { extractGenericImages } = require('./lib/genericExtractor');
const { driveConfigured, getAuthUrl, saveTokenFromCode, uploadToDrive } = require('./lib/drive');
const { readHistory, addHistoryEntries } = require('./lib/history');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
app.use('/downloads', express.static(DOWNLOADS_DIR));

const APP_TOKEN = process.env.APP_TOKEN || '';

function checkToken(req, res, next) {
  if (!APP_TOKEN) return next();
  if (req.headers['x-app-token'] === APP_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/auth/google', (req, res) => {
  res.redirect(getAuthUrl());
});

app.get('/oauth2callback', async (req, res) => {
  try {
    await saveTokenFromCode(req.query.code);
    res.send('ההרשאה הצליחה! אפשר לסגור את החלון הזה ולחזור לטופס ההורדה.');
  } catch (e) {
    res.status(500).send('שגיאת הרשאה: ' + e.message);
  }
});

app.get('/api/auth-check', checkToken, (req, res) => {
  res.json({ ok: true, driveConfigured: driveConfigured() });
});

app.get('/api/history', checkToken, (req, res) => {
  res.json({ files: readHistory() });
});

app.post('/api/download', checkToken, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const images = isChatGptShareLink(url)
      ? await extractChatGptImages(url)
      : await extractGenericImages(url);

    if (images.length === 0) {
      return res.status(404).json({ error: 'No images found at that link' });
    }

    const driveReady = driveConfigured();
    const saved = [];

    for (const img of images) {
      const safeName = `${Date.now()}-${img.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const localPath = path.join(DOWNLOADS_DIR, safeName);
      fs.writeFileSync(localPath, img.buffer);

      const entry = { filename: safeName, localUrl: `/downloads/${safeName}`, sourceUrl: url, time: new Date().toISOString() };

      if (driveReady) {
        try {
          const driveFile = await uploadToDrive({ filename: img.filename, buffer: img.buffer, mimeType: img.mimeType });
          entry.driveLink = driveFile.webViewLink;
        } catch (e) {
          entry.driveError = e.message;
        }
      }

      saved.push(entry);
    }

    addHistoryEntries(saved);
    res.json({ driveConfigured: driveReady, files: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch image' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`link-image-fetcher listening on port ${PORT}`));
