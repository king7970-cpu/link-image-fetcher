const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'history.json');

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch (_) {
    return [];
  }
}

function addHistoryEntries(entries) {
  const history = readHistory();
  history.unshift(...entries);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(0, 200), null, 2));
}

function clearHistory() {
  fs.writeFileSync(HISTORY_PATH, '[]');
}

module.exports = { readHistory, addHistoryEntries, clearHistory };
