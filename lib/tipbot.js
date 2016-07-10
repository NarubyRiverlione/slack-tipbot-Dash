"use strict";
var _ = require("lodash");
var debug = require("debug")("tipbot:tipbot");
var async = require("async");
var request = require("request");
var blocktrail = require("blocktrail-sdk");
var User = require("./user");
var Trigger = require("./trigger");
var bitcoin = require("bitcoinjs-lib");
var path = require("path");
var fs = require("fs");
var dashd = require("bitcoin");
var texts = require("../text/dash.js");
require("waitjs");
var CoinInfo = require("./CoinInfo");
var mongoose = require("mongoose");
var Tipper = mongoose.model("Tipper");

var BLACKLIST_CURRENCIES = ["DASH"];

var TipBot = function (RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS, WALLET_PASS) {
    var self = this;

    self.HighBalanceWarningMark = blocktrail.toSatoshi(2.0);

    self.text = new texts().tipbotTxt;

    self.initializing = false;

    self.slack;
    self.SunUser;

    self.OPTIONS = _.defaults(OPTIONS, {
        TMP_DIR: path.resolve(__dirname, "../tmp"),
        ALL_BALANCES: false,
        TX_FEE: blocktrail.toSatoshi(0.0001),     // TX fee, used in withdrawing, in satochi

        PRICE_UPDATE_EVERY: 30, // minuts
        //   PRICETICKER_CHANNEL: null,
        PRICETICKER_TIMER: 30,  // check sun balance > threshold every X minutes
        PRICETICKER_BOUNDARY: 0.5, // check boundaries ever x minutes

        SUN_USERNAME: "dashsun",
        SUN_SEND_THROTTLE: 1250, // ms wait between sunrays to cast (prevent slack spam protection)
        SUN_BLACKLISTED_USERS: ["stacktodo"],
        SUN_TIMER: 30, // check sun balance > threshold every X minutes
        SUN_THRESHOLD: blocktrail.toSatoshi(0.0005) // satoshis

    });

    // create connection via RPC to wallet
    self.wallet = new dashd.Client({
        host: "localhost",
        port: RPC_PORT,
        user: RPC_USER,
        pass: RPC_PASSWORD,
        timeout: 30000
    });
    self.WALLET_PASS = WALLET_PASS;

    // will be updated with all available currencies when API call is done
    self.CURRENCIES = ["USD", "EUR", "GBP", "CNY", "CAD", "RUB", "HKD", "JPY", "AUD", "btc"];
    self.SUPPORTED_CURRENCIES = ["US Dollar, Euro, British pound", "Chinese yuan ", "Canadian Dollar", "Russian Ruble", "Hong Kong dollar", "Japanese yen", "Australian Dollar", "Bitcoin"];
    // the currencies that will has there price showed every x time
    self.LIST_PRICES = ["USD", "EUR", "GBP", "BTC"];

    self.CURRENCY_REGEX = new RegExp("\\b(Satoshis?|DASH|" + self.CURRENCIES.join("|") + ")\\b", "ig"); // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

    // self.AMOUNT_REGEX = new RegExp("\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+)(?:\\s|$)");
    self.AMOUNT_REGEX = new RegExp("\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+|all)(?:\\s|$)");

    self.users = {};
    self.triggers = [];

    // Setup priceTicker
    self.priceTicker = new CoinInfo("dash");
    self.priceTicker.localCoin = "usd";
    self.priceTicker.buyTitle = "BUY";
    self.priceTicker.sellTitle = "SELL";
    self.priceTicker.supplyTitle = "availible";
    self.priceTicker.TitleBrokenBuyBoundary = "--- Price dropped below the boundary. The new boundary is ";
    self.priceTicker.TitleBrokenSellBoundary = "+++ Price rose above the boundary. The new boundary is ";
    self.priceTicker.priceDigits = 4;
    self.priceTicker.diffDigits = 2;
    self.priceTicker.boundaryDigits = 1;
    self.priceTicker.boundaryAlert = self.OPTIONS.PRICETICKER_BOUNDARY;
    self.priceTicker.continuesOutput = false;   // only when boundary is broken or continues
    // when showing new price info ?
    if (self.priceTicker.continuesOutput) {
        debug("PriceTicker: Show " + self.priceTicker.name + " every " + this.OPTIONS.PRICETICKER_TIMER + " minutes");
    } else {
        debug("PriceTicker: Only show show the priceticker when a boundary is broken" +
            "(" + self.priceTicker.boundaryAlert + self.priceTicker.localCoin + ")");
    }

    // get the fiat prices 
    self.getPriceRates(function (err, rates) {
        self.CURRENCIES = [];

        for (var rate in rates) {
            if (BLACKLIST_CURRENCIES.indexOf(rate) === -1) {
                self.CURRENCIES.push(rate);
            }
        }
        self.CURRENCY_REGEX = new RegExp("\\b(Satoshis?|DASH|" + self.CURRENCIES.join("|") + ")\\b", "ig"); // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

        // self.CURRENCY_REGEX = new RegExp("(Satoshis?|DASH|" + self.CURRENCIES.join("|") + ")", "ig");
    });
};

// show prices of all currencies listed in LIST_PRICES
TipBot.prototype.showPriceList = function (priceChannel, all) {
    var self = this;
    var reply = { "channel": priceChannel };

    // show all currencies of only the short list ?
    var priceList = (all ? self.CURRENCIES : self.LIST_PRICES);

    for (var currency in priceList) {
        debug("Pricelist: show " + priceList[currency] + " in " + priceChannel);
        // TODO : doesn"t say in public channel       
        tellPrice(self, reply, priceList[currency].toLowerCase());
    }
    // show where info is pulled from
    reply["text"] = self.text["PriceInfoFrom"];
    self.slack.say(reply);
};

// tell a price of a currency in a channel
function tellPrice(self, reply, currency) {
    self.getPriceRates(function (err, rates) {
        var rate = rates[currency];

        if (!rate) {
            reply["text"] = self.text["UnsupportedCurrency"];
        } else {
            reply["text"] = self.text["PriceBase"] + rate.toPrecision(4) + " " + currency;
        }
        self.slack.say(reply);
    });
    return;
}

