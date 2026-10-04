const { google } = require('googleapis');
const { Readable } = require('stream');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_NAME = 'PIC';

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function loadAccounts() {
  try {
    return JSON.parse(process.env.DRIVE_ACCOUNTS || '{}');
  } catch (_) {
    return {};
  }
}

function listAccounts() {
  return Object.keys(loadAccounts());
}

function driveConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && listAccounts().length);
}

function getAuthUrl(label) {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: label,
  });
}

async function exchangeCode(code) {
  const { tokens } = await getOAuthClient().getToken(code);
  return tokens.refresh_token;
}

function mergedAccountsJson(label, refreshToken) {
  return JSON.stringify({ ...loadAccounts(), [label]: refreshToken });
}

function authorizedClient(label) {
  const accounts = loadAccounts();
  if (!accounts[label]) throw new Error(`Unknown account: ${label}`);
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: accounts[label] });
  return client;
}

async function getOrCreateFolder(drive) {
  const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id)' });
  if (list.data.files.length) return list.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return created.data.id;
}

async function uploadToDrive(label, { filename, buffer, mimeType }) {
  const drive = google.drive({ version: 'v3', auth: authorizedClient(label) });
  const folderId = await getOrCreateFolder(drive);
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });
  return res.data;
}

module.exports = { driveConfigured, listAccounts, getAuthUrl, exchangeCode, mergedAccountsJson, uploadToDrive };
