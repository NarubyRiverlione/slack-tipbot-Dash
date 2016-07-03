"use strict";

var _ = require("lodash");
var debug = require("debug");
var Botkit = require("botkit");
var assert = require("assert");
var parseArgs = require("minimist");
var mongoose = require("mongoose");

var argv = parseArgs(process.argv.slice(2));

var SLACK_TOKEN = argv["slack-token"] || process.env.TIPBOT_SLACK_TOKEN;
var RPC_USER = argv["rpc-user"] || process.env.TIPBOT_RPC_USER;
var RPC_PASSWORD = argv["rpc-password"] || process.env.TIPBOT_RPC_PASSWORD;
var RPC_PORT = argv["rpc-port"] || process.env.TIPBOT_RPC_PORT || 9998;
var WALLET_PASSW = argv["wallet-password"] || process.env.TIPBOT_WALLET_PASSWORD;

var OPTIONS = {
    ALL_BALANCES: false,
    DEMAND: false,
    PRICE_CHANNEL: "bot_testing", //  "price_speculation",
    MODERATOR_CHANNEL: "moderators",
    DB: "mongodb://localhost/tipdb-dev"  //tipbotdb
};

var tipbot;

assert(SLACK_TOKEN, "--slack-token or TIPBOT_SLACK_TOKEN is required");
assert(RPC_USER, "--rpc-user or TIPBOT_RPC_USER is required");
assert(RPC_PASSWORD, "--rpc-password or TIPBOT_RPC_PASSWORD is required");

// setup Slack Controller
var controller = Botkit.slackbot({
    logLevel: 6,
    debug: true
    //include "log: false" to disable logging
    //or a "logLevel" integer from 0 to 7 to adjust logging verbosity
});

// open mongoose connection
mongoose.connect(OPTIONS.DB);
var db = mongoose.connection;
db.on("error", function () {
    debug("tipbot:db")("ERROR: unable to connect to database at " + OPTIONS.DB);

});
db.once("open", function () {
    require("./model/tipper"); // load mongoose Tipper model
    debug("tipbot:db")("Database connected");
    // Setup TipBot after mongoose model is loaded
    var TipBot = require("./lib/tipbot");
    tipbot = new TipBot(RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS, WALLET_PASSW);
    // make conennection to Slack
    connect(controller);

});


// connection to slack (function so it can be used to reconnect)
function connect(controller) {
    // spawns the slackbot
    controller.spawn({
        token: SLACK_TOKEN,
        retry: 10
    }).startRTM(function (err, bot, payload) {
        if (err) {
            throw new Error(err);
        }
        // get info where bot is active
        var channels = [],
            groups = [];

        _.each(payload.channels, function (channel) {
            if (channel.is_member) {
                channels.push("#" + channel.name);
            }
        });

        _.each(payload.groups, function (group) {
            if (group.is_open && !group.is_archived) {
                groups.push(group.name);
            }
        });

        debug("tipbot:bot")("Connected to Slack");
        debug("tipbot:bot")("You are <@%s:%s> of %s", payload.self.id, payload.self.name, payload.team.name);
        debug("tipbot:bot")("You are in (channels): %s", channels.join(", "));
        debug("tipbot:bot")("As well as (groups): %s", groups.join(", "));

        // init the tipbot
        setTimeout(function () {  //setTimeout 0 = It"s a useful trick for executing asynchronous code in a single thread.  The coder"s algorithm is non-blocking and asynchronous, but the its execution is blocked into an efficient, linear sequence.
            tipbot.init(bot);
        }, 0);
    });
}

// get ID of a channel
function getChannel(bot, channelName, cb) {
    //   var self = this;
    bot.api.channels.list({}, function (err, channelList) {
        if (err) {
            debug("tipbot:bot")("Error retrieving list of channels " + err);
            cb(err, null);
        }
        var foundChannelIDs = _.filter(channelList.channels, function (find) {
            return find.name.match(channelName, "i");
        });

        if (foundChannelIDs.length === 1) {
            cb(null, foundChannelIDs[0]);
        } else {
            // debug("tipbot:bot")("Didn"t found the " + channelName + ", looking in private groups now.");
            bot.api.groups.list({}, function (err, groupList) {
                if (err) {
                    debug("tipbot:bot")("Error retrieving list of private channels (groups)" + err);
                    cb(err, null);
                }
                var priceGroupID = _.filter(groupList.groups, function (find) {
                    return find.name.match(channelName, "i");
                });
                if (priceGroupID.length === 1) {
                    cb(null, priceGroupID[0]);
                } else {
                    debug("tipbot:bot")("Didn't found the " + channelName + ", in private groups also.");
                }
            });
        }

    });
}