// update priceTicker boundaries, warn in PRICETICKER_CHANNEL if boundary is broken
TipBot.prototype.updatePriceTicker = function () {
    var self = this;
    self.getPriceRates(function (err, rates) {
        var currency = self.priceTicker.localCoin;
        var rate = rates[currency];

        if (!rate) {
            debug("PriceTicker: ERROR " + self.text["UnsupportedCurrency"]);
        } else {
            debug("PriceTicker:  " + self.text["PriceBase"] + rate.toPrecision(4) + " " + currency);
            self.priceTicker.setNewPrices(rate,
                function () {
                    var priceTickerMessage = self.priceTicker.getMessage();
                    debug(priceTickerMessage);
                    // debug("PriceTicker: high boundary: " + self.priceTicker.sellBoundary);
                    // debug("PriceTicker: price now = " + rates[self.priceTicker.localCoin] + " " + self.priceTicker.localCoin);
                    // debug("PriceTicker: low boundary: " + self.priceTicker.buyBoundary);

                    // if priceTicker is know the show there the new boundaries
                    if (self.OPTIONS.PRICETICKER_CHANNEL !== undefined) {
                        self.slack.say({
                            channel: self.OPTIONS.PRICETICKER_CHANNEL.id,
                            text: priceTickerMessage
                        });
                    }
                });
        }
    });
    return;
};

// get new price cache file and remove old then PRICE_UPDATE_EVERY minutes
// return via callback the error(null) and current price information
TipBot.prototype.getPriceRates = function (cb) {
    var self = this;

    var cacheDir = path.resolve(self.OPTIONS.TMP_DIR, "rates");
    var timeBucket = Math.floor((new Date).getTime() / 1000 / 60) * self.OPTIONS.PRICE_UPDATE_EVERY;
    var filename = cacheDir + "/rates.cache." + timeBucket + ".json";

    // fire and forget
    // remove files older then PRICE_UPDATE_EVERY minuts
    self.clearPriceRatesCache(cacheDir, function (err) {
        if (err) {
            debug(err);
        }
    });

    // read current file (not older then PRICE_UPDATE_EVERY minuts) or download a new one
    // return "rates" with price data as object
    // add manual "fun" units to rates
    self._getPriceRates(filename, function (err, rates) {
        if (err) {
            debug(err);
        }
        if (rates !== undefined) {
            // vanity currencies
            rates["ml"] = 1.0 / 1.2;
            rates["mile"] = 1.0 / 16.0;
            rates["oz"] = 1.0 / 36.0;
            rates["tsp"] = 1.0 / 6.0;
            // todo: : dollar sign  don"t work because $ is also a regular expersion functian
            //    if (rates["usd"]) rates["$"] = rates["usd"];
            // euro sign
            if (rates["eur"]) {
                rates["€"] = rates["eur"];
                rates["euro"] = rates["eur"];
            }
            if (rates["usd"]) {
                rates["dollar"] = rates["usd"];
            }

        }
        cb(null, rates);
    });
};

// remove price cache files older then 1 hour
TipBot.prototype.clearPriceRatesCache = function (cacheDir, cb) {
    var self = this;

    fs.readdir(cacheDir, function (err, files) {
        async.forEach(files, function (file, cb) {
            fs.stat(path.join(cacheDir, file), function (err, stat) {
                var endTime, now;
                if (err) {
                    return cb(err);
                }

                now = new Date().getTime();
                // time of file + timeout = endTime that file is usefull
                endTime = new Date(stat.ctime).getTime() + 60 * 1000 * self.OPTIONS.PRICE_UPDATE_EVERY;
                // are we passed the endTime of the file ?
                if (now > endTime) {
                    return fs.unlink(path.join(cacheDir, file), function (err) {
                        if (err) {
                            return cb(err);
                        }

                        cb();
                    });
                } else {
                    return cb();
                }
            });
        }, function (err) {
            cb(err);
        });
    });
};

// read current cached file (not older then PRICE_UPDATE_EVERY minuts) or download a new one from coinmarketcap
// return price info as object via the callback (err, rates)
TipBot.prototype._getPriceRates = function (filename, cb) {
    // var self = this;

    fs.exists(filename, function (exists) {
        if (exists) {
            fs.readFile(filename, "utf8", function (err, data) {
                if (err) {
                    return cb(err);
                }

                cb(null, JSON.parse(data));
            });
        } else {
            request.get("http://coinmarketcap-nexuist.rhcloud.com/api/dash/price", function (err, response, body) {
                fs.writeFile(filename, body, function (err) {
                    if (err) {
                        return cb(err);
                    }

                    cb(null, JSON.parse(body));
                });
            });
        }
    });
};

// add a Slack user to the list of users (key = user.id)
TipBot.prototype.addUser = function (user, updateRegex) {
    var self = this;

    if (typeof updateRegex === "undefined") {
        updateRegex = true;
    }

    self.users[user.id] = user;
    if (updateRegex) {
        self.updateUserRegex();
    }

    // warn admins that new users has arrived, only when not initializing the tipbot
    if (self.OPTIONS.MODERATOR_CHANNEL !== undefined && !self.initializing) {
        var newUserMsg = {
            channel: self.OPTIONS.MODERATOR_CHANNEL.id,
            text: self.text["WarningNewUser_1"]
            + user.name
            + self.text["WarningNewUser_2"]
        };
        self.slack.say(newUserMsg);
    }
};

TipBot.prototype.updateUserFromMember = function (member, updateRegex) {
    var self = this;

    if (typeof updateRegex === "undefined") {
        updateRegex = true;
    }

    if (self.users[member.id] && member.deleted) {
        delete self.users[member.id];
    }

    if (member.deleted || member.is_bot) {
        // warn admins that  users has left, only when not initializing the tipbot
        if (self.OPTIONS.MODERATOR_CHANNEL !== undefined && !self.initializing) {
            var userLeftMsg = {
                channel: self.OPTIONS.MODERATOR_CHANNEL.id,
                text: self.text["WarnUserLeft_1"]
                + member.name
                + self.text["WarnUserLeft_2"]
            };
            self.slack.say(userLeftMsg);
        }
        return;
    }

    if (self.users[member.id]) {
        // existing user = has updated profile or account
        self.users[member.id].updateFromMember(member);
        if (updateRegex) {
            self.updateUserRegex();
        }
    } else {
        // new user
        self.addUser(User.fromMember(self, member), updateRegex);
    }
};

