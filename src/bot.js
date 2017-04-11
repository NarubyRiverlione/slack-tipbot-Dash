'use strict'

let _ = require('lodash')
let debug = require('debug')
let Botkit = require('botkit')
let assert = require('assert')
let parseArgs = require('minimist')
let mongoose = require('mongoose')
let autoIncrement = require('mongoose-auto-increment')

let argv = parseArgs(process.argv.slice(2))

const SLACK_TOKEN = argv['slack-token'] || process.env.TIPBOT_SLACK_TOKEN
const RPC_USER = argv['rpc-user'] || process.env.TIPBOT_RPC_USER
const RPC_PASSWORD = argv['rpc-password'] || process.env.TIPBOT_RPC_PASSWORD
const RPC_PORT = argv['rpc-port'] || process.env.TIPBOT_RPC_PORT || 9998
const WALLET_PASSW = argv['wallet-password'] || process.env.TIPBOT_WALLET_PASSWORD

assert(SLACK_TOKEN, '--slack-token or TIPBOT_SLACK_TOKEN is required')
assert(RPC_USER, '--rpc-user or TIPBOT_RPC_USER is required')
assert(RPC_PASSWORD, '--rpc-password or TIPBOT_RPC_PASSWORD is required')

const PRICE_CHANNEL_NAME = argv['PriceChannel'] || process.env.TIPBOT_PRICE_CHANNEL_NAME
const MODS_CHANNELNAME = argv['ModsChannel'] || process.env.TIPBOT_MODS_CHANNELNAME
const WARN_NEW_USER_CHANNELNAME = argv['WarnNewUserChannel'] || process.env.TIPBOT_WARN_NEW_USER_CHANNELNAME
const MAIN_CHANNEL_NAME = argv['MainChannel'] || process.env.TIPBOT_MAIN_CHANNEL_NAME
const DEBUG_CHANNEL_NAME = argv['DebugChannel'] || process.env.TIPBOT_DEBUG_CHANNEL_NAME

const ENABLE_RAIN_FEATURE = (argv['EnableRain'] || process.env.TIPBOT_ENABLE_RAIN_FEATURE) === 'true'
const RAIN_USERNAME = argv['RainUser'] || process.env.TIPBOT_RAIN_USERNAME

const ENABLE_AUTOWITHDRAW_FEATURE = (argv['EnableAutowithdraw'] || process.env.TIPBOT_ENABLE_AUTOWITHDRAW_FEATURE) == 'true'

const SHOW_RANDOM_HELP_TIMER = parseInt(argv['ShowHelpTimer'] || process.env.TIPBOT_SHOW_HELP_TIMER)


const debugMode = process.env.NODE_ENV === 'development' ? true : false



const TIPBOT_OPTIONS = {
  WALLET_PASSW: WALLET_PASSW,
  ALL_BALANCES: true,
  OTHER_BALANCES: true,
  ENABLE_RAIN_FEATURE,
  ENABLE_AUTOWITHDRAW_FEATURE,
  WARN_MODS_NEW_USER: !debugMode,
  WARN_MODS_USER_LEFT: !debugMode,
  RAIN_USERNAME,
  RAIN_TIMER: debugMode ? 1 : 30  // debug = check rain every minute, production check every 30 minutes
}

let OPTIONS = {
  PRICE_CHANNEL_NAME: debugMode ? DEBUG_CHANNEL_NAME : PRICE_CHANNEL_NAME,
  WARN_MODS_CHANNELNAME: debugMode ? DEBUG_CHANNEL_NAME : MODS_CHANNELNAME,
  WARN_NEW_USER_CHANNELNAME: debugMode ? DEBUG_CHANNEL_NAME : WARN_NEW_USER_CHANNELNAME,
  MAIN_CHANNEL_NAME: debugMode ? DEBUG_CHANNEL_NAME : MAIN_CHANNEL_NAME,

  SHOW_RANDOM_HELP_TIMER, // show a random help command every X minutes (6/12 hours = 360/720 minutes)

  DB: debugMode ? 'mongodb://localhost/tipdb-dev' : 'mongodb://localhost/tipdb' //tipbotdb
}

let initializing = 0

let tipbot = null
// decrease ticker until 0 => check rain balance > thershold
let rainTicker = 0
// decrease ticker until 0 => show random help command text
let helpTicker = OPTIONS.SHOW_RANDOM_HELP_TIMER === undefined ? 0 : OPTIONS.SHOW_RANDOM_HELP_TIMER * 60

/*
1) setup slack controller
2) (if needed) connect to mongoDb
3) connect to slack
4) 'hello' = connected to slack => setup tipbot
*/

