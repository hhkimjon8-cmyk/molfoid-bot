const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  AttachmentBuilder,
  PermissionFlagsBits 
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const { askGroq } = require('../utils/groq');
const { searchGif } = require('../utils/gif');
const { searchMusicList, fetchSongByUrl, waitForFlac } = require('../utils/music');
const { searchYouTube } = require('../utils/ytsearch');
const { getPlaylist } = require('../utils/playlist'); 
const { searchWallpapers } = require('../utils/wallpaper'); 
const { searchIMDb } = require('../utils/tvshow'); 
const { purgeMessages } = require('../utils/function'); 
const { getGameList, getGameUrls } = require('../utils/emulator'); 

process.env.YTDL_NO_UPDATE = '1';

const cooldowns = new Map();
const COOLDOWN_MS = 3000;
const chatHistories = new Map();
const autoPlaylist = [];
const warnings = new Map(); 

const DISCORD_ATTACH_MAX = 24 * 1024 * 1024;
const M4A_ATTACH_MAX     = 15 * 1024 * 1024; 
const M4A_TIMEOUT_MS     = 15000;            

const flacDelivered = new Set();

const STICKERS = {
  teasing: '123456789012345678', smug: '123456789012345678', pouting: '123456789012345678',
  mischievous: '123456789012345678', blushing: '123456789012345678', comforting: '123456789012345678',
  'angry-pout': '123456789012345678', blank: '123456789012345678', broken: '123456789012345678'
};

// ============================================================
// Helper Functions (Audio, Filenames, Embeds)
// ============================================================
async function downloadAudioBuffer(url, maxBytes = M4A_ATTACH_MAX, timeoutMs = M4A_TIMEOUT_MS) {
  if (!url) return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Accept-Encoding': 'identity' },
      timeout: timeoutMs,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
    });
    return Buffer.from(response.data);
  } catch (e) {
    console.log(`⚠️ audio buffer skipped (${e.message})`);
    return null;
  }
}