// when bot is connected, show priceTicker
controller.on("hello", function (bot, message) {
    debug("tipbot:bot")("BOT CONNECTED: " + message.type);

    // // find channelID of PRICE_CHANNEL to broadcast price messages
    // getChannel(bot, OPTIONS.PRICE_CHANNEL, function (err, priceChannel) {
    //     if (err) {
    //         debug("tipbot:bot")("No price channel to broadcast.");
    //     } else {
    //         debug("tipbot:bot")("Price channel " + OPTIONS.PRICE_CHANNEL + " = " + priceChannel.id);
    //         // tell all prices on the price list
    //         tipbot.OPTIONS.PRICETICKER_CHANNEL = priceChannel;

    //         // set initial priceTicker boundaries
    //         tipbot.updatePriceTicker();
    //         // update priceTicker at interval
    //      //   if (tipbot.OPTIONS.PRICETICKER_TIMER !== undefined) {
    //             setInterval(function () {
    //                 tipbot.updatePriceTicker();
    //             },
    //                 tipbot.OPTIONS.PRICETICKER_TIMER * 60 * 1000);
    //     //    }
    //     }
    // });


    // find channelID of MODERATOR_CHANNEL to post warn messages
    getChannel(bot, OPTIONS.MODERATOR_CHANNEL, function (err, moderatorChannel) {
        if (err) {
            debug("tipbot:bot")("No Moderator channel to broadcast.");
        } else {
            debug("tipbot:bot")("Moderator channel " + OPTIONS.MODERATOR_CHANNEL + " = " + moderatorChannel.id);
            // set moderator channel for tipbot
            tipbot.OPTIONS.MODERATOR_CHANNEL = moderatorChannel;
        }
    });
});
// response to ticks
controller.on("tick", function (bot) {
    //debug("tipbot:bot")(event);
});
// listen to direct messages to the bot, or when the bot is mentioned in a message
controller.hears(".*", ["direct_message", "direct_mention", "mention"], function (bot, message) {
    var member, channel;
    // get the user that posted the message
    bot.api.users.info({ "user": message.user }, function (err, response) {
        if (err) throw new Error(err);
        member = response.user;

        // find the place where the message was posted
        var firstCharOfChannelID = message.channel.substring(0, 1);
        if (firstCharOfChannelID === "C") {
            // in Public channel
            bot.api.channels.info({ "channel": message.channel }, function (err, response) {
                if (err) throw new Error(err);
                channel = response.channel;
                // let tipbot handle the message
                tipbot.onMessage(channel, member, message.text);
            });
        } else if (firstCharOfChannelID === "G") {
            // in Private channel = Group
            bot.api.groups.info({ "channel": message.channel }, function (err, response) {
                if (err) throw new Error(err);
                channel = response.group;
                // let tipbot handle the message
                tipbot.onMessage(channel, member, message.text);
            });
        } else if (firstCharOfChannelID === "D") {
            // in Direct Message channel =  id -> create channel object
            // let tipbot handle the message
            var DMchannelID = { "id": message.channel };
            tipbot.onMessage(DMchannelID, member, message.text);
        }
    });
});
// when a user change his profile (other username,...)
controller.on("user_change", function (bot, resp) {
    tipbot.onUserChange(bot, resp.user);
});
// when a new user joins the Slack Team to the user.id can be added
controller.on("team_join", function (bot, resp) {
    tipbot.onUserChange(bot, resp.user);
});

// ending connection to Slack
controller.on("close", function (bot, msg) {
    debug("tipbot:bot")("!!! BOTKIT CLOSED DOWN !!!" + msg);
    debug("tipbot:bot")("CLOSE message: " + msg);
    // destroy bot before ending script
    bot.destroy();
    db.close();
    process.exit(1);
});

// botkit had an oopsie
controller.on("error", function (bot, msg) {
    debug("tipbot:bot")("*********** Slack Error!! ***********");
    debug("tipbot:bot")("ERROR code:" + msg.error.code + " = " + msg.error.msg);

    //process.exit(1);
    // don"t quit but reconnect
    connect(controller);
});