/**
 * create a regex that matches any of the user IDs
 */
TipBot.prototype.updateUserRegex = function () {
    var self = this;

    var ids = _.reject(_.map(self.users, "id"), function (id) {
        return id == self.slack.identity.id;
    });

    self.userRegex = new RegExp("(" + ids.join("|") + ")", "g");
};

// get Direct Message channel ID to talk to an user
TipBot.prototype.getDirectMessageChannelID = function (channel, userID, cb) {
    var self = this;
    // check if already in a DM channel
    if (channel !== null && channel.id !== undefined) {
        var firstCharOfChannelID = channel.id.substring(0, 1);
        if (firstCharOfChannelID === "D") {
            cb(null, channel.id);
            return;
        }
    }
    self.slack.api.im.open({ "user": userID }, function (err, response) {
        if (err) {
            debug("ERROR cannot open DM channel for " + userID + " : " + err);
            return;
        }
        cb(null, response.channel.id);
    });
};

// initializing of TipBot :  get list of current users
TipBot.prototype.init = function (bot) {
    var self = this;
    self.slack = bot;
    // prevent multiple initializations
    if (self.initializing) {
        debug(".init called but still initializing...");
        return;
    }
    self.initializing = true;

    // create all user objects for online users (will be updated via "user_change" slack event in bot.js )
    bot.api.users.list({}, function (err, data) {
        if (err) throw new Error(err);
        // add each user to our list of users
        async.forEachLimit(data.members, 100, function (member, cb) {
            self.updateUserFromMember(member, false);
            cb();
        }, function (err) {
            if (err) {
                debug("ERROR", err);
            }

            self.updateUserRegex();

            // get tipbot user that hold the sun/rain balance
            var findSunUser = _.filter(self.users, function (match) { return match.name.match(self.OPTIONS.SUN_USERNAME, "i"); });
            if (findSunUser === undefined || findSunUser.length !== 1) {
                debug("ERROR : " + self.text["SunCannotFindSunAccount_1"] + self.OPTIONS.SUN_USERNAME
                    + self.text["SunCannotFindSunAccount_2"]);
            } else {
                self.SunUser = findSunUser[0];
                debug("Tipbot user '" + self.OPTIONS.SUN_USERNAME + "' found : " + self.SunUser.handle);
            }

            // Done !
            debug("TipBot ready!");
            debug("I am <@%s:%s> of %s", bot.identity.id, bot.identity.name, bot.team_info.name);
            // debug("We have the following [" + Object.keys(self.users).length + "] known users; ", _.map(self.users, function(user) {
            //     return user.name;
            // }).join(", "));

            self.initializing = false;
        });

    });

};

// convert currency if needed,
// return via callback amount in dash, and if it was needed to convertion rate and originalCurrency
// CB (value, rate, originalCurrency, originalValue, valueText)
TipBot.prototype.normalizeValue = function (inputValue, unit, user, cb) {
    var self = this;
    var currency, value;

    // asked for all = balance
    if (inputValue === "all" & user !== undefined) {
        user.getBalance(user.id, 6, function (err, balance) {
            if (err) {
                debug(err);
                cb(null, null, null, null, "ERROR");
            }
            var value = blocktrail.toSatoshi(balance); // TODO  - tx_Fee ??
            cb(value, null, null, null, blocktrail.toBTC(value) + " DASH");
        });
    } else {
        // no "all", evaluate the unit
        if (unit.match(/satoshis?/i)) {
            currency = "DASH";
            value = parseInt(inputValue);
        } else if (unit.match(/DASH/i)) {
            currency = "DASH";
            value = blocktrail.toSatoshi(inputValue);
        } else {
            currency = unit.trim().toLowerCase();
            if (self.CURRENCIES.indexOf(currency) !== -1) {
                value = parseFloat(inputValue);
            } else {
                value = null; // TODO: should give a proper error
            }
        }

        if (!value) {
            // no valid currency = return without converted amount = amount will be undefined
            return cb();
        }
    }
    if (currency != "DASH") {
        // check if a price update is needed
        self.getPriceRates(function (err, rates) {
            var rate = rates[currency];
            debug("Rate for " + currency + " = " + rate);
            if (!rate) {
                return cb(false, false, currency, value);
            } else {
                var newValue = Math.ceil(value / rate * 1e8);

                var text = value.toFixed(2) + " " + currency + " " +
                    "(" + blocktrail.toBTC(newValue) + " DASH at " + rate.toFixed(2) + " " + currency + " / DASH)";
                // return converted value in dash,  convertion rate, originalCurrency, originalValue, text about the convertion
                return cb(newValue, rate, currency, value, text);
            }
        });
    } else {
        // amount is in Dash, return only value, no convertion rate
        return cb(value, null, null, null, blocktrail.toBTC(value) + " DASH");
    }
};
TipBot.prototype.tellHelp = function () {
    var helpText = this.text["helpText"];
    helpText += this.text["help_balance"];
    helpText += this.text["help_send"];
    helpText += this.text["help_deposit"];
    helpText += this.text["help_withdraw"];
    helpText += this.text["tx_fee"] + blocktrail.toBTC(this.OPTIONS.TX_FEE) + " Dash. \n";
    helpText += this.text["help_currencies"];
    helpText += this.text["help_price"];
    helpText += this.text["help_pricelist"];
    helpText += this.text["help_convert"];
    //TODO Sun help
    if (this.OPTIONS.SUN_USERNAME !== undefined) {
        helpText += this.text["help_sun"];
        helpText += this.text["SunExplain"] + "\n";
    }

    return helpText;
};

