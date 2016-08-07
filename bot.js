'use strict';

let _ = require('lodash');
let debug = require('debug');
let Botkit = require('botkit');
let assert = require('assert');
let parseArgs = require('minimist');
let mongoose = require('mongoose');

let argv = parseArgs(process.argv.slice(2));

const SLACK_TOKEN = argv['slack-token'] || process.env.TIPBOT_SLACK_TOKEN;
const RPC_USER = argv['rpc-user'] || process.env.TIPBOT_RPC_USER;
const RPC_PASSWORD = argv['rpc-password'] || process.env.TIPBOT_RPC_PASSWORD;
const RPC_PORT = argv['rpc-port'] || process.env.TIPBOT_RPC_PORT || 9998;
const WALLET_PASSW = argv['wallet-password'] || process.env.TIPBOT_WALLET_PASSWORD;

const debugMode = process.env.NODE_ENV === 'development' ? true : false;

const TIPBOT_OPTIONS = {
    WALLET_PASSW: WALLET_PASSW,
    ALL_BALANCES: true,
    OTHER_BALANCES: true,
    SUN_USERNAME: 'dashsun',
};

let OPTIONS = {
    PRICE_CHANNEL_NAME: debugMode ? 'bot_testing' : 'price_speculation',
    MODERATOR_CHANNEL_NAME: 'moderators',
    MAIN_CHANNEL_NAME: debugMode ? 'bot_testing' : 'dash_chat',

    SHOW_RANDOM_HELP_TIMER: 360,         // show a random help command every X minutes (6 hours = 360 minutes)

    DB: 'mongodb://localhost/tipdb-dev' //tipbotdb
};

let initializing = false;

let tipbot = null;
// decrease ticker until 0 => check sun balance > thershold
let sunTicker = 0;
// decrease ticker until 0 => show random help command text
let helpTicker = OPTIONS.SHOW_RANDOM_HELP_TIMER === undefined ? 0 : OPTIONS.SHOW_RANDOM_HELP_TIMER * 60;

assert(SLACK_TOKEN, '--slack-token or TIPBOT_SLACK_TOKEN is required');
assert(RPC_USER, '--rpc-user or TIPBOT_RPC_USER is required');
assert(RPC_PASSWORD, '--rpc-password or TIPBOT_RPC_PASSWORD is required');

/*
1) setup slack controller
2) connect to mongoDb
3) connect to slack
4) 'hello' = connected => setup tipbot
*/


// setup Slack Controller
let controller = Botkit.slackbot({
    logLevel: 4,
    debug: true
    //include 'log: false' to disable logging
    //or a 'logLevel' integer from 0 to 7 to adjust logging verbosity
});

// open mongoose connection
mongoose.connect(OPTIONS.DB);
let db = mongoose.connection;
db.on('error', function () {
    debug('tipbot:db')('******** ERROR: unable to connect to database at ' + OPTIONS.DB);
});


// connection to slack (function so it can be used to reconnect)
function connect(controller) {
    // prevent multiple connections
    if (initializing) {
        debug('tipbot:bot')('Already initializing...');
        return;
    }
    initializing = true;
    // spawns the slackbot
    controller.spawn({
        token: SLACK_TOKEN,
        retry: 10
    }).startRTM(function (err, bot, payload) {
        if (err) {
            throw new Error(err);
        }
        // get info where bot is active
        let channels = [],
            groups = [];

        _.each(payload.channels, function (channel) {
            if (channel.is_member) {
                channels.push('#' + channel.name);
            }
        });

        _.each(payload.groups, function (group) {
            if (group.is_open && !group.is_archived) {
                groups.push(group.name);
            }
        });

        debug('tipbot:bot')('******** Connected to Slack ********');
        debug('tipbot:bot')('You are <@%s:%s> of %s', payload.self.id, payload.self.name, payload.team.name);
        debug('tipbot:bot')('You are in (channels): %s', channels.join(', '));
        debug('tipbot:bot')('As well as (groups): %s', groups.join(', '));

    });
}

