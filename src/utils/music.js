const ytSearch = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.YTDL_NO_UPDATE = '1';

let pontalabsYtdl = null;
try { pontalabsYtdl = require('@pontalabs/ytdl'); } catch {}
let ytdlCore = null;
try { ytdlCore = require('@distube/ytdl-core'); }
catch { try { ytdlCore = require('ytdl-core'); } catch {} }

// ============================================================
// Constants
// ============================================================
const FLAC_CDN       = 'https://filescutyt.com';
const FLAC_CACHE     = path.join(os.homedir(), '.cutyt_flac_cache.json');
const SLUG_MAX_LEN   = 80;
const FLAC_MAGIC_HEX = '664c6143';

try { fs.mkdirSync(path.dirname(FLAC_CACHE), { recursive: true }); } catch {}

// ============================================================
// Cache
// ============================================================
function loadCache() {
  try { return fs.existsSync(FLAC_CACHE) ? JSON.parse(fs.readFileSync(FLAC_CACHE, 'utf-8')) : {}; }
  catch { return {}; }
}
function saveCache(c) {
  try { fs.writeFileSync(FLAC_CACHE, JSON.stringify(c, null, 2)); } catch {}
}
function cacheGet(id) { return loadCache()[id] || null; }
function cacheSet(id, data) {
  const c = loadCache();
  c[id] = { ts: Date.now(), ...data };
  saveCache(c);
}

// ============================================================
// Helpers
// ============================================================
function getVideoId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  if (urlOrId.includes('youtube.com') || urlOrId.includes('youtu.be')) {
    const m = urlOrId.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return m ? m[1] : urlOrId;
  }
  return urlOrId;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildSlugCandidates(title) {
  if (!title) return [];
  const base = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const set = new Set([base]);
  if (base.length > SLUG_MAX_LEN) {
    const t80 = base.substring(0, SLUG_MAX_LEN).replace(/-+$/, '');
    set.add(t80);
    const lastH = t80.lastIndexOf('-');
    if (lastH > 40) set.add(t80.substring(0, lastH));
  }
  return [...set];
}

// ============================================================
// Play URL
// ============================================================
async function getPlayUrl(ytUrl) {
  if (ytdlCore) {
    try {
      const info = await ytdlCore.getInfo(ytUrl);
      const fmt = ytdlCore.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
      if (fmt?.url) return fmt.url;
    } catch {}
  }
  if (pontalabsYtdl) {
    try {
      const a = await pontalabsYtdl.downloadAudio(ytUrl, 320);
      return a?.download?.downloadUrl || null;
    } catch {}
  }
  return null;
}

// ============================================================
// Verify remote FLAC
// ============================================================
async function verifyRemoteFlac(url) {
  if (typeof url !== 'string') return false;
  try {
    const head = await axios.head(url, {
      timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: () => true,
    });
    if (head.status !== 200) return false;
    const range = await axios.get(url, {
      timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-3' },
      responseType: 'arraybuffer', validateStatus: () => true,
    });
    return Buffer.from(range.data).toString('hex') === FLAC_MAGIC_HEX;
  } catch { return false; }
}

async function probeFirstWorking(urls) {
  if (!urls.length) return null;
  const r = await Promise.allSettled(urls.map(async u => ({ u, ok: await verifyRemoteFlac(u) })));
  for (const x of r) if (x.status === 'fulfilled' && x.value.ok) return x.value.u;
  return null;
}

// ============================================================
// PURE NODE.JS: CutYT API Conversion
// ============================================================
async function triggerCutytConversion(ytUrl) {
  try {
    console.log(`⚡ [CutYT] Requesting conversion from Azure...`);
    await axios.post('https://cutytapi.azurewebsites.net/exec/method', {
      methodName: 'GetYtDlpData',
      arguments: `--no-playlist --no-mtime -N 8 -f ba[acodec!=none]/bestaudio[acodec!=none]/ba/bestaudio/best[acodec!=none][height<=360]/worst[acodec!=none] -x --audio-format flac --audio-quality 0 "${ytUrl}"`
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.cutyt.com',
        'Referer': 'https://www.cutyt.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 90000,
      validateStatus: () => true
    });
    return true;
  } catch (e) {
    console.log(`❌ [CutYT] Azure request failed: ${e.message}`);
    return false;
  }
}