function safeFilename(title, ext = 'm4a') {
  const base = (title || 'audio')
    .replace(/[\\/:*?"<>|｜：]/g, ' ')
    .replace(/\s+/g, ' ').trim().substring(0, 40);
  return `${base || 'audio'}.${ext}`;
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function buildMusicEmbed(song, hasM4a = false, hasFlac = false, timerEnd = 0) {
  const embed = new EmbedBuilder()
    .setColor(0x00ffcc)
    .setTitle(song.title || 'Unknown Song')
    .setURL(song.url)
    .setThumbnail(song.thumbnail || null)
    .addFields(
      { name: '🎤 Artist / Channel', value: song.singers || '—', inline: true },
      { name: '⏱️ Duration', value: song.duration || '—', inline: true }
    )
    .setFooter({
      text: hasFlac ? '💎 Lossless FLAC attached' : hasM4a ? '▶️ Inline audio player' : song.flacPending ? '⏳ FLAC converting in background' : 'YouTube Stream'
    });

  if (hasFlac) {
    embed.setDescription('💎 *Lossless FLAC file attached — right-click → Save.*');
  } else if (hasM4a) {
    embed.setDescription('▶️ *Inline audio player attached.*');
  } else if (song.flacPending) {
    if (timerEnd) {
      embed.setDescription(`⏳ *Preparing FLAC... (ETA: <t:${timerEnd}:R>)*\n*I will update this message with the download link when ready.*`);
    } else {
      embed.setDescription('⏳ *Preparing FLAC (~20–60 s)...*');
    }
  } else {
    embed.setDescription('▶️ *Stream ready. Use the buttons below.*');
  }

  const buttons = [];

  if (song.downloadUrl) {
    buttons.push(new ButtonBuilder().setLabel('💎 Download FLAC').setStyle(ButtonStyle.Link).setURL(song.downloadUrl));
  } else if (song.localPath || song.flacPending) {
    const interim = `https://www.cutyt.com/download?url=${encodeURIComponent(song.url)}&format=flac&type=audio`;
    buttons.push(new ButtonBuilder().setLabel(song.flacPending ? '⏳ FLAC preparing...' : '💎 Get FLAC (CutYT)').setStyle(ButtonStyle.Link).setURL(interim));
  }

  if (song.url) {
    buttons.push(new ButtonBuilder().setLabel('🌐 Watch on YouTube').setStyle(ButtonStyle.Link).setURL(song.url));
  }

  const components = buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [];
  return { embed, components };
}

function buildMusicRows(list) {
  if (!list || list.length <= 1) return [];
  const options = list.slice(0, 25).map((item, idx) => ({
    label: (item.title || `Result ${idx + 1}`).substring(0, 100),
    value: String(idx),
    description: item.artist ? item.artist.substring(0, 100) : undefined,
    emoji: '🎵'
  }));
  const select = new StringSelectMenuBuilder().setCustomId('music_pick_msg').setPlaceholder(`📋 ${list.length} results`).addOptions(options);
  return [new ActionRowBuilder().addComponents(select)];
}

async function deliverFlac(replyMsg, target, mode, song, contentText, extraComponents) {
  if (!song.videoId || flacDelivered.has(song.videoId)) return;
  flacDelivered.add(song.videoId);

  const flacName = safeFilename(song.title, 'flac');

  try {
    const got = await waitForFlac(song.videoId, 240000, true);
    if (!got) return;

    song.flacPending = false;
    let hasLocalFlac = false;
    let files = [];

    if (got.type === 'url' && got.value) {
      song.downloadUrl = got.value;
    } else if (got.type === 'local' && got.value && fs.existsSync(got.value)) {
      const size = fs.statSync(got.value).size;
      if (size <= DISCORD_ATTACH_MAX) {
        files.push(new AttachmentBuilder(got.value, { name: flacName }));
        hasLocalFlac = true;
      }
    }

    const { embed, components } = buildMusicEmbed(song, false, hasLocalFlac);
    const payload = {
      content: contentText,
      embeds: [embed],
      components: [...extraComponents, ...components],
      attachments: [], 
    };
    if (files.length) payload.files = files;

    if (mode === 'editReply') {
      await target.editReply(payload).catch(() => {});
    } else {
      await replyMsg.edit(payload).catch(() => {});
    }
  } catch (e) {
    console.log(`⚠️ [FLAC] delivery failed for ${song.videoId}: ${e.message}`);
  } finally {
    setTimeout(() => flacDelivered.delete(song.videoId), 60_000);
  }
}

async function sendMusicReply(target, mode, song, contentText, extraComponents = []) {
  let m4aAttachment = null;
  if (song.playUrl) {
    const buf = await downloadAudioBuffer(song.playUrl);
    if (buf) m4aAttachment = new AttachmentBuilder(buf, { name: safeFilename(song.title, 'm4a') });
  }

  let flacAttachment = null;
  if (song.localPath && fs.existsSync(song.localPath)) {
    const size = fs.statSync(song.localPath).size;
    if (size <= DISCORD_ATTACH_MAX) flacAttachment = new AttachmentBuilder(song.localPath, { name: safeFilename(song.title, 'flac') });
  }

  const timerEnd = Math.floor(Date.now() / 1000) + 60;
  const { embed, components } = buildMusicEmbed(song, !!m4aAttachment, !!flacAttachment, timerEnd);

  const files = [];
  if (flacAttachment) files.push(flacAttachment);
  else if (m4aAttachment) files.push(m4aAttachment);

  const payload = {
    content: contentText,
    embeds: [embed],
    components: [...extraComponents, ...components],
  };
  if (files.length) payload.files = files;

  const dispatch = async (p) => {
    if (mode === 'editReply') return target.editReply(p);
    if (mode === 'edit')      return target.edit(p);
    return target.reply(p);
  };

  let replyMsg;
  try {
    replyMsg = await dispatch(payload);
  } catch (e) {
    const isAbort = e.name === 'AbortError' || e.code === 'UND_ERR_ABORTED' || e.code === 10062 || /abort/i.test(e.message || '');
    if (isAbort && files.length) {
      const fallback = buildMusicEmbed(song, false, false, timerEnd);
      const safePayload = { content: contentText, embeds: [fallback.embed], components: [...extraComponents, ...fallback.components] };
      replyMsg = await dispatch(safePayload);
    } else {
      throw e;
    }
  }

  if (song.flacPending || song.localPath) {
    setImmediate(() => deliverFlac(replyMsg, target, mode, song, contentText, extraComponents));
  }

  return replyMsg;
}

// ============================================================
// Module Export & Pro Commands
// ============================================================
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot || message.system) return;

    // ==========================================
    // 🚨 PRO PREFIX COMMANDS (!ban, !warn, !game, !help) 🚨
    // ==========================================
    const PREFIX = '!';
    if (message.content.startsWith(PREFIX) && message.guild) {
      const args = message.content.slice(PREFIX.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      // --- !help ---
      if (command === 'help' || command === 'commands') {
        const helpEmbed = new EmbedBuilder()
          .setColor(0x00ffcc)
          .setTitle('📖 Molfoid Command List')
          .setDescription('Here is everything I can do, moron. Use them wisely.')
          .addFields(
            { name: '🛠️ Moderation', value: '`!ban @user 1h [reason]` - Temp ban\n`!warn @user [reason]` - Log a warning\n`!purge 50` - Bulk delete msgs' },
            { name: '💻 Utilities', value: '`!github <repo_url>` - Latest release\n`!ping` - Bot latency' },
            { name: '🎵 Music', value: '`song <name>` - Search & play\n`playlist <name>` - Generate playlist\n`!play <name>` - Direct play' },
            { name: '🎮 Games', value: '`!game` - List GBA games\n`!game <name>` - Play a GBA game' },
            { name: '🎬 Media', value: '`wallpaper <query>` - Find wallpapers\n`movie <query>` - Search IMDb\n`search <query> yt` - YouTube search' },
            { name: '🤖 AI Chat', value: 'Just mention me or send a DM! (Or use `reset` to clear memory)' }
          )
          .setFooter({ text: 'Prefix: ! | Some commands also work without prefix via AI' });
        return message.reply({ embeds: [helpEmbed] });
      }

      // --- !ping ---
      if (command === 'ping') {
        return message.reply(`🏓 Pong! Latency: \`${Math.round(message.client.ws.ping)}ms\``);
      }

      // --- !purge ---
      if (command === 'purge' || command === 'clear') {
        return purgeMessages(message, args);
      }

      // --- !github ---
      if (command === 'github' || command === 'gh') {
        const repoUrl = args[0];
        if (!repoUrl || !repoUrl.includes('github.com')) {
          return message.reply('❌ Provide a valid GitHub URL (e.g., `!github https://github.com/discordjs/discord.js`)');
        }
        
        const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) return message.reply('❌ Invalid GitHub URL format.');
        
        const [, owner, repo] = match;
        const cleanRepo = repo.replace(/\.git$/, '');

        try {
          const res = await axios.get(`https://api.github.com/repos/${owner}/${cleanRepo}/releases/latest`);
          const release = res.data;
          
          const embed = new EmbedBuilder()
            .setColor(0x24292e)
            .setTitle(`📦 Latest Release: ${release.name || release.tag_name}`)
            .setURL(release.html_url)
            .setAuthor({ name: `${owner}/${cleanRepo}`, iconURL: 'https://github.githubassets.com/favicons/favicon.png' })
            .setDescription(release.body ? release.body.substring(0, 500) + '...' : 'No release notes provided.')
            .setFooter({ text: `Published on ${new Date(release.published_at).toDateString()}` });
            
          return message.reply({ embeds: [embed] });
        } catch (error) {
          return message.reply(`❌ Could not fetch releases for \`${owner}/${cleanRepo}\`. Make sure the repo exists and has releases.`);
        }
      }

      // --- !warn ---
      if (command === 'warn') {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          return message.reply('❌ You need the **Moderate Members** permission to warn users.');
        }
        const targetUser = message.mentions.users.first();
        if (!targetUser) return message.reply('❌ Mention a user to warn. Usage: `!warn @user [reason]`');
        
        const reason = args.slice(1).join(' ') || 'No reason provided';
        
        if (!warnings.has(targetUser.id)) warnings.set(targetUser.id, []);
        warnings.get(targetUser.id).push(reason);
        const userWarns = warnings.get(targetUser.id).length;

        try {
          await targetUser.send(`⚠️ You have been warned in **${message.guild.name}** by ${message.author.tag}.\n**Reason:** ${reason}\n**Total Warnings:** ${userWarns}`);
        } catch { /* DMs closed */ }

        const embed = new EmbedBuilder()
          .setColor(0xff9900)
          .setTitle('⚠️ User Warned')
          .setDescription(`${targetUser.tag} has been warned.`)
          .addFields(
            { name: 'Reason', value: reason },
            { name: 'Total Warnings', value: `${userWarns}`, inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true }
          );
        return message.reply({ embeds: [embed] });
      }

      // --- !ban (Tempban) ---
      if (command === 'ban') {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
          return message.reply('❌ You need the **Ban Members** permission to ban users.');
        }
        const targetUser = message.mentions.users.first();
        if (!targetUser) return message.reply('❌ Mention a user to ban. Usage: `!ban @user [1h/1d] [reason]`');
        if (targetUser.id === message.author.id) return message.reply('❌ You cannot ban yourself, idiot.');
        if (targetUser.id === message.client.user.id) return message.reply('❌ You cannot ban me!');

        const timeArg = args[1];
        const timeMatch = timeArg ? timeArg.match(/^(\d+)([smhd])$/i) : null;
        
        let durationMs = 0;
        let durationStr = 'Permanent';
        
        if (timeMatch) {
          const value = parseInt(timeMatch[1], 10);
          const unit = timeMatch[2].toLowerCase();
          if (unit === 's') durationMs = value * 1000;
          if (unit === 'm') durationMs = value * 60 * 1000;
          if (unit === 'h') durationMs = value * 60 * 60 * 1000;
          if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;
          durationStr = timeArg;
        }

        const reason = args.slice(timeMatch ? 2 : 1).join(' ') || 'No reason provided';

        try {
          await targetUser.send(`🔨 You have been **banned** from **${message.guild.name}**.\n**Duration:** ${durationStr}\n**Reason:** ${reason}`).catch(() => {});
          
          await message.guild.members.ban(targetUser, { reason: `${reason} (Banned by ${message.author.tag})` });
          
          const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🔨 User Banned')
            .setDescription(`${targetUser.tag} has been banned.`)
            .addFields(
              { name: 'Duration', value: durationStr, inline: true },
              { name: 'Reason', value: reason, inline: true }
            );
          await message.reply({ embeds: [embed] });

          if (durationMs > 0) {
            setTimeout(async () => {
              try {
                await message.guild.members.unban(targetUser.id, 'Temporary ban expired');
                message.channel.send(`✅ **${targetUser.tag}** has been automatically unbanned.`);
              } catch (e) { console.error('Auto-unban failed:', e.message); }
            }, durationMs);
          }

        } catch (error) {
          return message.reply('❌ I could not ban this user. Make sure my role is higher than theirs.');
        }
        return;
      }

      // --- !game (GBA Emulator) ---
      if (command === 'game' || command === 'playgame') {
        const gameKey = args[0];
        
        // Show List of Games with Images
        if (!gameKey) {
          const games = await getGameList();
          if (!games || games.length === 0) return message.reply("❌ No games available.");

          // Create an embed for each game showing its image
          const embeds = games.slice(0, 10).map(g => {
            return new EmbedBuilder()
              .setColor(0x8E33FF)
              .setTitle(`🎮 ${g.name}`)
              .setThumbnail(g.thumbnail || null)
              .setDescription(`Type \`!game ${g.key}\` to play this game!`);
          });
          
          return message.reply({ 
            content: '🎮 **Available Games**', 
            embeds: embeds 
          });
        }

        // Show specific game launch buttons
        const urls = getGameUrls(gameKey);
        if (!urls) {
          return message.reply(`❌ Game \`${gameKey}\` not found. Type \`!game\` to see the list.`);
        }

        const embed = new EmbedBuilder()
          .setColor(0x00ffcc)
          .setTitle(`🎮 ${urls.name}`)
          .setThumbnail(urls.thumbnail || null) // Shows the game cover art!
          .setDescription('Click the buttons below to launch the emulator in your browser!')
          .setFooter({ text: 'Note: Multiplayer requires a public netplay server.' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('🎮 Single Player').setStyle(ButtonStyle.Link).setURL(urls.singlePlayer),
          new ButtonBuilder().setLabel('👥 Multiplayer').setStyle(ButtonStyle.Link).setURL(urls.multiPlayer)
        );

        return message.reply({ embeds: [embed], components: [row] });
      }
    }

    // ==========================================
    // BACKGROUND AUTO-SCANNER
    // ==========================================
    setImmediate(async () => {
      try {
        const urlRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s]+)/gi;
        const ytLinks = message.content.match(urlRegex);
        if (ytLinks) {
          ytLinks.forEach(link => {
            if (!autoPlaylist.includes(link) && autoPlaylist.length < 100) {
              autoPlaylist.push(link);
              console.log(`[Auto-Scan] Saved YT Link: ${link}`);
            }
          });
        }
        if (message.attachments.size > 0) {
          for (const [, att] of message.attachments) {
            if (att.name && att.name.match(/\.(mp3|m4a|flac|wav|ogg)$/i)) {
              const query = att.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
              const result = await searchYouTube(`${query} song`);
              if (result && result.length > 0) {
                const foundLink = result[0].url;
                if (!autoPlaylist.includes(foundLink) && autoPlaylist.length < 100) {
                  autoPlaylist.push(foundLink);
                  console.log(`[Auto-Scan] Matched Audio File to: ${foundLink}`);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Auto-Scanner Error:', e.message);
      }
    });

    const isDM = !message.guild;
    if (!isDM && !message.mentions.has(message.client.user.id)) return;

    const now = Date.now();
    const last = cooldowns.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return message.react('⏳').catch(() => {});
    cooldowns.set(message.author.id, now);

    let prompt = message.content;
    prompt = prompt.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '');
    const otherMentions = message.mentions.users.filter(u => u.id !== message.client.user.id);
    otherMentions.forEach(user => {
      prompt = prompt.replace(new RegExp(`<@!?${user.id}>`, 'g'), `@${user.username}`);
    });
    prompt = prompt.trim();

    if (!prompt) {
      return message.reply("*sends an annoyed sticker* What the hell do you want? At least say something, moron.");
    }

    try {
      await message.channel.sendTyping();
      console.log(`💬 ${isDM ? '[DM]' : '[Server]'} ${message.author.tag}: ${prompt}`);

      if (prompt.toLowerCase().includes('reset memory') || prompt.toLowerCase() === 'reset') {
        chatHistories.delete(message.author.id);
        return message.reply("*sends a smug sticker* Tch... fine, I forgot everything we talked about. Happy now, idiot?");
      }

      // ==========================================
      // NATURAL LANGUAGE: PURGE
      // ==========================================
      if (/^(delete|purge|clear)\s+(msg|messages?)\b/i.test(prompt)) {
        return await purgeMessages(message, prompt);
      }

      // ==========================================
      // AUTO-PLAYLIST
      // ==========================================
      if (prompt.toLowerCase() === 'auto playlist' || prompt.toLowerCase() === 'saved songs') {
        if (autoPlaylist.length === 0) {
          return message.reply("*sends a smug sticker* Tch... The playlist is empty. Drop some links or audio files, dummy.");
        }
        const list = autoPlaylist.slice(-10).map((url, i) => `**${i + 1}.** ${url}`).join('\n');
        const embed = new EmbedBuilder()
          .setColor(0x00ffcc).setTitle('🎶 Auto-Saved Public Playlist')
          .setDescription(list).setFooter({ text: `Total links saved: ${autoPlaylist.length}` });
        return message.reply({ embeds: [embed] });
      }

      // ==========================================
      // 1. WALLPAPER (Image Display)
      // ==========================================
      if (/^(wallpaper|wp)\s+(.+)$/i.test(prompt)) {
        const query = prompt.replace(/^(wallpaper|wp)\s+/i, '').trim();
        const allResults = await searchWallpapers(query);
        
        if (!allResults || allResults.length === 0) {
          return message.reply(`*sends an annoyed sticker* Tch... I couldn't find any wallpapers for "${query}", idiot.`);
        }

        let currentPage = 0;
        const itemsPerPage = 5; 
        const totalPages = Math.ceil(allResults.length / itemsPerPage);

        const generateWallpaperPayload = (page) => {
          const start = page * itemsPerPage;
          const pageResults = allResults.slice(start, start + itemsPerPage);

          const embeds = pageResults.map((wp, index) => {
            const embed = new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(`🖼️ ${wp.title}`)
              .setURL(wp.pageUrl)
              .setImage(wp.imageUrl) 
              .setFooter({ 
               text: `Resolution: ${wp.resolution || 'Unknown'} | Uploader: ${wp.uploader || 'Unknown'} | Image ${start + index + 1} of ${allResults.length}`
              });
            return embed;
          });

          const components = [];
          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('wp_prev').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
              new ButtonBuilder().setCustomId('wp_next').setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
            ));
          }

          return {
            content: `*sends a smug sticker* Tch... here are some "${query}" wallpapers. (Page ${page + 1}/${totalPages})`,
            embeds: embeds,
            components: components
          };
        };

        const replyMsg = await message.reply(generateWallpaperPayload(currentPage));

        if (totalPages > 1) {
          const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });
          collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
            if (i.customId === 'wp_prev') { currentPage--; await i.update(generateWallpaperPayload(currentPage)); }
            else if (i.customId === 'wp_next') { currentPage++; await i.update(generateWallpaperPayload(currentPage)); }
          });
          collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      // ==========================================
      // 2. IMDB
      // ==========================================
      if (/^(movie|tv|show|film)\s+(.+)$/i.test(prompt)) {
        const query = prompt.replace(/^(movie|tv|show|film)\s+/i, '').trim();
        const allResults = await searchIMDb(query);
        if (!allResults || allResults.length === 0) {
          return message.reply(`*sends a pouting sticker* Tch... I couldn't find any movies or shows for "${query}", baka.`);
        }
        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(allResults.length / itemsPerPage);
        const gen = (page) => {
          const start = page * itemsPerPage;
          const pageResults = allResults.slice(start, start + itemsPerPage);
          const embeds = pageResults.map(item => {
            const typeEmoji = item.type === 'tvSeries' ? '📺' : item.type === 'movie' ? '🎬' : '🎞️';
            const embed = new EmbedBuilder()
              .setColor(0xf5c518).setTitle(`${typeEmoji} ${item.title} (${item.year})`)
              .setURL(`https://www.imdb.com/title/${item.id}/`)
              .setFooter({ text: `Type: ${item.type} | Click title for IMDb page` });
            if (item.image) embed.setThumbnail(item.image);
            return embed;
          });
          const components = [];
          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('imdb_prev').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
              new ButtonBuilder().setCustomId('imdb_next').setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
            ));
          }
          return {
            content: `*sends a smug sticker* Hmph. Here are the IMDb results for "${query}". (Page ${page + 1}/${totalPages})`,
            embeds, components,
          };
        };
        const replyMsg = await message.reply(gen(currentPage));
        if (totalPages > 1) {
          const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });
          collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
            if (i.customId === 'imdb_prev') { currentPage--; await i.update(gen(currentPage)); }
            else if (i.customId === 'imdb_next') { currentPage++; await i.update(gen(currentPage)); }
          });
          collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      // ==========================================
      // 3. PLAYLIST
      // ==========================================
      const isPlaylistRequest = prompt.toLowerCase().includes('playlist') && !prompt.toLowerCase().includes('auto');
      if (isPlaylistRequest) {
        let query = prompt.replace(/\b(playlist|mix|make|a|of|the|music|songs?)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (!query) query = prompt;
        const playlistData = await getPlaylist(query);
        if (!playlistData) {
          return message.reply(`*sends an angry sticker* Tch... I couldn't find any playlist for "${query}", idiot.`);
        }
        let currentPage = 0;
        const itemsPerPage = 10;
        const totalPages = Math.ceil(playlistData.videos.length / itemsPerPage);
        const gen = (page) => {
          const start = page * itemsPerPage;
          const pageVideos = playlistData.videos.slice(start, start + itemsPerPage);
          const songList = pageVideos.map((v, i) =>
            `**${start + i + 1}.** [${v.title.substring(0, 50)}...](${v.url}) \`${v.duration}\``
          ).join('\n');
          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`🎶 ${message.author.username}'s Playlist: ${playlistData.title}`)
            .setDescription(songList || 'No songs found.')
            .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Songs: ${playlistData.videos.length}` });
          const options = pageVideos.map((v, index) => ({
            label: v.title.substring(0, 100),
            value: String(start + index),
            description: `${v.author} • ${v.duration}`.substring(0, 100),
            emoji: '🎵'
          }));
          const select = new StringSelectMenuBuilder()
            .setCustomId('playlist_pick')
            .setPlaceholder('🎧 Pick a song to play')
            .addOptions(options);
          const components = [new ActionRowBuilder().addComponents(select)];
          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('playlist_prev').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
              new ButtonBuilder().setCustomId('playlist_next').setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
            ));
          }
          return { embeds: [embed], components };
        };
        const replyMsg = await message.reply(gen(currentPage));
        const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });
        collector.on('collect', async (i) => {
          if (i.user.id !== message.author.id) {
            return i.reply({ content: "❌ This playlist isn't for you, baka!", ephemeral: true });
          }
          if (i.customId === 'playlist_prev') { currentPage--; await i.update(gen(currentPage)); }
          else if (i.customId === 'playlist_next') { currentPage++; await i.update(gen(currentPage)); }
          else if (i.customId === 'playlist_pick') {
            await i.deferUpdate();
            const picked = playlistData.videos[Number(i.values[0])];
            const song = await fetchSongByUrl(picked.url);
            if (song) {
              await sendMusicReply(i, 'editReply', song, '▶️ **Now Playing:**');
            } else {
              await i.editReply({ content: '*sends a broken sticker* Failed to get the link.' });
            }
          }
        });
        collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        return;
      }

      // ==========================================
      // 4. YOUTUBE SEARCH
      // ==========================================
      if (/^(search|find)\s+(.+?)\s+yt$/i.test(prompt)) {
        const query = prompt.replace(/^(search|find)\s+/i, '').replace(/\s+yt$/i, '').trim();
        const results = await searchYouTube(query);
        if (results.length === 0) {
          return message.reply(`*sends a pouting sticker* Tch... I couldn't find any YouTube video for "${query}", baka.`);
        }
        let currentPage = 0;
        const itemsPerPage = 5;
        const totalPages = Math.ceil(results.length / itemsPerPage);
        const gen = (page) => {
          const start = page * itemsPerPage;
          const pageResults = results.slice(start, start + itemsPerPage);
          const searchEmbeds = pageResults.map((v, i) => {
            const globalIndex = start + i + 1;
            return new EmbedBuilder()
              .setColor(0xff0000).setTitle(`${globalIndex}. ${v.title.substring(0, 80)}`)
              .setURL(v.url).setThumbnail(v.thumbnail)
              .addFields(
                { name: 'Channel', value: v.author.substring(0, 30), inline: true },
                { name: 'Duration', value: v.duration, inline: true }
              );
          });
          const options = pageResults.map((v, index) => ({
            label: v.title.substring(0, 100),
            value: String(start + index),
            description: `${v.author} • ${v.duration}`.substring(0, 100),
            emoji: '🎧'
          }));
          const select = new StringSelectMenuBuilder()
            .setCustomId('yt_search_pick')
            .setPlaceholder(`📋 ${results.length} results — pick one`)
            .addOptions(options);
          const components = [new ActionRowBuilder().addComponents(select)];
          if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('yt_prev').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
              new ButtonBuilder().setCustomId('yt_next').setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
            ));
          }
          return {
            content: `*sends an annoyed sticker* Tch... Page ${page + 1}/${totalPages} for "${query}". Pick one, moron.`,
            embeds: searchEmbeds, components,
          };
        };
        const replyMsg = await message.reply(gen(currentPage));
        const collector = replyMsg.createMessageComponentCollector({ time: 5 * 60 * 1000 });
        collector.on('collect', async (i) => {
          if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
          if (i.customId === 'yt_prev') { currentPage--; await i.update(gen(currentPage)); }
          else if (i.customId === 'yt_next') { currentPage++; await i.update(gen(currentPage)); }
          else if (i.customId === 'yt_search_pick') {
            await i.deferUpdate();
            const picked = results[Number(i.values[0])];
            const song = await fetchSongByUrl(picked.url);
            if (song) {
              await sendMusicReply(i, 'editReply', song, '▶️ **High Quality Stream:**');
            } else {
              await i.editReply({ content: '*sends a broken sticker* Failed to get the link.' });
            }
          }
        });
        collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        return;
      }

      // ==========================================
      // 5. YOUTUBE DIRECT
      // ==========================================
      if (/ yt$/i.test(prompt)) {
        const query = prompt.replace(/ yt$/i, '')
          .replace(/\b(give|me|play|search|find|download|the|a|song|music|mp3)\b/gi, '')
          .replace(/\s+/g, ' ').trim() || prompt.replace(/ yt$/i, '').trim();

        const results = await searchYouTube(query);
        if (results.length === 0) return message.reply(`*sends a pouting sticker* Tch... I couldn't find that on YouTube, baka.`);

        const song = await fetchSongByUrl(results[0].url);
        if (!song) return message.reply({ content: '*sends a broken sticker* Failed to get the link.' });

        return await sendMusicReply(message, 'reply', song, '▶️ **High Quality Stream:**');
      }

      // ==========================================
      // 6. MAIN MUSIC SEARCH
      // ==========================================
      const isMusicRequest =
        /\b(give|play|search|find|download)\b.*\b(song|music|mp3)\b/i.test(prompt) ||
        /^play\s+/i.test(prompt) ||
        prompt.toLowerCase().includes('song');

      if (isMusicRequest) {
        let query = prompt.replace(/\b(give|me|play|search|find|download|the|a|song|music|mp3)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (!query) query = prompt;

        const list = await searchMusicList(query);
        if (!list || list.length === 0) {
          return message.reply(`*sends a pouting sticker* Tch... I couldn't find any song called "${query}", baka.`);
        }

        const first = await fetchSongByUrl(list[0].videoId);
        if (!first) return message.reply("*sends a broken sticker* YouTube gave me garbage data. Try again later.");

        const molfoidText = `*sends a smug sticker* Tch... fine, here's "${query}". Don't expect me to do this every time, dummy.`;
        const replyMsg = await sendMusicReply(message, 'reply', first, molfoidText, buildMusicRows(list));

        if (list.length > 1) {
          const collector = replyMsg.createMessageComponentCollector({
            filter: (i) => i.customId === 'music_pick_msg',
            time: 5 * 60 * 1000,
          });
          collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: "❌ This menu isn't for you, baka!", ephemeral: true });
            await i.deferUpdate();
            const picked = list[Number(i.values[0])];
            const song = await fetchSongByUrl(picked.videoId);
            if (song) {
              await sendMusicReply(i, 'editReply', song, molfoidText, buildMusicRows(list));
            }
          });
          collector.on('end', () => replyMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      // ==========================================
      // 7. AI CHAT
      // ==========================================
      let aiPrompt = prompt;
      if (otherMentions.size > 0) {
        const lastMention = Array.from(otherMentions.values()).pop();
        aiPrompt = `[The user is talking to @${lastMention.username}] ${prompt}`;
      }
      let history = chatHistories.get(message.author.id) || [];
      history.push({ role: 'user', content: aiPrompt });
      if (history.length > 10) history = history.slice(history.length - 10);

      let aiResponse = await askGroq(history);
      let gifQuery = null;
      const aiGifMatch = aiResponse.match(/\[gif:\s*(.*?)\]/i);
      if (aiGifMatch) {
        gifQuery = aiGifMatch[1].trim();
        aiResponse = aiResponse.replace(aiGifMatch[0], '').trim();
      } else if (/\bgif\b/i.test(prompt)) {
        gifQuery = prompt.replace(/\bgif\b/i, '').trim() || 'angry anime girl';
      }
      let gifUrl = null;
      if (gifQuery) gifUrl = await searchGif(gifQuery);
      let stickerId = null;
      const stickerMatch = aiResponse.match(/\*sends an? ([a-z-]+) sticker\*/i);
      if (stickerMatch) {
        const stickerName = stickerMatch[1].toLowerCase();
        const foundId = STICKERS[stickerName];
        if (foundId && foundId !== '123456789012345678') stickerId = foundId;
        aiResponse = aiResponse.replace(stickerMatch[0], '').trim();
      }
      const cleanAiResponse = aiResponse.replace(/\[gif:\s*(.*?)\]/ig, '').trim();
      history.push({ role: 'assistant', content: cleanAiResponse });
      chatHistories.set(message.author.id, history);

      const chunks = aiResponse.match(/[\s\S]{1,1900}/g) || [aiResponse];
      const firstPayload = {};
      if (chunks[0] && chunks[0].trim() !== '') firstPayload.content = chunks[0];
      if (gifUrl) {
        const embed = new EmbedBuilder().setColor(0xff0000).setImage(gifUrl)
          .setFooter({ text: `Requested by ${message.author.username}` });
        if (!firstPayload.content) firstPayload.content = '*sends an angry sticker* Here is your stupid GIF.';
        firstPayload.embeds = [embed];
      }
      if (stickerId) firstPayload.stickers = [stickerId];
      if (Object.keys(firstPayload).length === 0) firstPayload.content = '*sends a smug sticker*';

      await message.reply(firstPayload);
      for (let i = 1; i < chunks.length; i++) await message.channel.send(chunks[i]);
    } catch (error) {
      console.error('❌ messageCreate error:', error);
      await message.reply('❌ Something went wrong, idiot.').catch(() => {});
    }
  },
};