// database connection open =  conncect to slack
db.once('open', function () {
    require('./model/tipper'); // load mongoose Tipper model
    debug('tipbot:db')('********* Database connected ********');
    // make connnection to Slack
    connect(controller);

});

// connection to Slack has ended
controller.on('rtm_close', function () {
    debug('tipbot:bot')('!!!!!! BOTKIT CLOSED DOWN !!!!!!!!');
    // reset tipbot and reconnect to slack
    tipbot = null;
    connect(controller);
});

// botkit had an oopsie
controller.on('error', function (bot, msg) {
    debug('tipbot:bot')('+++++++++++++++ Slack Error!! +++++++++++++++');
    debug('tipbot:bot')('ERROR code:' + msg.error.code + ' = ' + msg.error.msg);

    // reset tipbot and reconnect to slack
    tipbot = null;
    connect(controller);
});


// when bot is connected, get all needed channels
controller.on('hello', function (bot) {
    // connection is ready = clear initializing flag
    initializing = false;
    // setup tipbot
    if (tipbot === null) {
        debug('tipbot:bot')('******** Setup TipBot ********');
        // load TipBot after mongoose model is loaded
        var TipBot = require('./lib/tipbot');
        tipbot = new TipBot(bot, RPC_USER, RPC_PASSWORD, RPC_PORT, TIPBOT_OPTIONS);
    }

    // find channelID of PRICE_CHANNEL_NAME to broadcast price messages
    if (OPTIONS.PRICE_CHANNEL_NAME !== undefined) {
        tipbot.getChannel(OPTIONS.PRICE_CHANNEL_NAME, function (err, priceChannel) {
            if (err) {
                debug('tipbot:bot')('Init: No price channel to broadcast.');
            } else {
                debug('tipbot:bot')('Init: Price channel ' + OPTIONS.PRICE_CHANNEL_NAME + ' = ' + priceChannel.id);
                // tell all prices on the price list
                tipbot.OPTIONS.PRICETICKER_CHANNEL = priceChannel;

                //     // set initial priceTicker boundaries
                //     tipbot.updatePriceTicker();
                //     // update priceTicker at interval
                //  //   if (tipbot.OPTIONS.PRICETICKER_TIMER !== undefined) {
                //         setInterval(function () {
                //             tipbot.updatePriceTicker();
                //         },
                //             tipbot.OPTIONS.PRICETICKER_TIMER * 60 * 1000);
                // //    }
            }
        });
    }

    // find channelID of MODERATOR_CHANNEL_NAME to post warning messages
    if (OPTIONS.MODERATOR_CHANNEL_NAME !== undefined) {
        tipbot.getChannel(OPTIONS.MODERATOR_CHANNEL_NAME, function (err, moderatorChannel) {
            if (err) {
                debug('tipbot:bot')('ERROR: No Moderator channel found to send admin messages to.');
            } else {
                debug('tipbot:bot')('Init: Moderator channel ' + OPTIONS.MODERATOR_CHANNEL_NAME + ' = ' + moderatorChannel.id);
                // set moderator channel for tipbot
                tipbot.OPTIONS.MODERATOR_CHANNEL = moderatorChannel;
            }
        });
    }

    // find channelID of MAIN_CHANNEL to post general messages
    if (OPTIONS.MAIN_CHANNEL_NAME !== undefined) {
        tipbot.getChannel(OPTIONS.MAIN_CHANNEL_NAME, function (err, mainChannel) {
            if (err) {
                debug('tipbot:bot')('ERROR: No Main channel found to send general messages to.');
            } else {
                debug('tipbot:bot')('Init: Main channel ' + OPTIONS.MAIN_CHANNEL_NAME + ' = ' + mainChannel.id);
                // set moderator channel for tipbot
                tipbot.OPTIONS.MAIN_CHANNEL = mainChannel;
            }
        });
    }
});