debug('tipbot:bot')('Debug mode is: ' + debugMode)
// setup Slack Controller
let controller = Botkit.slackbot({
  logLevel: 4,
  debug: true
  //include 'log: false' to disable logging
  //or a 'logLevel' integer from 0 to 7 to adjust logging verbosity
})

// connection to slack (function so it can be used to reconnect)
function connect(controller) {
  // spawns the slackbot
  controller.spawn({
    token: SLACK_TOKEN,
    retry: 10
  }).startRTM(function (err, bot, payload) {
    if (err) {
      throw new Error(err)
    }
    // get info where bot is active
    let channels = [],
      groups = []

    _.each(payload.channels, function (channel) {
      if (channel.is_member) {
        channels.push('#' + channel.name)
      }
    })

    _.each(payload.groups, function (group) {
      if (group.is_open && !group.is_archived) {
        groups.push(group.name)
      }
    })

    debug('tipbot:bot')('******** Connected to Slack ********')
    debug('tipbot:bot')('You are <@%s:%s> of %s', payload.self.id, payload.self.name, payload.team.name)
    debug('tipbot:bot')('You are in (channels): %s', channels.join(', '))
    debug('tipbot:bot')('As well as (groups): %s', groups.join(', '))

  })
}

// open mongoDB connection if needed for a feature
const needMongoDb = TIPBOT_OPTIONS.ENABLE_AUTOWITHDRAW_FEATURE || TIPBOT_OPTIONS.ENABLE_RAIN_FEATURE
if (needMongoDb) {
  mongoose.connect(OPTIONS.DB, { config: { autoIndex: debugMode } })  // no autoIndex in production for preformance impact
  let db = mongoose.connection
  db.on('error', function (err) {
    debug('tipbot:db')('******** ERROR: unable to connect to database at ' + OPTIONS.DB + ': ' + err)
  })

  // database connection open =  conncect to slack
  db.once('open', function () {
    autoIncrement.initialize(db)
    require('./model/TipperModel')        // load mongoose Tipper model
    require('./model/AutowithdrawModel')  // load mongoose AutowithdrawModel model
    debug('tipbot:db')('********* Database connected ********')
    // make connnection to Slack
    connect(controller)

  })
} else {
  debug('tipbot:init')('No features enabled that need mongoDb.')
  // no mongoDB needed, connect now to slack
  connect(controller)
}

// connection to Slack has ended
controller.on('rtm_close', function () {
  debug('tipbot:bot')('!!!!!! BOTKIT CLOSED DOWN !!!!!!!!')
  //don't restart connection on error here because these an auto reconnect
  if (initializing === -99) {
    // flag for restart is set
    initializing = 0
    connect(controller)
  }
})

// botkit had an oopsie
controller.on('error', function (bot, msg) {
  debug('tipbot:bot')('+++++++++++++++ Slack Error!! +++++++++++++++')
  debug('tipbot:bot')('ERROR code:' + msg.error.code + ' = ' + msg.error.msg)
  // don't restart connection on error here because it will be restarted on the rtm_close event
})

// when bot is connected, get all needed channels
controller.on('hello', function (bot) {
  // prevent multiple connections
  // debug('tipbot:init')('Start Hello, Init count is now ' + initializing);
  if (initializing !== 0) {
    debug('tipbot:bot')('Already initializing... (count ' + initializing + ')')
    return
  }
  initializing++

  // setup tipbot
  if (tipbot === null) {
    debug('tipbot:bot')('******** Setup TipBot ********')
    // load TipBot after mongoose model is loaded
    var TipBot = require('./lib/tipbot')
    tipbot = new TipBot(bot, RPC_USER, RPC_PASSWORD, RPC_PORT, TIPBOT_OPTIONS)
  }

  // find channelID of PRICE_CHANNEL_NAME to broadcast price messages
  setChannel(OPTIONS.PRICE_CHANNEL_NAME, 'PRICETICKER_CHANNEL', 'No price channel to broadcast')
    .then(() => { setChannel(OPTIONS.WARN_NEW_USER_CHANNELNAME, 'WARN_NEW_USER_CHANNEL', ' warn new user channel') })
    .then(() => { setChannel(OPTIONS.WARN_MODS_CHANNELNAME, 'WARN_MODS_CHANNEL', ' Warn channel not set') })
    .then(() => { setChannel(OPTIONS.MAIN_CHANNEL_NAME, 'MAIN_CHANNEL', 'No Main channel found to send general messages to') })
    .then(() => {
      debug('tipbot:init')('All channels are set.')
      // connection is ready = clear initializing flag
      initializing--
    })
  // debug('tipbot:init')('Stop Hello, Init count is now ' + initializing);
})


