// utils/webgame.js
const gamesData = require('./games.json');

function getWebGameList() {
  return Object.entries(gamesData).map(([key, data]) => ({
    label: data.name.substring(0, 100),
    value: key,
    description: data.description.substring(0, 100),
    emoji: '🕹️'
  }));
}

function getWebGame(key) {
  return gamesData[key] || null;
}

module.exports = { getWebGameList, getWebGame };