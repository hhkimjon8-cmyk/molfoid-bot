
// utils/emulator.js

const GAMES = {
  'onepiece': {
    name: 'One Piece',
    file: 'One Piece (USA).gba', // Just the filename
    thumbnail: 'https://cache.downloadroms.io/static/da034f352004fed5928ca5c6a5213e2f051bb46e/image.jpeg'
  },
  'firered': {
    name: 'Pokémon FireRed',
    file: 'Pokemon - FireRed Version (USA, Europe) (Rev 1).gba',
    thumbnail: 'https://cache.downloadroms.io/static/465a276ce69d99c8a0993c72972149086d369d28/image.jpeg'
  },
  'zelda': {
    name: 'The Legend of Zelda: Minish Cap',
    file: 'Legend of Zelda, The - The Minish Cap (USA).gba', 
    thumbnail: 'https://cache.downloadroms.io/static/c5349b077fe3d330c816a7c8f094df8c7ff799ea/image.jpeg'
  },
  'kkk': {
    name: 'Kuru Kuru Kururin (Mode7)',
    file: '0048 - Kuru Kuru Kururin (E)(Mode7).gba', 
    thumbnail: 'https://cache.downloadroms.io/static/63c9a46657e4a75bbd085f6d374ad5c51392b1e5/image.jpg'
  },
  'survivalkids': {
    name: 'Survival Kids',
    file: 'Survival Kids (USA) (SGB Enhanced) (GB Compatible).gbc', 
    thumbnail: 'https://cache.downloadroms.io/static/05b3ba3bae4e9217fedeb8e62156e5fc95bea32e/image.jpeg'
  },
  'hmf': {
    name: 'Harvest Moon - Friends Of Mineral Town',
    file: 'Harvest Moon - Friends of Mineral Town (U) [!].gba', 
    thumbnail: 'https://cache.downloadroms.io/static/3da1858039ac4d6e9b64d4f6be716b300d58a109/image.jpg'
  }
};

const EMULATOR_FRONTEND_URL = 'https://molfoid-bot-j2b2.vercel.app/emulator.html'; 

async function getGameList() {
  return Object.entries(GAMES).map(([key, data]) => ({
    key: key,
    name: data.name,
    thumbnail: data.thumbnail
  }));
}

function getGameUrls(gameKey) {
  // Now the key is passed in as lowercase without spaces (e.g., "survivalkids")
  const game = GAMES[gameKey];
  if (!game) return null;

  // Safely encode the filename for the URL
  const encodedFile = encodeURIComponent(game.file); 
  
  const singlePlayer = `${EMULATOR_FRONTEND_URL}?game=${encodedFile}`;
  const multiPlayer = singlePlayer; // Netplay not supported in this basic setup
  
  // Construct the correct raw GitHub URL
  const directDownload = `https://raw.githubusercontent.com/hhkimjon8-cmyk/molfoid-bot/main/assets/${encodedFile}`;

  return {
    name: game.name,
    singlePlayer,
    multiPlayer,
    directDownload,
    thumbnail: game.thumbnail
  };
}

module.exports = { getGameList, getGameUrls };