TipBot.prototype.onUserChange = function (bot, member) {
    var self = this;
    self.updateUserFromMember(member);
};
// a Slack message was send,
// if the bot name mentioned look for command keywords
TipBot.prototype.onMessage = function (channel, member, message) {
    var self = this;
    var reply = { "channel": channel.id };

    var amount, currency, providedCurrency;

    var user = self.users[member.id];

    if (!user) {
        // don"t know who send the message
        return;
    }

    if (user.id == self.slack.identity.id) {
        // message was from bot (reply to a command)
        return;
    }

    var privateReply = {};
    self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
        privateReply["channel"] = DMchannelID;
        // debug message
        var channelName = channel.Name || channel.id; // channelName = name of id if no name if found (group)
        debug("Message in channel: " + channelName + " from user " + member.name + " : '" + message + "'");

        // find user ID matches, ignore the sending user
        var userMatches = _.reject(message.match(self.userRegex), function (match) {
            return match == user.id;
        });

        // find real user objects
        userMatches = _.uniq(_.filter(_.map(userMatches, function (match) {
            // if it"s an ID
            if (self.users[match]) {
                return self.users[match];
            }

            if (!user) {
                debug("Failed to find user match [" + match + "]");
            }

            return user;
        })));


        // * SPEAK as bot (admin only)
        if (message.match(/\bspeak\b/i)) {
            // admin only command
            if (user.is_admin) {
                // find channel to talk into
                if (message.match(/\binto\b/i)) {
                    self.OPTIONS.talkInChannel = message.replace("speak", "").replace("into", "").trim();
                    return;
                }
                if (self.OPTIONS.talkInChannel != undefined) {
                    //only if channel to speak into is set
                    var say = message.replace("speak", "");
                    //debug(say);

                    self.slack.api.channels.list({}, function (err, channelList) {
                        if (err) {
                            debug("Error retrieving list of channels " + err);
                            return;
                        }
                        var foundChannelIDs = _.filter(channelList.channels, function (find) {
                            return find.name.match(self.OPTIONS.talkInChannel, "i");
                        });

                        if (foundChannelIDs.length === 1) {
                            //channel found, say message
                            self.slack.say({
                                channel: foundChannelIDs[0].id,
                                text: say
                            });
                        } else {
                            debug("ERROR cannot find channel '" + self.OPTIONS.talkInChannel + "'");
                        }
                    });
                }
            }
            return;
        }

        // *  WHISPER (send as admin a DM to a user as bot)
        if (message.match(/\bwhisper\b/i)) {
            if (user.is_admin) {
                // check if recieving user was provided
                if (userMatches.length == 0) {
                    reply["text"] = self.text["Hello"] + user.handle + self.text["NoUserFoundForTip"];
                    self.slack.say(reply);
                    return;
                } else if (userMatches.length == 1) {
                    var whisperTo = userMatches[0];
                    self.getDirectMessageChannelID(null, whisperTo.id, function (err, dmChannel) {
                        if (err) return;
                        var whisperText = message.replace(whisperTo.name, "")
                            .replace("whisper", "")
                            .replace(self.slack.identity.name, "")
                            .replace("<@", "").replace(whisperTo.id, "").replace(">", "");
                        debug("Whisper to " + whisperTo.name + " as bot : '" + whisperText + "'");
                        var whisper = { channel: dmChannel, text: whisperText };
                        self.slack.say(whisper);

                    });
                }
            }
            return;
        }

        //     * ALL BALANCES
        if (message.match(/(all|every(one)?s?) ?balances?/i)) {
            if (self.OPTIONS.ALL_BALANCES === false) {
                reply["text"] = self.text["RetrievingAllBalancesDisabled"];
                self.slack.say(reply);
                return;
            } else if (!user.is_admin) {
                reply["text"] = self.text["RetrievingAllBalancesAdminOnly"];
                self.slack.say(reply);
                return;
            }
            // warn that this can take a while 
            reply["text"] = self.text["RetrievingAllBalancesWait"];
            self.slack.say(reply);

            async.mapLimit(Object.keys(self.users), 3, function (userID, cb) {
                var user = self.users[userID];

                user.getBalanceLine(cb);
            }, function (err, result) {
                if (err) {
                    debug("ERROR", err);
                    return;
                }

                reply["text"] = result.join("\n");
                // reply in Direct Message
                self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                    if (err === null) {
                        reply["channel"] = DMchannelID;
                        self.slack.say(reply);
                    }
                });

            });

            return;
        }

        //     * BALANCE
        if (message.match(/\bbalance\b/i)) {
            // if (channel.is_open) {
            //     reply["text"] = "I don"t think you really want me to tell your balance public channel, " + user.handle + " :/";
            //     // self.slack.say(reply);
            // }
            user.getBalanceLine(function (err, line) {
                if (err) {
                    debug("ERROR: cannot tell ballance.");
                } else {
                    privateReply["text"] = line;
                    self.slack.say(privateReply);
                }
            });

            return;
        }

        //     * DEPOSIT
        if (message.match(/\bdeposit\b/i)) {
            user.tellDepositeAddress(function (err, line) {
                if (err) {
                    debug("ERROR: cannot find a deposit address for '" + user.name + "(" + user.id + ") : " + err);
                } else {
                    privateReply["text"] = line;
                    self.slack.say(privateReply);
                }
            });

            return;
        }

        //     * WITHDRAW
        if (message.match(/\bwithdraw\b/i)) {
            amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
            if (amount === null) {
                reply["text"] = user.name + self.text["NoAmountFound"];
                self.slack.say(reply);
                return;
            }
            // check if currency was provide
            providedCurrency = message.match(self.CURRENCY_REGEX);
            if (providedCurrency !== null && providedCurrency[0].length !== 0) {
                //  set provided currency
                amount[2] = message.match(self.CURRENCY_REGEX)[0];
            } else {
                //not provided, set dash as default currency
                amount[2] = "DASH";
            }
            debug(amount);
            //TODO check if set to live address [X]            
            var address = message.match(/[X][a-zA-Z0-9]{25,36}/g);

            if (address) {
                address = _.uniq(_.filter(address, function (address) {
                    try {
                        return bitcoin.Address.fromBase58Check(address);
                    } catch (e) {
                        return false;
                    }
                }));

                if (!address.length) {
                    reply["text"] = "Sorry " + user.handle + self.text["NoValidAddress"];
                    self.slack.say(reply);
                    return;
                } else if (address.length > 1) {
                    reply["text"] = "Sorry " + user.handle + self.text["MoreThen1Address"] + " [" + address.join(", ") + "]";
                    self.slack.say(reply);
                    return;
                }

            } else {
                // no address
                reply["text"] = "Sorry " + user.handle + self.text["NoAddress"];
                self.slack.say(reply);
                return;
            }
            // no amount
            if (!amount) {
                reply["text"] = "Sorry " + user.handle + self.text["NoAmountOrCurrency"];
                self.slack.say(reply);
                return;
            }
            // convert amount if currency isn"t Dash            
            self.normalizeValue(amount[1], amount[2], user, function (value, rate, originalCurrency, originalValue, valueText) {
                if (rate === false) {
                    reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                    self.slack.say(reply);
                } else if (!value) {
                    reply["text"] = user.handle + self.text["InvalidAmount"];
                    self.slack.say(reply);
                } else {
                    privateReply["text"] = "You want to withdraw " + valueText + " to " + address + "." +
                        "\nAre you Ok with that?";
                    self.slack.say(privateReply);

                    self.triggers.push(new Trigger(
                        self,
                        function (channel, message, _user) {
                            var trigger = this;
                            // debug("trigger fired at channel: " + channel.id + " =? " + DMchannelID);
                            // debug("trigger fired for user:   " + user.id + " =? " + _user.id);
                            // debug("trigger fired message:    " + message);

                            if (channel.id === privateReply.channel && _user.id == user.id && message.match(/(OK|yes|fine|sure)/i)) {
                                user.withdraw(value, address[0], self.WALLET_PASS, function (err, response) {
                                    if (err) {
                                        debug("ERROR: cannot withdraw because: " + err);
                                        privateReply["text"] = err;
                                    } else {
                                        privateReply["text"] = response;
                                    }
                                    self.slack.say(privateReply);
                                });
                                trigger.destroy();
                                return true;
                            } else if (channel === privateReply.channel && _user.id == user.id && message.match(/(no)/i)) {
                                trigger.destroy();
                                return true;
                            }
                            return false;
                        },
                        {
                            timeout: 600000 // 10min
                        }
                    ));
                }
            });
            return;
        }

        //     * SEND / TIP
        if (message.match(/\b(send|give|sent|tip)\b/i)) {
            // check if recieving user was provided
            if (userMatches.length == 0) {
                reply["text"] = self.text["Hello"] + user.handle + self.text["NoUserFoundForTip"];
                self.slack.say(reply);
                return;
            } else if (userMatches.length == 1) {
                var mentioned = userMatches[0];

                // get only the number, no currency
                amount = message.match(self.AMOUNT_REGEX);
                if (amount === null) {
                    reply["text"] = user.name + self.text["NoAmountFound"];
                    self.slack.say(reply);
                    return;
                }

                // check if currency was provide
                providedCurrency = message.match(self.CURRENCY_REGEX);
                if (providedCurrency !== null && providedCurrency[0].length !== 0) {
                    //  set provided currency
                    amount[2] = message.match(self.CURRENCY_REGEX)[0];
                } else {
                    //not provided, set dash as default currency
                    amount[2] = "DASH";
                }
                // convert if currency isn"t Dash
                self.normalizeValue(amount[1], amount[2], user, function (value, rate) {
                    if (rate === false) {
                        reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                        self.slack.say(reply);
                    } else if (!value) {
                        reply["text"] = user.handle + self.text["InvalidAmount"];
                        self.slack.say(reply);
                    } else {
                        // send amount (move between accounts in wallet)
                        user.send(mentioned, value, function (err, responses) {
                            if (err) {
                                debug("ERROR: cannot " + value + " to " + mentioned.name + "(" + mentioned.id + ") : " + err);
                            } else {
                                // response in public channel:  announce tip
                                reply["text"] = responses["public"];
                                self.slack.say(reply);
                                // response to sender: send thanks and new ballance
                                privateReply["text"] = responses["privateToSender"];
                                self.slack.say(privateReply);
                                // response to reciever:  inform of the tip
                                self.getDirectMessageChannelID(null, mentioned.id, function (err, DMchannelRecievingUser) {
                                    if (err === null) {
                                        var recievingUserMessage = {
                                            "channel": DMchannelRecievingUser,
                                            "text": responses["privateToReciever"] +
                                            self.text["SendMessageUsed"] +
                                            "_" + message + "_"
                                        };
                                        self.slack.say(recievingUserMessage);
                                    }
                                });
                                // save tip to database for Sun feature
                                incTipCountInDb(user);
                            }
                        });
                    }
                });
                return;
            }
        }

        /*
         * TMP TRIGGERS
         */
        var triggers = self.triggers.slice();
        if (_.any(triggers, function (trigger) {
            return trigger.match(channel, message, user, userMatches);
        })) {

            return;
        }


        //     * MENTIONS MULTIPLE USER
        if (userMatches.length > 1) {
            reply["text"] = "Sorry " + user.handle + self.text["ToMuchUsers"];
            self.slack.say(reply);
            return;
        }

        //     * CONVERT
        if (message.match(/\b(convert|rate|to)\b/i)) {
            var currencies = message.match(self.CURRENCY_REGEX);
            if (currencies === null || currencies.length < 2) {
                reply["text"] = user.handle + self.text["NotEnoughCurrencies"];
                self.slack.say(reply);
                return;
            }
            if (currencies.length > 2) {
                reply["text"] = user.handle + self.text["ToMuchCurrencies"];
                self.slack.say(reply);
                return;
            }

            amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
            if (amount === null) {
                reply["text"] = user.name + self.text["NoAmountFound"];
                self.slack.say(reply);
                return;
            } else if (amount) {
                var fromCurrency = currencies[0].toLowerCase();
                var toCurrency = currencies[1].toLowerCase();
                if (fromCurrency === "dash") {
                    // Dash -> other
                    self.normalizeValue(amount[1], toCurrency, user, function (value, rate) {
                        if (rate === false) {
                            reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                        } else if (!value) {
                            reply["text"] = user.handle + self.text["InvalidAmount"];
                        } else {
                            var newValue = rate * amount[1];
                            reply["text"] = amount[1] + " " + fromCurrency + " = " + newValue.toPrecision(4) + "  " + toCurrency
                                + " ( 1.0 Dash = " + rate.toPrecision(4) + " " + toCurrency + " )";
                        }
                        self.slack.say(reply);
                    });
                } else if (toCurrency === "dash") {
                    // other -> dash
                    self.normalizeValue(amount[1], fromCurrency, user, function (value, rate) {
                        if (rate === false) {
                            reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                        } else if (!value) {
                            reply["text"] = user.handle + self.text["InvalidAmount"];
                        } else {
                            reply["text"] = amount[1] + " " + fromCurrency + " = " + blocktrail.toBTC(value) + "  " + toCurrency
                                + " ( 1.0 " + fromCurrency + " = " + (1.0 / rate).toPrecision(4) + " DASH)";
                        }
                        self.slack.say(reply);
                    });
                }
            }

            return;
        }

        //     * PRICE
        if (message.match(/\bprice\b/i)) {
            currency = message.match(self.CURRENCY_REGEX);

            if (currency) {
                currency = currency[0].toLowerCase();

                tellPrice(self, reply, currency);
                // tell where price is pulled from
                reply["text"] = self.text["PriceInfoFrom"];
                self.slack.say(reply);
                return;
            } else {
                // no currency provided, show short list in channel where command was issued 
                self.showPriceList(channel.id, false);
                return;
            }

        }

        //     * PRICE TICKER
        if (message.match(/\bpriceticker\b/i)) {
            var tellChannel = self.OPTIONS.PRICETICKER_CHANNEL;
            // start the priceticker
            if (self.OPTIONS.PRICETICKER_CHANNEL === undefined) {
                reply["text"] = "ERROR don't know in which channel I need to post the priceticker";
                self.slack.say(reply);
                return;
            }

            if (message.match(/\brepeat\b/i)) {
                reply["text"] = "I will tell the prices every " + self.OPTIONS.PRICETICKER_TIMER + " minutes";
                self.slack.say(reply);

                repeat(self.OPTIONS.PRICETICKER_TIMER * 1000 * 60,
                    function () {
                        self.showPriceList(tellChannel.id, false);
                    },
                    "priceticker",
                    true);
                return;
            }
            // stop the priceticker
            if (message.match(/\bstop\b/i)) {
                clear("priceticker");
                reply["text"] = "Stopped showing the priceticker, cya.";
                self.slack.say(reply);
                return;
            }
            // show the pricticker manual
            if (message.match(/\bshort\b/i)) {
                // short list
                self.showPriceList(tellChannel.id, false);
            } else {
                // show all currencies
                self.showPriceList(tellChannel.id, true);
            }
            return;
        }

        //     * LIST CURRENCIES
        if (message.match(/\bcurrencies\b/i)) {
            reply["text"] = self.text["CurrenciesTitle"] +
                self.text["SupportedCurrenciesFull"] + self.SUPPORTED_CURRENCIES.join(", ") + "\n" +
                self.text["SupportedSymbols"] + self.CURRENCIES.join(", ") + "* \n" +
                self.text["SupportedBase"];
            self.slack.say(reply);
            return;
        }

        //    * HELP
        if (message.match(/\bhelp\b/i)) {
            self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                if (err === null) {
                    reply["channel"] = DMchannelID;
                    reply["text"] = self.tellHelp();
                    self.slack.say(reply);
                }
            });
            return;
        }

        //   * RAIN (replaced by SUN)
        if (message.match(/\brain\b/i)) {
            reply["text"] = self.text["RainReplacedBySun"];
            self.slack.say(reply);
            return;
        }

        //     // ADMIN ONLY COMMANDS            
        //     if (user.is_admin) 
        //     amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
        //     if (amount !== null) {
        //         // amount found in message, set this as the new threshold
        //         self.OPTIONS.RAIN_THRESHOLD = blocktrail.toSatoshi(amount[1]);
        //     }
        // }



        // // let is rain now, don"t wait for the threshold
        // if (message.match(/\bnow\b/i)) {
        //     self.rainNow(channel);
        //     return;
        // }

        // // show raindrop size (available rain / current online users)
        // getCurrentRainDropsSize(self, function (err, rainDropSize, amountOnlineUsers) {
        //     // rainDropSize is in satoshis
        //     if (!err) {
        //         self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
        //             if (!err) {
        //                 var privateReply = { "channel": DMchannelID };
        //                 if (self.OPTIONS.RAIN_THRESHOLD != undefined) {
        //                     // show raindrop size at threshold for current online users
        //                     privateReply["text"] = self.text["RainDropSizeWithThreshold"] +
        //                         blocktrail.toBTC(self.OPTIONS.RAIN_THRESHOLD) + " dash \n" +
        //                         amountOnlineUsers +
        //                         self.text["RainPerUser_1"] +
        //                         blocktrail.toBTC(self.OPTIONS.RAIN_THRESHOLD / amountOnlineUsers) +
        //                         self.text["RainPerUser_2"];
        //                     self.slack.say(privateReply);
        //                 }

        //                 // show raindrop size for current online users, diregarind the threshold (rain now)
        //                 privateReply["text"] = self.text["RainPerUserNow"] +
        //                     amountOnlineUsers +
        //                     self.text["RainPerUser_1"] +
        //                     blocktrail.toBTC(rainDropSize) +
        //                     self.text["RainPerUser_2"];
        //                 self.slack.say(privateReply);
        //             }
        //         });
        //     }
        // });


        //   * SUN (reward to users that have tipped others)
        if (message.match(/\bsun\b/i)) {

            // all users can check the balance of the Sun Account 
            // get Sun User for OPTIONS
            if (self.SunUser === undefined || self.SunUser === null) {
                reply["text"] = self.text["SunCannotFindSunAccount_1"] + self.OPTIONS.SUN_USERNAME + self.text["SunCannotFindSunAccount_2"];
                reply["text"] += self.text["SunExplain"];
                self.slack.say(reply);
                return;
            }
            // show balance of Sun Account, available to non-admin user
            getSunBalance(self, function (err, sunBalance) {
                if (err) {
                    reply["text"] = self.text["SunCannotFindSunBalance"] + self.OPTIONS.SUN_USERNAME;
                    self.slack.say(reply);
                    return;
                } else {
                    if (sunBalance !== undefined && sunBalance > 2e-8) {
                        reply["text"] = self.text["SunAvailibleAmount"] + sunBalance + " dash";
                    } else {
                        reply["text"] = self.text["SunEmpty"];
                    }
                    reply["text"] += "\n" + self.text["SunReqDonation_1"] + self.OPTIONS.SUN_USERNAME + "_";
                    reply["text"] += "\n" + self.text["SunReqDonation_2"] + self.OPTIONS.SUN_USERNAME + self.text["SunReqDonation_3"];
                    // show explication of Sun
                    reply["text"] += "\n\n" + self.text["SunExplain"];
                    // show amount of eligible users
                    Tipper.count(function (err, count) {
                        if (err) debug(err);
                        reply["text"] += "\n" + count + self.text["SunAmountEligibleUsers"];
                        self.slack.say(reply);
                    });
                }
            });

            // ADMIN ONLY COMMANDS            
            if (user.is_admin) {
                // show Eligible users (ahs tip before)
                if (message.match(/\beligible\b/i)) {
                    getListOfSunEligibleUsers(function (err, allTippers) {
                        if (err) {
                            debug(self.text["ERRORreadingDb"] + err);
                            self.privateReply["text"] = self.text["ERRORreadingDb" + err];
                            self.slack.say(privateReply);
                        }
                        // show list all tippers
                        privateReply["text"] = self.text["SunEligibleUsersList"];
                        allTippers.forEach(function (tipper) {
                            privateReply["text"] += tipper.name + "(" + tipper.id + ") has tipped " + tipper.tipCount + " times.\n";
                        });
                        //  debug(reply["text"]);
                        self.slack.say(privateReply);
                    });
                }
                // reset tip counts (remove all records)
                if (message.match(/\breset\b/i)) {
                    //TODO refactor in seperate function ?
                    Tipper.remove(function (err) {
                        if (err) {
                            debug("ERROR database: removing all reccords");
                            debug(err);
                            privateReply["text"] = self.text["SunErrorResettingCounter"];
                            self.slack.say(privateReply);
                            return;
                        }
                        privateReply["text"] = self.text["SunCountIsReset"];
                        self.slack.say(privateReply);
                        debug(privateReply["text"] + " by " + user.name); // log who reset counters
                    });
                }

                // // timer (sun will be cast random before the set time)
                // if (message.match(/\btimer\b/i)) {
                //     // set new max time
                //     amount = message.match(self.AMOUNT_REGEX); // only the number
                //     if (amount !== null) {
                //         // amount found in message, set this as the new timer
                //         self.OPTIONS.SUN_TIMER = amount[1] * 60; //  secondes
                //     }
                //     // show set max time
                //     if (self.OPTIONS.SUN_TIMER !== undefined) {
                //         // show the current set timer
                //         reply["text"] = self.text["SunTimer"] + self.OPTIONS.SUN_TIMER / 60 + self.text["SunTimerUnit"];
                //         self.slack.say(reply);
                //     } else {
                //         // inform admin that no timer set yet
                //         privateReply["text"] = self.text["SunTimerNotSet"];
                //         self.slack.say(privateReply);
                //     }

                // }

                // threshold (sun will be cast if amount of sun balance > threshold)
                if (message.match(/\bthreshold\b/i)) {
                    // set new threshold
                    amount = message.match(self.AMOUNT_REGEX); // only the number
                    if (amount !== null) {
                        // amount found in message, set this as the new threshold
                        self.OPTIONS.SUN_THRESHOLD = amount[1];
                    }
                    //show threshold
                    if (self.OPTIONS.SUN_THRESHOLD !== undefined) {
                        reply["text"] = self.text["SunThreshold_1"] + blocktrail.toBTC(self.OPTIONS.SUN_THRESHOLD) + " Dash";
                        reply["text"] += self.text["SunThreshold_2"];
                        self.slack.say(reply);
                    } else {
                        // inform admin that no threshold set yet
                        privateReply["text"] = self.text["SunThresholdNotSet"];
                        self.slack.say(privateReply);
                    }

                }
            }
            return;
        }


        //   * WARN (moderator)
        if (message.match(/\bwarn\b/i)) {
            // admin only command
            if (user.is_admin) {
                // check if recieving user was provided
                if (userMatches.length == 0) {
                    privateReply["text"] = self.text["Hello"] + user.handle + self.text["NoUserFoundWarn"];
                    self.slack.say(privateReply);
                    return;
                } else if (userMatches.length == 1) {
                    var warnUser = userMatches[0];
                    // open Direct Message channel to user to be warned
                    self.getDirectMessageChannelID(null, warnUser.id, function (err, DMchannelID) {
                        if (err) {
                            privateReply["text"] = self.text["WarnNoPrivateChannel"] + warnUser.name + "\n" + err;
                            self.slack.say(privateReply);
                            return;
                        }
                        // send DM 
                        var warnMessage = {
                            channel: DMchannelID,
                            text: self.text["Hello"] + warnUser.name + self.text["WarnText"]
                        };
                        self.slack.say(warnMessage);

                        // inform other admins via moderator channel that a warning was issued
                        if (self.OPTIONS.MODERATOR_CHANNEL !== undefined) {
                            var informText = {
                                channel: self.OPTIONS.MODERATOR_CHANNEL.id,
                                text: self.text["InformOtherAdmins1"] + warnUser.name + self.text["InformOtherAdmins2"]
                            };
                            self.slack.say(informText);
                        }
                    });
                }
            }
            return;
        }


        //   * OOPS
        var amountOfPossibleResponds = self.text["NoCommandFound"].length;
        var randomRespons = Math.floor((Math.random() * amountOfPossibleResponds) + 1);
        reply["text"] = self.text["NoCommandFound"][randomRespons];
        reply["text"] += "\n" + self.text["Oops"];
        self.slack.say(reply);
        return;
    });

    return;
};

