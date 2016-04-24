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

// No use for it as where using internal moves
// MIN_TIP equal to BASE_FEE 
// var MIN_TIP = blocktrail.toSatoshi(0.0001);

var BLACKLIST_CURRENCIES = ["DASH"];

var TipBot = function (RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS) {
    var self = this;

    self.text = new texts().tipbotTxt;

    self.initializing = false;
    self.slack;
    self.OPTIONS = _.defaults(OPTIONS, {
        TMP_DIR: path.resolve(__dirname, "../tmp"),
        ALL_BALANCES: false,
        DEMAND: false
    });
    // create connection via RPC to wallet
    self.wallet = new dashd.Client({
        host: "localhost",
        port: RPC_PORT,
        user: RPC_USER,
        pass: RPC_PASSWORD,
        timeout: 30000
    });

    // will be updated with all available currencies when API call is done
    self.CURRENCIES = ["USD", "EUR", "GBP", "CNY", "CAD", "RUB", "HKD", "JPY", "AUD", "btc"];
    self.SUPPORTED_CURRENCIES = ["US Dollar, Euro, British pound", "Chinese yuan ", "Canadian Dollar", "Russian Ruble", "Hong Kong dollar", "Japanese yen", "Australian Dollar", "Bitcoin"];
    self.CURRENCY_REGEX = new RegExp("(Satoshis?|DASH|" + self.CURRENCIES.join("|") + ")", "ig");
    self.AMOUNT_REGEX = new RegExp("(\\d*\\.\\d*)", "i");
    // decimal not mandatory: (\d+\.\d+)|(\.\d+)|(\d+\.)|(\d+)

    self.getPriceRates(function (err, rates) {
        self.CURRENCIES = [];

        for (var rate in rates) {
            if (BLACKLIST_CURRENCIES.indexOf(rate) === -1) {
                self.CURRENCIES.push(rate);
            }
        }

        self.CURRENCY_REGEX = new RegExp("(Satoshis?|DASH|" + self.CURRENCIES.join("|") + ")", "ig");
    });

    self.users = {};
    self.triggers = [];
};

// get new price cache file and remove old then 1 hour
// return via callback the error(null) and current price information
TipBot.prototype.getPriceRates = function (cb) {
    var self = this;

    var cacheDir = path.resolve(self.OPTIONS.TMP_DIR, "rates");
    var timeBucket = Math.floor((new Date).getTime() / 1000 / 60) * 60;
    var filename = cacheDir + "/rates.cache." + timeBucket + ".json";

    // fire and forget
    // remove files older then 1 hour
    self.clearPriceRatesCache(cacheDir, function (err) {
        if (err) {
            debug(err);
        }
    });

    // read current file (not older then 1 hour) or download a new one
    // return 'rates' with price data as object
    // add manual 'fun' units to rates
    self._getPriceRates(filename, function (err, rates) {
        if (err) {
            debug(err);
        }
        // vanity currencies
        if (rates !== undefined) {
            rates["ml"] = 1.0 / 1.2;
            rates["mile"] = 1.0 / 16.0;
            rates["oz"] = 1.0 / 36.0;
            rates["tsp"] = 1.0 / 6.0;
            // dollar sign TODO don't work because $ is also a regular expersion functian
            //    if (rates["usd"]) rates["$"] = rates["usd"];
            // euro sign
            if (rates["eur"]) rates["€"] = rates["eur"];
        }

        cb(null, rates);
    });
};