// ============================================================
// Fast FLAC lookup
// ============================================================
async function findFlacFast(videoId, title) {
  const cached = cacheGet(videoId);
  if (cached?.url && await verifyRemoteFlac(cached.url)) {
    return { type: 'url', value: cached.url, size: cached.size };
  }

  const candidates = buildSlugCandidates(title).map(s => `${FLAC_CDN}/${s}.flac`);
  const hit = await probeFirstWorking(candidates);
  if (hit) {
    const size = (await axios.head(hit, { timeout: 5000, validateStatus: () => true })
      .catch(() => null))?.headers?.['content-length'];
    cacheSet(videoId, { url: hit, size: size ? Number(size) : null, via: 'cdn-probe' });
    return { type: 'url', value: hit, size: size ? Number(size) : null };
  }
  return null;
}

// ============================================================
// Background FLAC job
// ============================================================
const pendingFlac = new Map();

function ensureFlac(videoId, ytUrl, title) {
  if (pendingFlac.has(videoId)) return pendingFlac.get(videoId);

  const task = (async () => {
    try {
      const quick = await findFlacFast(videoId, title);
      if (quick) return quick;

      const reqOk = await triggerCutytConversion(ytUrl);
      if (!reqOk) return null;

      const candidates = buildSlugCandidates(title).map(s => `${FLAC_CDN}/${s}.flac`);
      for (let i = 0; i < 45; i++) {
        await sleep(2000);
        const hit = await probeFirstWorking(candidates);
        if (hit) {
          console.log(`✅ [CutYT] FLAC ready: ${hit}`);
          cacheSet(videoId, { url: hit, title, via: 'cutyt-api' });
          return { type: 'url', value: hit, size: null };
        }
      }
      console.log(`❌ [CutYT] Timeout waiting for CDN file (90s)`);
      return null;
    } catch (e) {
      console.log(`❌ [BG] job error: ${e.message}`);
      return null;
    } finally {
      pendingFlac.delete(videoId);
    }
  })();

  pendingFlac.set(videoId, task);
  return task;
}

// ============================================================
// Search
// ============================================================
async function searchMusicList(query) {
  try {
    const r = await ytSearch(query);
    if (!r || !r.videos) return [];
    return r.videos.slice(0, 10).map(v => ({
      title: v.title,
      url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : v.url,
      videoId: v.videoId,
      thumbnail: v.thumbnail,
      artist: v.author.name,
      duration: v.timestamp,
    }));
  } catch { return []; }
}

// ============================================================
// fetchSongByUrl (Updated to accept knownInfo)
// ============================================================
async function fetchSongByUrl(urlOrId, knownInfo = null) {
  try {
    const videoId = getVideoId(urlOrId);
    if (!videoId) throw new Error('Invalid Video ID');
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Use knownInfo if provided (fixes Render IP blocks)
    let title = knownInfo?.title || 'Unknown Title';
    let artist = knownInfo?.artist || 'Unknown Artist';
    let thumbnail = knownInfo?.thumbnail || null;
    let duration = knownInfo?.duration || 'Unknown';

    // Only query YouTube if we don't already have the title
    if (!knownInfo?.title) {
      try {
        const v = await ytSearch({ videoId });
        if (v?.title) {
          title = v.title;
          thumbnail = v.thumbnail;
          artist = v.author?.name || 'Unknown Artist';
          duration = v.timestamp;
        }
      } catch (e) {
        console.log(`⚠️ Metadata fetch failed for ${videoId}: ${e.message}`);
      }
    }

    const [playUrl, fastFlac] = await Promise.all([
      getPlayUrl(ytUrl),
      findFlacFast(videoId, title),
    ]);

    let downloadUrl = null, flacSize = null, flacPending = false;

    if (fastFlac) {
      downloadUrl = fastFlac.value;
      flacSize = fastFlac.size || null;
    } else {
      flacPending = true;
      ensureFlac(videoId, ytUrl, title).catch(() => {});
      console.log(`⏳ [BG] FLAC conversion started for "${title}"`);
    }

    return {
      videoId, title, url: ytUrl, thumbnail, playUrl,
      downloadUrl, localPath: null, flacSize,
      isFlac: !!downloadUrl,
      flacPending,
      singers: artist, author: artist, duration,
    };
  } catch (e) {
    console.error(`❌ Fetch error:`, e.message);
    return null;
  }
}

// ============================================================
// waitForFlac
// ============================================================
async function waitForFlac(videoId, timeoutMs = 180000, forceUpload = false) {
  const c = cacheGet(videoId);
  if (c?.url && await verifyRemoteFlac(c.url)) {
    return { type: 'url', value: c.url, size: c.size };
  }

  const pending = pendingFlac.get(videoId);
  if (pending) {
    const result = await Promise.race([pending, sleep(timeoutMs).then(() => null)]);
    return result;
  }

  return null;
}

module.exports = {
  searchMusicList,
  fetchSongByUrl,
  waitForFlac,
  getVideoId,
};