// it sunshine Dash !
TipBot.prototype.sunNow = function (channel) {
    var self = this;
    if (self.SunUser === undefined || self.SunUser === null) {
        debug("ERROR sun: cannot let is sun as sun User is unknown !");
        return;
    }

    // * get balance of Sun Account
    getSunBalance(self, function (err, sunBalance) {
        if (err) {
            reply["text"] = self.text["SunCannotFindSunBalance"] + self.OPTIONS.SUN_USERNAME;
            self.slack.say(reply);
            return;
        }
        if (sunBalance !== undefined) {
            // TODO  main channel 
            channel = {id:"123"};

            var reply = { "channel": channel.id };
            if (err) {
                debug("ERROR sun:cannot make the sun shining as sunray size is unknown !");
                return;
            }
            if (sunBalance <= 2e-80) {
                // no sun available, don"t continue
                reply["text"] = self.text["sunEmpty"];
                self.slack.say(reply);
                debug("sun: sun balance = 0, nothing to give away.");
                return;
            }

            // get sunray size
            getSunRaySize(sunBalance, function (err, sunraySize) {
                if (err) return;

                // announce the sun in the public channel
                reply["text"] = self.text["SunRay"] + "\n";
                reply["text"] += self.text["SunExplain"] + "\n";
                // reply["text"] += self.text["SunExplain"] + '\n'
                //  + blocktrail.toBTC(sunraySize) + " dash.\n";
                reply["text"] += self.text["SunRay"] + "\n";

//TODO uncomment if main channel in knwo                
               // self.slack.say(reply);

                //get list of users that have tipped
                getListOfSunEligibleUsers(function (err, usersList) {
                    if (err) return;
                    debug("sun: ===== ASYNC start sun =====");

                    async.forEachSeries(usersList,
                        function (oneUser, asyncCB) {
                            debug("sun: Cast a sunray of " + blocktrail.toBTC(sunraySize) + " dash on " + oneUser.name + " (" + oneUser.id + ")");
                            // wait the time set via sun Throttle to prevent slack spam protection
                            wait(self.OPTIONS.SUN_SEND_THROTTLE, function () {
                                // self.sunUser.send(oneUser, sunraySize, function (err) {
                                //     if (err) { debug(err); }
                                //     else {
                                //         // ignore all response to prevent wall of text in public, sender = sun User = not usefull to inform
                                //         // custom message to reciever:
                                //         self.getDirectMessageChannelID(null, oneUser.id, function (err, DMchannelRecievingUser) {
                                //             if (err === null) {
                                //                 var recievingUserMessage = {
                                //                     "channel": DMchannelRecievingUser,
                                //                     "text": self.text["sunRecieved"] + blocktrail.toBTC(sunraySize)
                                //                 };
                                //                 self.slack.say(recievingUserMessage);
                                //                 debug("sun: " + oneUser.name + "just rerieved a sunray !");
                                //             }
                                //         });
                                //     }
                                debug("sun: " + oneUser.name + "just recieved a sunray !");
                                asyncCB();// callback needed to let async know everyhing is done
                                //     });
                            });
                        },
                        // function called when all async tasks are done
                        function (err) {
                            if (err) debug("ERROR sun: during async sun: " + err);
                            debug("sun: ===== ASYNC stop sun =====");
                        });
                });
            });
        }
    });
};