// remove price cache files older then 1 hour
TipBot.prototype.clearPriceRatesCache = function (cacheDir, cb) {
    //var self = this;

    fs.readdir(cacheDir, function (err, files) {
        async.forEach(files, function (file, cb) {
            fs.stat(path.join(cacheDir, file), function (err, stat) {
                var endTime, now;
                if (err) {
                    return cb(err);
                }

                now = new Date().getTime();
                endTime = new Date(stat.ctime).getTime() + 3600 * 1000;
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

// read current cached file (not older then 1 hour) or download a new one from coinmarketcap
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
    if (self.initializing) {
        debug(".init called but still initializing...");
        return;
    }

    self.initializing = true;

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

            self.initializing = false;
        });

    });
};

// convert currency if needed,
// return via callback amount in dash, and if it was needed to convertion rate and originalCurrency
TipBot.prototype.normalizeValue = function (inputValue, unit, cb) {
    var self = this;
    var currency, value;

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

    if (currency != "DASH") {
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

    if (this.OPTIONS.DEMAND === true) {
        helpText += this.text["helpTextDemand"];
    }

    helpText += this.text["helpTextCurrencies"];
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

    // debug message
    debug(channel.name, member.name, message, channel.is_open, channel.is_group);

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
    if (message.match(/balance/i)) {
        // if (channel.is_open) {
        //     reply["text"] = "I don't think you really want me to tell your balance public channel, " + user.handle + " :/";
        //     // self.slack.say(reply);
        // }
        self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
            if (err === null) user.tellBalance(DMchannelID);
        });

        return;
    }

    //     * DEPOSIT
    if (message.match(/deposit/i)) {
        self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
            if (err === null) user.tellDepositeAddress(DMchannelID);
        });

        return;
    }

    //     * WITHDRAW
    if (message.match(/withdraw/i)) {
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
        self.normalizeValue(amount[1], amount[2], function (value, rate, originalCurrency, originalValue, valueText) {
            if (rate === false) {
                reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                self.slack.say(reply);
            } else if (!value) {
                reply["text"] = user.handle + self.text["InvalidAmount"];
                self.slack.say(reply);
            } else {

                self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                    if (err === null) {
                        reply["channel"] = DMchannelID;
                        // TODO text string
                        reply["text"] = "You want to withdraw " + valueText + " to " + address + "." +
                            "\nAre you Ok with that?";
                        self.slack.say(reply);

                        self.triggers.push(new Trigger(
                            self,
                            function (channel, message, _user) {
                                var trigger = this;

                                debug("trigger fired at channel: " + channel.id + " =? " + DMchannelID);
                                debug("trigger fired for user:   " + user.id + " =? " + _user.id);
                                debug("trigger fired message:    " + message);

                                if (channel.id === DMchannelID && _user.id == user.id && message.match(/(OK|yes|fine|sure)/i)) {

                                    user.withdraw(DMchannelID, value, address[0]);
                                    trigger.destroy();

                                    return true;
                                } else if (channel === DMchannelID && _user.id == user.id && message.match(/(no)/i)) {
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

            }
        });

        return;
    }

    //     * SEND  /   TIP
    if (message.match(/(send|give|sent|tip)/i)) {
        // check if recieving user was provided
        if (userMatches.length == 0) {
            reply["text"] = self.text["NoUserFound1"] + user.handle + self.text["NoUserFound"];
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
            self.normalizeValue(amount[1], amount[2], function (value, rate, originalCurrency, originalValue, valueText) {
                if (rate === false) {
                    reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                    self.slack.say(reply);
                } else if (!value) {
                    reply["text"] = user.handle + self.text["InvalidAmount"];
                    self.slack.say(reply);
                } else {
                    // send amount (move between accounts in wallet)
                    user.send(channel.id, mentioned, value);
                }
            });

            return;
        }
    }

    //     * DEMAND
    var matches = message.match(/(ask|demand|deserve|receive|send ?me|give ?me|gimme|ow[en]?s? me)/i);
    if (matches) {
        debug("REQUEST [" + matches[1] + "]");
        if (!self.OPTIONS.DEMAND) {
            reply["text"] = self.text["RequestingDisabled"];
            self.slack.say(reply);
            return;
        }
        if (userMatches.length == 1) {
            var mentioned = userMatches[0];

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

            self.normalizeValue(amount[1], amount[2], function (value, rate, originalCurrency, originalValue, valueText) {
                if (rate === false) {
                    reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                    self.slack.say(reply);
                } else if (!value) {
                    reply["text"] = user.handle + self.text["InvalidAmount"];
                    self.slack.say(reply);
                } else {
                    //TODO text string
                    reply["text"] = mentioned.handle + ": " + user.handle + " is requesting " + valueText + " from you ...";
                    self.slack.say(reply);
                    reply["text"] = "Are you OK with that?";
                    self.slack.say(reply);

                    self.triggers.push(new Trigger(
                        self,
                        function (channel, message, _user) {
                            var trigger = this;

                            if (_user.id == mentioned.id && message.match(/(OK|yes|fine|sure)/i)) {
                                mentioned.send(channel, user, value);
                                trigger.destroy();

                                return true;
                            } else if (_user.id == mentioned.id && message.match(/(no)/i)) {
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
    if (message.match(/(convert|rate|to)/i)) {
        var currencies = message.match(self.CURRENCY_REGEX);

        if (currencies.length < 2) {
            reply["text"] = user.handle + self.text["NotEnoughCurrencies"];
            self.slack.say(reply);
        } else if (currencies.length > 2) {
            reply["text"] = user.handle + self.text["ToMuchCurrencies"];
            self.slack.say(reply);
        } else {
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
                    self.normalizeValue(amount[1], toCurrency, function (value, rate, originalCurrency, originalValue, valueText) {
                        if (rate === false) {
                            reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                        } else if (!value) {
                            reply["text"] = user.handle + self.text["InvalidAmount"];
                        } else {
                            var newValue = rate * amount[1];
                            reply["text"] = amount[1] + " " + fromCurrency + " = " + newValue.toFixed(2) + "  " + toCurrency
                                + " ( 1.0 Dash = " + rate.toFixed(2) + " " + toCurrency + " )";
                        }
                        self.slack.say(reply);
                    });
                } else if (toCurrency === "dash") {
                    // other -> dash
                    self.normalizeValue(amount[1], fromCurrency, function (value, rate, originalCurrency, originalValue, valueText) {
                        if (rate === false) {
                            reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                        } else if (!value) {
                            reply["text"] = user.handle + self.text["InvalidAmount"];
                        } else {
                            reply["text"] = amount[1] + " " + fromCurrency + " = " + blocktrail.toBTC(value) + "  " + toCurrency
                                + " ( 1.0 " + fromCurrency + " = " + (1.0 / rate).toFixed(2) + " DASH)";
                        }
                        self.slack.say(reply);
                    });
                }
            }
        }
        return;
    }

    //     * PRICE
    if (message.match(/price/i)) {
        currency = message.match(self.CURRENCY_REGEX);

        if (currency) {
            currency = currency[0].toLowerCase();

            self.getPriceRates(function (err, rates) {
                var rate = rates[currency];

                if (!rate) {
                    reply["text"] = user.handle + self.text["UnsupportedCurrency"];
                } else {
                    reply["text"] = self.text["PriceBase"] + rate.toFixed(2) + " " + currency + self.text["PriceInfoFrom"];
                }
                self.slack.say(reply);
            });

            return;
        }
    }

    //     * LIST CURRENCIES
    if (message.match(/currencies/i)) {
        reply["text"] = self.text["CurrenciesTitle"] +
            self.text["SupportedCurrenciesFull"] + self.SUPPORTED_CURRENCIES.join(", ") + "\n" +
            self.text["SupportedSymbols"] + self.CURRENCIES.join(", ") + "* \n" +
            self.text["SupportedBase"];
        self.slack.say(reply);
        return;
    }

    //    * HELP
    if (message.match(/help/i)) {
        self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
            if (err === null) {
                reply["channel"] = DMchannelID;
                reply["text"] = self.tellHelp();
                self.slack.say(reply);
            }
        });
        return;
    }

    //     * OOPS
    reply["text"] = "Sorry " + user.handle + self.text["Oops"] ;
    self.slack.say(reply);
    return;
};

module.exports = TipBot;
