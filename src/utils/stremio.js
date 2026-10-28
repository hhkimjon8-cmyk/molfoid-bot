// utils/stremio.js
const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://web.stremio.com',
  'Referer': 'https://web.stremio.com/'
};

const customAddons = new Map();
customAddons.set('cinemeta', { name: 'Cinemeta (Official)', url: 'https://v3-cinemeta.strem.io/manifest.json' });
customAddons.set('cncverse', { name: 'CNCVerse', url: 'https://cncverse.dpdns.org/u/p_28ioyjpqr7zy/manifest.json' });

async function safeFetch(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 15000, validateStatus: () => true });
    
    if (res.status === 403 || res.status === 503) {
      throw new Error(`Blocked by protection (HTTP ${res.status})`);
    }

    let data = res.data;
    if (typeof data === 'string' && data.includes('<!DOCTYPE html>')) {
      throw new Error('HTML Challenge detected');
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { /* ignore */ }
    }
    return data;
  } catch (e) {
    throw e;
  }
}

async function fetchManifest(baseUrl) {
  try {
    const data = await safeFetch(baseUrl);
    if (!data || !data.catalogs) throw new Error('Invalid manifest');
    return data;
  } catch (e) {
    throw new Error(`Failed to fetch manifest: ${e.message}`);
  }
}

function addCustomAddon(key, name, manifestUrl) {
  customAddons.set(key.toLowerCase(), { name, url: manifestUrl });
}

function getAddons() {
  return Array.from(customAddons.entries()).map(([key, data]) => ({
    label: data.name, value: key, description: 'Stremio Addon'
  }));
}

function getAddonUrl(key) {
  const addon = customAddons.get(key);
  return addon ? addon.url : null;
}

// 🚨 FIX: Exact logic from HTML's buildCatalogURL
async function fetchCatalog(manifestUrl, type, id, extra = {}, extraConfig = []) {
  try {
    let baseUrl = manifestUrl.replace('/manifest.json', '');
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    let path = `/catalog/${type}/${id}`;
    const segments = [];
    const values = {};

    if (extra.search) values.search = extra.search;
    if (extra.genre) values.genre = extra.genre;
    if (extra.skip && extra.skip > 0) values.skip = String(extra.skip);

    // Follow the exact order declared in manifest.extra
    for (const ex of extraConfig) {
      if (Object.prototype.hasOwnProperty.call(values, ex.name)) {
        segments.push(`${encodeURIComponent(ex.name)}=${encodeURIComponent(values[ex.name])}`);
      }
    }

    if (segments.length > 0) path += `/${segments.join('/')}`;
    path += '.json';

    const targetUrl = `${baseUrl}${path}`;
    console.log(`\n[STREMIO FETCH] ${targetUrl}`);
    
    const data = await safeFetch(targetUrl);

    if (data && data.err) {
      console.error(`[STREMIO ERROR]`, data.err);
      return []; 
    }
    
    // 🚨 FIX: Added data.items fallback
    return data.metas || data.results || data.items || [];
  } catch (e) {
    console.error(`[Stremio] Catalog Error: ${e.message}`);
    return []; 
  }
}

async function fetchMeta(manifestUrl, type, id) {
  try {
    const baseUrl = manifestUrl.replace('/manifest.json', '');
    const data = await safeFetch(`${baseUrl}/meta/${type}/${encodeURIComponent(id)}.json`);
    if (data && data.err) return null;
    // 🚨 FIX: Added data fallback
    return data.meta || data;
  } catch (e) {
    console.error(`[Stremio] Meta Error: ${e.message}`);
    return null;
  }
}

async function fetchStreams(manifestUrl, type, id) {
  try {
    const baseUrl = manifestUrl.replace('/manifest.json', '');
    const data = await safeFetch(`${baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`);
    if (data && data.err) return [];
    return data.streams || [];
  } catch (e) {
    console.error(`[Stremio] Stream Error: ${e.message}`);
    return [];
  }
}

module.exports = { 
  fetchManifest, 
  addCustomAddon, 
  getAddons, 
  getAddonUrl, 
  fetchCatalog, 
  fetchMeta, 
  fetchStreams 
};