// check sun balance and trigger a sunshine when higher then the threshold
TipBot.prototype.sunCheckThreshold = function () {
    var self=this;
    if (self.OPTIONS.SUN_THRESHOLD !== undefined) {
        getSunBalance(self, function (err, sunBalance) {
            if (blocktrail.toSatoshi(sunBalance) >= self.OPTIONS.SUN_THRESHOLD) {
                debug("SUN: balance " + sunBalance + " > threshold " + self.OPTIONS.SUN_THRESHOLD + " : cast sun now !!");
                //TODO get the main channel to annouce the sunshine 
                self.sunNow();
            }
        });
    }
};

// get the balance of the Sun Account
function getSunBalance(self, cb) {
    if (self.SunUser === undefined || self.SunUser === null) {
        debug("ERROR Sun: " + self.text["SunCannotFindSunAccount_1"]);
        cb("UnknowSunUser", null);
    }
    // get balance of Sun User
    self.SunUser.getBalance(self.SunUser.id, 6, function (err, sunBalance) {
        if (err) cb(err, null);
        // return balance
        cb(null, sunBalance);
    });
}

// get size of sunray in  SATHOSHI = sun balance / eligible users
function getSunRaySize(sunBalance, cb) {
    //  * get amount of eligible users
    Tipper.count(function (err, amountOfTippers) {
        if (err) {
            debug("ERROR Sun, cannot cast sunray as amount of eligible users in unknow.");
            cb(err, null);
        }
        var sunraySize = blocktrail.toSatoshi(sunBalance) / amountOfTippers;
        debug("SUN: " + amountOfTippers + " will recieve " + blocktrail.toBTC(sunraySize));
        cb(null, sunraySize);
    });
}

