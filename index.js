const bedrock = require('bedrock-protocol')
const http = require('http')

// ---------- CONFIG (set these as environment variables on Render/Railway) ----------
const HOST = process.env.MC_HOST || 'play.yourserver.net'
const PORT = parseInt(process.env.MC_PORT || '19132', 10)
const ACCOUNT = process.env.MC_ACCOUNT || 'bot-account'          // any label, used for the token cache name
const OWNER = (process.env.OWNER_GAMERTAG || 'YourGamertag').toLowerCase() // only this player can command the bot
const VERSION = process.env.MC_VERSION || undefined               // e.g. "1.21.50" if auto-detect fails
const AUTH_DIR = process.env.AUTH_DIR || './auth'                 // point this at a persistent volume
const PREFIX = '!'
const AFK_COMMAND = process.env.AFK_COMMAND || ''                 // e.g. "/warp farm" - runs once after every join
// ------------------------------------------------------------------------------------

let client = null
let runtimeId = null
let antiAfk = true
let antiAfkTimer = null
let reconnectDelay = 10000

function log(...a) { console.log(new Date().toISOString(), ...a) }

function sendChat(message) {
  try {
    client.queue('text', {
      type: 'chat',
      needs_translation: false,
      source_name: client.username,
      xuid: '',
      platform_chat_id: '',
      filter_message: '',
      message
    })
  } catch (e) { log('chat failed:', e.message) }
}

function sendCommand(command) {
  if (!command.startsWith('/')) command = '/' + command
  try {
    client.queue('command_request', {
      command,
      origin: { type: 'player', uuid: '', request_id: '' },
      internal: false,
      version: 'latest'
    })
  } catch (e) { log('command failed:', e.message) }
}

function startAntiAfk() {
  clearInterval(antiAfkTimer)
  antiAfkTimer = setInterval(() => {
    if (!antiAfk || runtimeId === null) return
    try {
      client.queue('animate', { action_id: 'swing_arm', runtime_entity_id: runtimeId })
    } catch (e) { /* ignore */ }
  }, 30000)
}

function handleCommand(sender, message) {
  const [cmd, ...args] = message.slice(PREFIX.length).trim().split(/\s+/)
  const rest = args.join(' ')
  switch (cmd.toLowerCase()) {
    case 'say':
      sendChat(rest); break
    case 'cmd':
    case 'run':
      sendCommand(rest); break
    case 'afk':
      sendCommand(AFK_COMMAND || '/help')
      if (!AFK_COMMAND) sendChat('AFK_COMMAND not set')
      break
    case 'antiafk':
      antiAfk = args[0] ? args[0] === 'on' : !antiAfk
      sendChat('Anti-AFK is ' + (antiAfk ? 'on' : 'off')); break
    case 'ping':
      sendChat('pong'); break
    case 'help':
      sendChat('!say <msg> | !cmd </command> | !afk | !antiafk on/off | !ping | !quit'); break
    case 'quit':
      sendChat('Leaving. Bot will reconnect in a minute.')
      setTimeout(() => client.close(), 500); break
    default:
      sendChat('Unknown command. Try !help')
  }
}

function connect() {
  log(`Connecting to ${HOST}:${PORT} ...`)
  const options = {
    host: HOST,
    port: PORT,
    username: ACCOUNT,
    offline: false,              // Microsoft auth
    profilesFolder: AUTH_DIR,    // saved login tokens live here
    conLog: log,                 // prints the microsoft.com/link code in the logs on first run
    skipPing: true
  }
  if (VERSION) options.version = VERSION

  client = bedrock.createClient(options)

  client.on('start_game', (p) => { runtimeId = p.runtime_entity_id })

  client.on('spawn', () => {
    log('Spawned in the world as', client.username)
    reconnectDelay = 10000
    startAntiAfk()
    if (AFK_COMMAND) setTimeout(() => sendCommand(AFK_COMMAND), 5000)
  })

  client.on('text', (packet) => {
    if (packet.type !== 'chat') return
    const sender = (packet.source_name || '').toLowerCase()
    const msg = packet.message || ''
    if (sender === OWNER && msg.startsWith(PREFIX)) {
      log('Command from owner:', msg)
      handleCommand(sender, msg)
    }
  })

  client.on('kick', (reason) => log('Kicked:', JSON.stringify(reason)))
  client.on('error', (err) => log('Error:', err.message))
  client.on('close', () => {
    log(`Disconnected. Reconnecting in ${reconnectDelay / 1000}s`)
    clearInterval(antiAfkTimer)
    runtimeId = null
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 5 * 60 * 1000)
  })
}

// Tiny web server so Render/Railway see a healthy "web" service (and so UptimeRobot can ping it)
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('AFK bot is running')
}).listen(process.env.PORT || 3000, () => log('Health server up'))

connect()