function setChannel(channelName, tipBotChannel, errMsg) {
  return new Promise(
    (resolve, reject) => {
      if (channelName === undefined) { return reject('no channel name') }
      // find channelID of MAIN_CHANNEL to post general messages
      tipbot.getChannel(channelName)
        .then(channel => {
          tipbot.OPTIONS[tipBotChannel] = channel
          debug('tipbot:init')('Init: Channel ' + tipBotChannel + ' set to "' + channelName + '" (' + channel.id + ')')
          resolve()
        })
        .catch(err => {
          debug('tipbot:init')('ERROR: No ' + channelName + ' channel found. ' + errMsg)
          reject('no found ' + channelName + ' :' + err)
        })
    })
}


// response to ticks
controller.on('tick', function () {
  if (initializing === 0 && tipbot !== null && !tipbot.initializing) {
    // only when TipBot is finished initializing

    // check rain balance every X minutes
    if (tipbot.OPTIONS.ENABLE_RAIN_FEATURE &&
      tipbot.OPTIONS.RAIN_TIMER !== undefined &&
      tipbot.rain.rainUser !== undefined) {
      // only check rain balance every RAIN_TIMER min
      if (rainTicker === 0) {
        debug('tipbot:rain')('RAIN: check balance > threshold now')
        tipbot.checkForRain()

        // reset ticker
        rainTicker = tipbot.OPTIONS.RAIN_TIMER * 60
      } else {
        // decrease rainTicker until 0
        rainTicker--
      }
    }

    // show random help command text every X minutesm
    if (OPTIONS.SHOW_RANDOM_HELP_TIMER !== undefined) {
      // only check rain balance every RAIN_TIMER min
      if (helpTicker === 0) {
        debug('tipbot:help')('Help ticker reached 0 : show random help text')
        tipbot.showRandomHelp()
        // reset ticker
        helpTicker = OPTIONS.SHOW_RANDOM_HELP_TIMER * 60
      } else {
        // decrease rainTicker until 0
        helpTicker--
      }
    }
  } else if (initializing > 0) { debug('tipbot:init')('init counter ' + initializing) }
})

// emergency commands
controller.hears('emergency', ['direct_message'], function (bot, message) {
  debug('tipbot:EMERGENCY')('**** Got this EMERGENCY message: ' + message.text)
  bot.api.users.info({ 'user': message.user }, function (err, response) {
    if (err) { throw new Error(err) }
    let sender = response.user

    if (sender.is_admin === false) {
      debug('tipbot:EMERGENCY')('Emergency used by non admin !')
    } else {
      debug('tipbot:EMERGENCY')('**** Emergency is authorised by: ' + sender.name)

      if (message.text.match(/\brestart\b/i)) {
        debug('tipbot:EMERGENCY')('**** Emergency connection restart ****')
        if (initializing) {
          debug('tipbot:EMERGENCY')('++++ Tried a restart while still initializing, restart aborted.')
        } else {
          initializing = -99 // flag to restart
          bot.closeRTM()
        }
      }

      if (message.text.match(/\bstop\b/i)) {
        debug('tipbot:EMERGENCY')('**** Emergency stop ****')
        bot.closeRTM()
      }
    }
  })

})

// listen to direct messages to the bot, or when the bot is mentioned in a message
controller.hears('.*', ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
  const member = message.user
  let channel
  if (tipbot === null) {
    debug('tipbot:bot')('Problem: slack connection is up but tipbot isn\'t')
    return
  }

  // find the place where the message was posted
  let firstCharOfChannelID = message.channel.substring(0, 1)
  if (firstCharOfChannelID === 'C') {
    // in Public channel
    bot.api.channels.info({ 'channel': message.channel }, function (err, response) {
      if (err) { throw new Error(err) }
      channel = response.channel
      // let tipbot handle the message
      tipbot.onMessage(channel, member, message.text)
    })
  } else if (firstCharOfChannelID === 'G') {
    // in Private channel = Group
    bot.api.groups.info({ 'channel': message.channel }, function (err, response) {
      if (err) { throw new Error(err) }
      channel = response.group
      // let tipbot handle the message
      tipbot.onMessage(channel, member, message.text)
    })
  } else if (firstCharOfChannelID === 'D') {
    // in Direct Message channel =  id -> create channel object
    // let tipbot handle the message
    let DMchannelID = { 'id': message.channel }
    tipbot.onMessage(DMchannelID, member, message.text)
  }
  // });
})

// when a user change his profile (other username,...)
controller.on('user_change', function (bot, resp) {
  debug('tipbot:bot')('User ' + resp.user.name + ' has changed his/her profile.')
  tipbot.onUserChange(bot, resp.user)
})

// when a new user joins the Slack Team to the user.id can be added
controller.on('team_join', function (bot, resp) {
  debug('tipbot:bot')('User ' + resp.user.name + ' has joined !')
  tipbot.onUserChange(bot, resp.user)
})