// get list of all users that have tipped before
function getListOfSunEligibleUsers(cb) {
    Tipper.find(function (err, allTippers) {
        if (err) cb(err, null);
        cb(null, allTippers);
    });
}

// //  amount dash / online user = size of raindrop
// // returns raindrop size in satoshis, amountOnlineUsers
// function getCurrentRainDropsSize(self, cb) {
//     listOnlineUsers(self, function (err, onlineUsers) {
//         sun

//         var amountOnlineUsers = Object.keys(onlineUsers).length;
//         getRainBalance(self, function (err, rainBalance) {
//             if (err) {
//                 debug("ERROR RAIN: cannnot calculated size of a raindrop if available rain is unknow !");
//                 cb("RainDropSizeUnknown", null, null, null);
//             } else {
//                 cb(null, blocktrail.toSatoshi(rainBalance) / amountOnlineUsers, amountOnlineUsers, onlineUsers);
//             }
//         });


//     });
// }



// increment tip count in database for user
function incTipCountInDb(user, cb) {
    // check if Tipper already exists in Db
    if (!user) {
        debug("ERROR saving tip to db: no user");
    } else {

        Tipper.findOneAndUpdate(
            { // filter
                id: user.id
            },
            { // update/insert fields
                $set: { name: user.name, id: user.id },
                $inc: { tipCount: 1 },
                $currentDate: { lastTipDate: true }
            },
            { // insert new, update existing
                upsert: true
            },
            // callback
            function (data) {
                debug("Tip count for " + user.name + " incremented in database");
                if (cb) cb(data);
            }
        );
    }
}

module.exports = TipBot;