// response to ticks
controller.on('tick', function () {
    if (!initializing && tipbot !== null && !tipbot.initializing) {
        // only when TipBot is finished initializing

        // check sun balance every X minutes
        if (tipbot.OPTIONS.SUN_THRESHOLD !== undefined &&
            tipbot.OPTIONS.SUN_TIMER !== undefined &&
            tipbot.sunUser !== undefined) {
            // only check sun balance every SUN_TIMER min
            if (sunTicker === 0) {
                debug('tipbot:sun')('SUN: check balance > threshold now');
                tipbot.sunCheckThreshold();
                // reset ticker
                sunTicker = tipbot.OPTIONS.SUN_TIMER * 60;
            } else {
                // decrease sunTicker until 0
                sunTicker--;
            }
        }

        // show random help command text every X minutes
        if (OPTIONS.SHOW_RANDOM_HELP_TIMER !== undefined) {
            // only check sun balance every SUN_TIMER min
            if (helpTicker === 0) {
                debug('tipbot:help')('Help ticker reached 0 : show random help text');
                tipbot.showRandomHelp();
                // reset ticker
                helpTicker = OPTIONS.SHOW_RANDOM_HELP_TIMER * 60;
            } else {
                // decrease sunTicker until 0
                helpTicker--;
            }
        }
    }
});

// emergency commands
controller.hears('emergency', ['direct_message'], function (bot, message) {
    debug('tipbot:EMERGENCY')('**** Got this EMERGENCY message: ' + message.text);
    bot.api.users.info({ 'user': message.user }, function (err, response) {
        if (err) { throw new Error(err); }
        let sender = response.user;

        if (sender.is_admin === false) {
            debug('tipbot:EMERGENCY')('Emergency used by non admin !');
        } else {
            debug('tipbot:EMERGENCY')('**** Emergency is authorised by: ' + sender.name);

            if (message.text.match(/\brestart\b/i)) {
                debug('tipbot:EMERGENCY')('**** Emergency connection restart ****');
                if (initializing) {
                    debug('tipbot:EMERGENCY')('++++ Tried a restart while still initializing, restart aborted.');
                } else { bot.closeRTM(); }
            }

            if (message.text.match(/\bstop\b/i)) {
                debug('tipbot:EMERGENCY')('**** Emergency stop ****');
            }
        }
    });

});
// listen to direct messages to the bot, or when the bot is mentioned in a message
controller.hears('.*', ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    let member, channel;
    if (tipbot === null) {
        debug('tipbot:bot')('Problem: slack connection is up but tipbot isn\'t');
        return;
    }
    // TODO : not needed as there is an array of users in TipBot that's always up to date ?
    // get the user that posted the message
    bot.api.users.info({ 'user': message.user }, function (err, response) {
        if (err) { throw new Error(err); }
        member = response.user;

        // find the place where the message was posted
        let firstCharOfChannelID = message.channel.substring(0, 1);
        if (firstCharOfChannelID === 'C') {
            // in Public channel
            bot.api.channels.info({ 'channel': message.channel }, function (err, response) {
                if (err) { throw new Error(err); }
                channel = response.channel;
                // let tipbot handle the message
                tipbot.onMessage(channel, member, message.text);
            });
        } else if (firstCharOfChannelID === 'G') {
            // in Private channel = Group
            bot.api.groups.info({ 'channel': message.channel }, function (err, response) {
                if (err) { throw new Error(err); }
                channel = response.group;
                // let tipbot handle the message
                tipbot.onMessage(channel, member, message.text);
            });
        } else if (firstCharOfChannelID === 'D') {
            // in Direct Message channel =  id -> create channel object
            // let tipbot handle the message
            let DMchannelID = { 'id': message.channel };
            tipbot.onMessage(DMchannelID, member, message.text);
        }
    });
});
// when a user change his profile (other username,...)
controller.on('user_change', function (bot, resp) {
    debug('tipbot:bot')('User ' + resp.user.name + ' has changed his/her profile.');
    tipbot.onUserChange(bot, resp.user);
});
// when a new user joins the Slack Team to the user.id can be added
controller.on('team_join', function (bot, resp) {
    debug('tipbot:bot')('User ' + resp.user.name + ' has joined !');
    tipbot.onUserChange(bot, resp.user);
});


