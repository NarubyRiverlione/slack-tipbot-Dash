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

var BLACKLIST_CURRENCIES = ["DASH"];

var TipBot = function (RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS, WALLET_PASS) {
    var self = this;

    self.HighBalanceWarningMark = blocktrail.toSatoshi(2.0);

    self.text = new texts().tipbotTxt;

    self.initializing = false;

    self.slack;
    self.RainUser;

    self.OPTIONS = _.defaults(OPTIONS, {
        TMP_DIR: path.resolve(__dirname, "../tmp"),
        ALL_BALANCES: false,
        DEMAND: false,
        TX_FEE: blocktrail.toSatoshi(0.0001),     // TX fee, used in withdrawing, in satochi

        PRICE_UPDATE_EVERY: 30, // minuts
        RAIN_USERNAME: "dashrain",
        RAIN_SEND_THROTTLE: 1000, // ms wait between raindrops to fall (prevent slack spam protection)
        RAIN_BLACKLISTED_USERS: ["stacktodo"],
        //   PRICETICKER_CHANNEL: null,
        PRICETICKER_TIMER: 15,
        PRICETICKER_BOUNDARY: 0.5 // check boundaries ever x minutes
        // RAIN_TIMER: 15 // random in the next minutes
        // RAIN_THRESHOLD: 5000000 // satoshis
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
        // TODO : doesn't say in public channel       
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
    // return 'rates' with price data as object
    // add manual 'fun' units to rates
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
            // todo: : dollar sign  don't work because $ is also a regular expersion functian
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
        return;
    }

    if (self.users[member.id]) {
        self.users[member.id].updateFromMember(member);
        if (updateRegex) {
            self.updateUserRegex();
        }
    } else {
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
            debug("ERROR cannot open DM channel for '" + userID + " : " + err);
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

    // create all user objects for online users (will be updated via 'user_change' slack event in bot.js )
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

            debug("TipBot ready!");
            debug("I am <@%s:%s> of %s", bot.identity.id, bot.identity.name, bot.team_info.name);
            // debug('We have the following [' + Object.keys(self.users).length + '] known users; ', _.map(self.users, function(user) {
            //     return user.name;
            // }).join(', '));

            // get Rain User
            var findRainUser = _.filter(self.users, function (match) { return match.name.match(self.OPTIONS.RAIN_USERNAME, "i"); });
            if (findRainUser === undefined || findRainUser.length !== 1) {
                debug("ERROR : " + self.text["RainCannotFindRainAccount_1"] + self.OPTIONS.RAIN_USERNAME + self.text["RainCannotFindRainAccount_2"]);
            } else {
                self.RainUser = findRainUser[0];
                debug("Rain user '" + self.OPTIONS.RAIN_USERNAME + "' found : " + self.RainUser.handle);
            }

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
        // no 'all', evaluate the unit
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
    if (this.OPTIONS.DEMAND === true) {
        helpText += this.text["helpTextDemand"];
    }
    helpText += this.text["help_currencies"];
    helpText += this.text["help_price"];
    helpText += this.text["help_pricelist"];
    helpText += this.text["help_convert"];
    if (this.OPTIONS.RAIN_USERNAME !== undefined) {
        helpText += this.text["help_rain"];
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
        // don't know who send the message
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

        /* todo: automatic release of rain via threshold and/or timer
                // check if this time for Rain (rain balance >= rain threshold)
                if (self.OPTIONS.RAIN_THRESHOLD !== undefined && self.RainUser !== undefined) {
                    // only check if rain threshold is set and Rain User is known
                    getRainBalance(self, self.RainUser.id, user, function (err, rainBalance) {
                        if (!err) {
                            if (rainBalance >= self.OPTIONS.RAIN_THRESHOLD) {
                                debug("Rain threshold reached: start timer");
                            }
                        }
                    });
        
        
                }
        */
        // find user ID matches, ignore the sending user
        var userMatches = _.reject(message.match(self.userRegex), function (match) {
            return match == user.id;
        });

        // find real user objects
        userMatches = _.uniq(_.filter(_.map(userMatches, function (match) {
            // if it's an ID
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
        
        //     * ALL BALANCES
        if (message.match(/(all|every(one)?s?) ?balances?/i)) {
            if (!self.OPTIONS.ALL_BALANCES) {
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
            //     reply["text"] = "I don't think you really want me to tell your balance public channel, " + user.handle + " :/";
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
                    debug("ERROR: cannot deposit address.");
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
            // convert amount if currency isn't Dash            
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
                // convert if currency isn't Dash
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
                                debug("ERROR: cannot deposit address.");
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
                                        // todo: add message that was used to send
                                        var recievingUserMessage = {
                                            "channel": DMchannelRecievingUser,
                                            "text": responses["privateToReciever"] +
                                            self.text["SendMessageUsed"] +
                                            "_" + message + "_"
                                        };
                                        self.slack.say(recievingUserMessage);
                                    }
                                });
                            }
                        });
                    }
                });
                return;
            }
        }

        //     * DEMAND
        var matches = message.match(/\b(ask|demand|deserve|receive|send ?me|give ?me|gimme|ow[en]?s? me)\b/i);
        if (matches) {
            debug("REQUEST [" + matches[1] + "]");
            if (!self.OPTIONS.DEMAND) {
                reply["text"] = self.text["RequestingDisabled"];
                self.slack.say(reply);
                return;
            }
            if (userMatches.length == 1) {
                var mentionedUser = userMatches[0];

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

                self.normalizeValue(amount[1], amount[2], user, function (value, rate, originalCurrency, originalValue, valueText) {
                    if (rate === false) {
                        reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                        self.slack.say(reply);
                    } else if (!value) {
                        reply["text"] = user.handle + self.text["InvalidAmount"];
                        self.slack.say(reply);
                    } else {
                        //todo: text string
                        reply["text"] = mentioned.handle + ": " + user.handle + " is requesting " + valueText + " from you ...";
                        self.slack.say(reply);
                        reply["text"] = "Are you OK with that?";
                        self.slack.say(reply);

                        self.triggers.push(new Trigger(
                            self,
                            function (channel, message, _user) {
                                var trigger = this;

                                if (_user.id == mentionedUser.id && message.match(/(OK|yes|fine|sure)/i)) {
                                    mentionedUser.send(channel, user, value);
                                    trigger.destroy();

                                    return true;
                                } else if (_user.id == mentionedUser.id && message.match(/(no)/i)) {
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

        //   * RAIN
        if (message.match(/\brain\b/i)) {
            // all users can check the balance of the Rain Account 
            // get Rain User
            if (self.RainUser === undefined || self.RainUser === null) {
                reply["text"] = self.text["RainCannotFindRainAccount_1"] + self.OPTIONS.RAIN_USERNAME + self.text["RainCannotFindRainAccount_2"];
                self.slack.say(reply);
                return;
            }

            // ADMIN ONLY COMMANDS            
            if (user.is_admin) {
                // get / set threshold of rain accounts
                if (message.match(/\bthreshold\b/i)) {
                    amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
                    if (amount !== null) {
                        // amount found in message, set this as the new threshold
                        self.OPTIONS.RAIN_THRESHOLD = blocktrail.toSatoshi(amount[1]);
                    }
                }

                // get / set random timer  
                if (message.match(/\btimer\b/i)) {
                    amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
                    if (amount !== null) {
                        // amount found in message, set this as the new timer
                        self.OPTIONS.RAIN_TIMER = amount[1] * 60 * 1000; // mil sec
                    }
                }

                // let is rain now, don't wait for the threshold
                if (message.match(/\bnow\b/i)) {
                    rainNow(self, user, channel);
                    return;
                }

                // show raindrop size (available rain / current online users)
                getCurrentRainDropsSize(self, user, function (err, rainDropSize, amountOnlineUsers) {
                    // rainDropSize is in satoshis
                    if (!err) {
                        self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                            if (!err) {
                                var privateReply = { "channel": DMchannelID };
                                if (self.OPTIONS.RAIN_THRESHOLD != undefined) {
                                    // show raindrop size at threshold for current online users
                                    privateReply["text"] = self.text["RainDropSizeWithThreshold"] +
                                        blocktrail.toBTC(self.OPTIONS.RAIN_THRESHOLD) + " dash \n" +
                                        amountOnlineUsers +
                                        self.text["RainPerUser_1"] +
                                        blocktrail.toBTC(self.OPTIONS.RAIN_THRESHOLD / amountOnlineUsers) +
                                        self.text["RainPerUser_2"];
                                    self.slack.say(privateReply);
                                }

                                // show raindrop size for current online users, diregarind the threshold (rain now)
                                privateReply["text"] = self.text["RainPerUserNow"] +
                                    amountOnlineUsers +
                                    self.text["RainPerUser_1"] +
                                    blocktrail.toBTC(rainDropSize) +
                                    self.text["RainPerUser_2"];
                                self.slack.say(privateReply);
                            }
                        });
                    }
                });

            }

            // show balance of Rain Account, available to each user
            var availableRain = 0.0;
            getRainBalance(self, user, function (err, rainBalance) {
                if (err) {
                    reply["text"] = self.text["RainCannotFindRainBalance"] + self.OPTIONS.RAIN_USERNAME;
                    reply["text"] += self.text["RainReqDonation_1"] + self.OPTIONS.RAIN_USERNAME + self.text["RainReqDonation_2"] + "\n";
                    self.slack.say(reply);
                    return;
                } else {
                    availableRain = rainBalance;
                    reply["text"] = self.text["RainAvailibleAmount"] + availableRain + " dash";
                    // inform if rain is imminend (balance >= threshold)
                    if (self.OPTIONS.RAIN_THRESHOLD !== undefined && blocktrail.toSatoshi(availableRain) >= self.OPTIONS.RAIN_THRESHOLD) {
                        reply["text"] += "\n" + self.text["Rainimminent"];
                    }
                    self.slack.say(reply);
                }
            });

            // show treshold
            if (self.OPTIONS.RAIN_THRESHOLD !== undefined) {
                // show the current threshold
                reply["text"] = self.text["RainThreshold"] + blocktrail.toBTC(self.OPTIONS.RAIN_THRESHOLD) + " Dash";

                self.slack.say(reply);
            } else if (user.is_admin) {
                // inform admin that no threshold set yet
                self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                    if (!err) {
                        var privateReply = {
                            "channel": DMchannelID,
                            "text": self.text["RainThresholdNotSet"]
                        };
                        self.slack.say(privateReply);
                    }
                });
            }


            // show timer
            if (self.OPTIONS.RAIN_TIMER !== undefined) {
                // show the current timer
                reply["text"] += self.text["RainTimer"] + self.OPTIONS.RAIN_TIMER / 1000 / 60 + self.text["RainTimerUnit"];
                self.slack.say(reply);
            } else if (user.is_admin) {
                // inform admin that no timer set yet
                self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                    if (!err) {
                        var privateReply = {
                            "channel": DMchannelID,
                            "text": self.text["RainTimerNotSet"]
                        };
                        self.slack.say(privateReply);
                    }
                });
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
        reply["text"] = "Sorry " + user.handle + self.text["Oops"];
        self.slack.say(reply);
        return;
    });
    return;
};

// get list of all current online users
function listOnlineUsers(self, cb) {
    var onlineUsers = {};
    self.slack.api.users.list({ "presence": 1 }, function (err, data) {
        if (err) {
            debug("ERROR RAIN: cannot get list of online users: " + err);
            cb(err, null);
        }

        var allMembers = data.members;
        debug("Count online users: all users = " + Object.keys(allMembers).length);
        var onlineMembers = allMembers.filter(function (allMembers) {
            return allMembers.presence === "active" &&
                allMembers.is_bot === false;
        });
        debug("Count online users: online users = " + Object.keys(onlineMembers).length);
        var filterdOnlineMembers;

        // if an array this blacklisted users exits, filter the out
        if (self.OPTIONS.RAIN_BLACKLISTED_USERS !== undefined) {
            filterdOnlineMembers = onlineMembers.filter(function (onlineMembers) {
                return !_.contains(self.OPTIONS.RAIN_BLACKLISTED_USERS, onlineMembers.name);
            });
        } else {
            filterdOnlineMembers = onlineMembers;
        }
        debug("Count online users: online users after blacklist filter = " + Object.keys(filterdOnlineMembers).length);
        // double check presence via users.getPresence 
        // (use asyn as getPresence doesn't return the id so it can be know to which user the  response belongs if fired all at once)
        async.forEachSeries(filterdOnlineMembers, function (oneUser, asyncCB) {
            //   var oneUser = filterdOnlineMembers[userNumber];
            self.slack.api.users.getPresence({ "user": oneUser.id }, function (err, response) {
                if (err) {
                    debug("ERROR could not retrieve presence of user" + oneUser.name);
                } else if (response.presence === "active") {
                    //  debug(response.presence + ": " + oneUser.name + " = " + oneUser.id);
                    onlineUsers[oneUser.id] = oneUser.name;
                }
                asyncCB();// callback needed to let async know everyhing is done

            });
        },
            // function called when all async tasks are done = cb with array of onlineUsers
            function (err) {
                if (err) {
                    debug("ERROR: during verifying users presence : " + err);
                    cb(err, null);
                }
                debug("Count online users: online users double check = " + Object.keys(onlineUsers).length);
                cb(null, onlineUsers);
            });

    });

}

// get the balance of the Rain Account
function getRainBalance(self, user, cb) {
    if (self.RainUser === undefined || self.RainUser === null) {
        debug("ERROR RAIN: cannot get rain balance as Rain User is unknown !");
        cb("UnknowRainUser", null);
    }
    // get balance of Rain User
    user.getBalance(self.RainUser.id, 6, function (err, rainBalance) {
        if (err) {
            // return error
            cb(err, null);
        } else {
            // return balance
            cb(null, rainBalance);
        }
    });
}

//  amount dash / online user = size of raindrop
// returns raindrop size in satoshis, amountOnlineUsers
function getCurrentRainDropsSize(self, user, cb) {
    listOnlineUsers(self, function (err, onlineUsers) {
        if (err) return;

        var amountOnlineUsers = Object.keys(onlineUsers).length;
        getRainBalance(self, user, function (err, rainBalance) {
            if (err) {
                debug("ERROR RAIN: cannnot calculated size of a raindrop if available rain is unknow !");
                cb("RainDropSizeUnknown", null, null);
            } else {
                cb(null, blocktrail.toSatoshi(rainBalance) / amountOnlineUsers, amountOnlineUsers, onlineUsers);
            }
        });


    });
}

// it Raining Dash !
function rainNow(self, user, channel) {
    if (self.RainUser === undefined || self.RainUser === null) {
        debug("ERROR RAIN: cannot let is rain as Rain User is unknown !");
        return;
    }
    // get raindrop size
    getCurrentRainDropsSize(self, user, function (err, rainDropSize, amountOnlineUsers, onlineUsers) {
        // raindropSize is in satoshis
        var reply = { "channel": channel.id };
        if (err) {
            debug("ERROR RAIN:cannot make it rain as raindrop size is unknown !");
            return;
        }
        if (rainDropSize === 0) {
            // no rain available, don't continue
            reply["text"] = self.text["RainEmpty"];
            self.slack.say(reply);
            debug("RAIN: Raindrop = 0, nothing to give away.");
            return;
        }

        // announce the rain in the public channel
        reply["text"] = self.text["RainClouds"] + "\n";
        reply["text"] += self.text["RainNow"] + blocktrail.toBTC(rainDropSize) + " dash.\n";
        reply["text"] += self.text["RainClouds"] + "\n";
        self.slack.say(reply);

        debug("RAIN: ===== ASYNC start rain =====");
        async.forEachSeries(_.keys(onlineUsers), function (oneUser, asyncCB) {
            // create user object with id & name 
            var getUserWet = self.users[oneUser]; // get user object
            if (getUserWet) { // only continue if user object was found 
                debug("RAIN: Let a raindrop of " + blocktrail.toBTC(rainDropSize) + " dash fall on " + getUserWet.name + " (" + getUserWet.id + ")");
                // wait the time set via Rain Throttle to prevent slack spam protection
                wait(self.OPTIONS.RAIN_SEND_THROTTLE, function () {
                    self.RainUser.send(getUserWet, rainDropSize,
                        function (err) {
                            if (err) { debug(err); }
                            else {
                                // ignore all response to prevent wall of text in public, sender = Rain User = not usefull to inform
                                // custom message to reciever:
                                self.getDirectMessageChannelID(null, getUserWet.id, function (err, DMchannelRecievingUser) {
                                    if (err === null) {
                                        var recievingUserMessage = {
                                            "channel": DMchannelRecievingUser,
                                            "text": self.text["RainRecieved"] + blocktrail.toBTC(rainDropSize)
                                        };
                                        self.slack.say(recievingUserMessage);
                                        debug("RAIN: " + getUserWet.name + "just got wet !");
                                    }
                                });
                            }
                            asyncCB();// callback needed to let async know everyhing is done
                        });
                });
            }
        },
            // function called when all async tasks are done
            function (err) {
                if (err) debug("ERROR RAIN: during async rain: " + err);
                debug("RAIN: ===== ASYNC stop rain =====");
            });
    });
}


module.exports = TipBot;
