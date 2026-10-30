require('dotenv').config();
const http = require('http'); // 🔥 Added for Render health check
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ==========================================
// 0. Render Health Check Server
// ==========================================
// Render Web Services require an open port to pass the health scan.
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Molfoid Bot is online and running!\n');
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health check server listening on port ${PORT}`);
});

// ==========================================
// 1. Environment Variables Safety Check
// ==========================================
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ FATAL ERROR: DISCORD_TOKEN is missing in your .env file!");
  process.exit(1);
}

// ==========================================
// 2. Create Discord Client
// ==========================================
const client = new Client({
  intents: [
    // Server intents
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    
    // 🔥 CRITICAL: Required for Voice features (Play in Voice)
    GatewayIntentBits.GuildVoiceStates, 

    // DM intents (required for private messages)
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
  ],
  // Partials — required so DM channels (which arrive uncached) can be handled
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

// ==========================================
// 3. Load Slash Commands (/ping, /purge, etc.)
// ==========================================
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`📦 Loaded Slash Command: /${command.data.name}`);
    } else {
      console.warn(`⚠️  Skipped ${file}: missing "data" or "execute" property`);
    }
  }
} else {
  console.warn("⚠️  No 'commands' folder found. Slash commands will not work.");
}

// ==========================================
// 4. Load Events (messageCreate, interactionCreate, ready, etc.)
// ==========================================
const eventsPath = path.join(__dirname, 'events');

if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    
    if (!event.name || !event.execute) {
      console.warn(`⚠️  Skipped ${file}: missing "name" or "execute" property`);
      continue;
    }
    
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    console.log(`🔔 Loaded Event: ${event.name}`);
  }
} else {
  console.warn("⚠️  No 'events' folder found. Bot will not respond to anything.");
}

// ==========================================
// 5. Global Error Handlers
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// ==========================================
// 6. Login
// ==========================================
client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log("🔑 Login successful. Connecting to gateway...");
  })
  .catch((err) => {
    console.error("❌ Failed to login. Check if your DISCORD_TOKEN is valid:", err.message);
  });
