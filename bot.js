var _ = require("lodash");
var debug = require("debug");
var Botkit = require("botkit");
var TipBot = require("./lib/tipbot");
var assert = require("assert");
var parseArgs = require("minimist");

var argv = parseArgs(process.argv.slice(2));

var SLACK_TOKEN = argv["slack-token"] || process.env.TIPBOT_SLACK_TOKEN;
var RPC_USER = argv["rpc-user"] || process.env.TIPBOT_RPC_USER;
var RPC_PASSWORD = argv["rpc-password"] || process.env.TIPBOT_RPC_PASSWORD;
var RPC_PORT = argv["rpc-port"] || process.env.TIPBOT_RPC_PORT || 9998;
var OPTIONS = {
    ALL_BALANCES: true,
    DEMAND: false
};

assert(SLACK_TOKEN, "--slack-token or TIPBOT_SLACK_TOKEN is required");
assert(RPC_USER, "--rpc-user or TIPBOT_RPC_USER is required");
assert(RPC_PASSWORD, "--rpc-password or TIPBOT_RPC_PASSWORD is required");

// setup Slack Controller
var controller = Botkit.slackbot({
    logLevel: 4,
    debug: true
    //include "log: false" to disable logging
    //or a "logLevel" integer from 0 to 7 to adjust logging verbosity
});

// Setup TipBot
var tipbot = new TipBot(RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS);

// spawns the slackbot
controller.spawn({
    token: SLACK_TOKEN
}).startRTM(function (err, bot, payload) {
    if (err) {
        throw new Error(err);
    }

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
    setTimeout(function () {
        tipbot.init(bot);
    }, 0);
});

// when bot is connected
controller.on("hello", function (bot, message) {
    debug("tipbot:bot")("BOT CONNECTED: " + message);
});

// listen to messages
controller.hears(".*", ["direct_message", "direct_mention", "mention"], function (bot, message) {
    // debug messages to seperate channel so we only log them when explicitly enabled
    // debug("tipbot:messages")("MESSAGE", message.type, message.channel, message.user, message.text);
    // if (message.type === "message") {
    var member, channel;

    bot.api.users.info({ "user": message.user }, function (err, response) {
        if (err) throw new Error(err);
        member = response.user;

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
            // in Direct Message channel
            // let tipbot handle the message
            var DMchannelID = { "id": message.channel };
            tipbot.onMessage(DMchannelID, member, message.text);
        }
    });
});

// when a user change his profile (other username,...)
controller.on("user_change", function (bot, user) {
    tipbot.onUserChange(bot, user);
});
// TODO test this
// when a new user joins the Slack Team to the user.id can be added
controller.on("team_join", function (bot, user) {
    tipbot.onUserChange(bot, user);
});


controller.on("close", function (e) {
    debug("tipbot:bot")("Close!!" + e);
    //console.log(e);

    process.exit(1);
});

controller.on("error", function (error) {
    debug("tipbot:bot")("Error!!" + error);
    //console.log(error);

    process.exit(1);
});
