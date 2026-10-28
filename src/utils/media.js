// utils/media.js

/**
 * Generates external media player links based on OS
 * @param {string} streamUrl The direct HTTP/HTTPS video stream URL
 */
function getMediaPlayerLinks(streamUrl) {
  const encodedUrl = encodeURIComponent(streamUrl);
  
  return {
    // Android VLC Intent
    androidVlc: `intent://${streamUrl}#Intent;package=org.videolan.vlc;type=video;scheme=https;end`,
    // iOS VLC Callback
    iosVlc: `vlc-x-callback://x-callback-url/stream?url=${encodedUrl}`,
    // Desktop VLC (Requires VLC to be installed and protocol registered)
    desktopVlc: `vlc://${streamUrl}`,
    // Direct Browser Playback
    webBrowser: streamUrl
  };
}

module.exports = { getMediaPlayerLinks };