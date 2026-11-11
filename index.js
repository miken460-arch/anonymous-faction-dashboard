const http = require('http');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');

// ---------------------------------------------------------------------------
// Configuration (set these as Environment Variables on Render, never in code)
// ---------------------------------------------------------------------------
const TOKEN = process.env.DISCORD_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // your Apps Script /exec URL
const BOT_SECRET = process.env.BOT_SECRET;           // must match BOT_SECRET in Script Properties
const GUILD_ID = process.env.GUILD_ID;               // optional: makes commands appear instantly
const PORT = process.env.PORT || 10000;              // Render provides PORT automatically

const missing = ['DISCORD_TOKEN', 'APPS_SCRIPT_URL', 'BOT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing environment variables: ' + missing.join(', '));
  process.exit(1);
}

// Tiny web server so Render sees an open port (prevents 502 / restarts)
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  })
  .listen(PORT, '0.0.0.0', () => console.log('Web server listening on port ' + PORT));

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your faction vault balance'),
  new SlashCommandBuilder()
    .setName('request')
    .setDescription('Request funds from the faction vault')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Amount in $ (digits only, e.g. 5000000)').setMinValue(1).setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Why you need it').setRequired(true)
    ),
].map((c) => c.toJSON());

async function registerCommands(clientId) {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(clientId, GUILD_ID)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log('Slash commands registered' + (GUILD_ID ? ' for guild ' + GUILD_ID : ' globally'));
}

// ---------------------------------------------------------------------------
// Backend call (Apps Script)
// ---------------------------------------------------------------------------
async function callBackend(payload) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret: BOT_SECRET }),
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { success: false, message: 'The backend returned an unexpected response.' };
    }
  } catch (err) {
    return { success: false, message: 'Could not reach the backend: ' + err.message };
  }
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log('Logged in as ' + client.user.tag);
  try {
    await registerCommands(client.user.id);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Defer first: Discord requires a reply within 3 seconds
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let result;
  if (interaction.commandName === 'balance') {
    result = await callBackend({ type: 'balance', discordId: interaction.user.id });
  } else if (interaction.commandName === 'request') {
    result = await callBackend({
      type: 'request',
      discordId: interaction.user.id,
      amount: interaction.options.getInteger('amount'),
      reason: interaction.options.getString('reason'),
    });
  } else {
    return;
  }

  await interaction.editReply({ content: result.message || 'No response from backend.' });
});

client.login(TOKEN);
