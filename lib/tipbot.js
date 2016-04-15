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

// MIN_TIP equal to BASE_FEE
var MIN_TIP = blocktrail.toSatoshi(0.0001);

var BLACKLIST_CURRENCIES = ["DASH"];

var TipBot = function(slack, RPC_USER, RPC_PASSWORD, OPTIONS) {
    var self = this;

    self.initializing = false;
    self.slack = slack;
    self.OPTIONS = _.defaults(OPTIONS, {
        TMP_DIR: path.resolve(__dirname, "../tmp"),
        ALL_BALANCES: false,
        DEMAND: false
    });
    // create connection via RPC to wallet
    self.wallet = new dashd.Client({
        host: "localhost",
        port: 9997,
        user: RPC_USER,
        pass: RPC_PASSWORD,
        timeout: 30000
    });

    // will be updated with all available currencies when API call is done
    self.CURRENCIES =  ["USD", "EUR", "GBP", "CNY","CAD","RUB","HKD","JPY","AUD","btc"];
    self.SUPPORTED_CURRENCIES =["US Dollar, Euro, British pound","Chinese yuan ","Canadian Dollar","Russian Ruble","Hong Kong dollar","Japanese yen","Australian Dollar","Bitcoin"];
    self.CURRENCY_REGEX = new RegExp("(Satoshis?|DASH|" + self.CURRENCIES.join("|") + ")", "ig");
    self.AMOUNT_REGEX = new RegExp("(\\d*\\.\\d*)","i");

    self.getPriceRates(function(err, rates) {
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

TipBot.prototype.getPriceRates = function(cb) {
    var self = this;

    var cacheDir = path.resolve(self.OPTIONS.TMP_DIR, "rates");
    var timeBucket = Math.floor((new Date).getTime() / 1000 / 60) * 60;
    var filename = cacheDir + "/rates.cache." + timeBucket + ".json";

    // fire and forget
    self.clearPriceRatesCache(cacheDir, function(err) {
        if (err) {
            debug(err);
        }
    });

    self._getPriceRates(filename, function(err, rates) {
        if (err) {
            debug(err);
        }

        cb(null, rates);
    });
};

TipBot.prototype.clearPriceRatesCache = function(cacheDir, cb) {
    //var self = this;

    fs.readdir(cacheDir, function(err, files) {
        async.forEach(files, function(file, cb) {
            fs.stat(path.join(cacheDir, file), function(err, stat) {
                var endTime, now;
                if (err) {
                    return cb(err);
                }

                now = new Date().getTime();
                endTime = new Date(stat.ctime).getTime() + 3600 * 1000;
                if (now > endTime) {
                    return fs.unlink(path.join(cacheDir, file), function(err) {
                        if (err) {
                            return cb(err);
                        }

                        cb();
                    });
                } else {
                    return cb();
                }
            });
        }, function(err) {
            cb(err);
        });
    });
};

// get rates form coinmarketcap 
TipBot.prototype._getPriceRates = function(filename, cb) {
   // var self = this;

    fs.exists(filename, function(exists) {
        if (exists) {
            fs.readFile(filename, "utf8", function(err, data) {
                if (err) {
                    return cb(err);
                }

                cb(null, JSON.parse(data));
            });
        } else {
            request.get("http://coinmarketcap-nexuist.rhcloud.com/api/dash/price", function(err, response, body) {
                fs.writeFile(filename, body, function(err) {
                    if (err) {
                        return cb(err);
                    }

                    cb(null, JSON.parse(body));
                });
            });
        }
    });
};

TipBot.prototype.addUser = function(user, updateRegex) {
    var self = this;

    if (typeof updateRegex === "undefined") {
        updateRegex = true;
    }

    self.users[user.id] = user;
    if (updateRegex) {
        self.updateUserRegex();
    }
};

TipBot.prototype.updateUserFromMember = function(member, updateRegex) {
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
TipBot.prototype.updateUserRegex = function() {
    var self = this;

    var ids = _.reject(_.map(self.users, "id"), function(id) {
        return id == self.slack.self.id;
    });

    self.userRegex = new RegExp("(" + ids.join("|") + ")", "g");
};

TipBot.prototype.init = function() {
    var self = this;

    if (self.initializing) {
        debug(".init called but still initializing...");
        return;
    }

    self.initializing = true;

    // get list of known users
    var url = "https://slack.com/api/users.list?token=" + self.slack.token;
    request.get(url, function(err, response, body) {
        if (err) {
            debug("ERROR", err);
        }

        var data = JSON.parse(body);

        // add each user to our list of users
        async.forEachLimit(data.members, 100, function(member, cb) {
            self.updateUserFromMember(member, false);
            cb();
        }, function(err) {
            if (err) {
                debug("ERROR", err);
            }

            self.updateUserRegex();

            debug("TipBot ready!");
            debug("I am <@%s:%s> of %s", self.slack.self.id, self.slack.self.name, self.slack.team.name);
            // debug('We have the following [' + Object.keys(self.users).length + '] known users; ', _.map(self.users, function(user) {
            //     return user.name;
            // }).join(', '));

            self.initializing = false;
        });
    });
};
// convert currency if needed
TipBot.prototype.normalizeValue = function(inputValue, unit, cb) {
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
            value = null; // @TODO: should give a proper error
        }
    }

    if (!value) {
        return cb();
    }

    if (currency != "DASH") {
        self.getPriceRates(function(err, rates) {
            var rate = rates[currency];
            debug("Rate for " + currency + " = "+ rate);
            if (!rate) {
                return cb(false, false, currency, value);
            } else {
                var newValue = Math.ceil(value / rate * 1e8);

                var text = value.toFixed(2) + " " + currency + " " +
                    "(" + blocktrail.toBTC(newValue) + " DASH at " + rate.toFixed(2) + " " + currency + " / DASH)";

                return cb(newValue, rate, currency, value, text);
            }
        });
    } else {
        return cb(value, null, null, null, blocktrail.toBTC(value) + " DASH");
    }
};

TipBot.prototype.tellHelp = function(channel) {
    channel.send(
        "*TIPBOT COMMANDS* \n" +
        
        " - *balance*\t\task the bot for your current balance\n" + 
        "\t\t\t\t\t\t @tipbot what is my balance_ \n" +
        "\n" +
        " - *send*\t\t\t\ttell the bot to send coins to someone; _@tipbot send 0.1 DASH to @someone_ \n" +
        " _aliases: give, tip_  works also with major fiat currencies (use *currencies* command to see the list); " +
        "\t\t\t\t\t\t\t\t _@tipbot give 4 USD to @someone_ \n" +
 //       "\t\t\t\t\t\t\t  \n" +
         "\n" +
        " - *deposit*\t\task the bot for a deposit address; _@tipbot let me deposit!_ \n" +
         "\n" +
        " - *withdraw*\ttell the bot to withdraw to a address; \n"+
        "\t\t\t\t\t\t _@tipbot withdraw 1 DASH to 1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp!_ \n" +
         "\n" +
        " - *receive*\t\ttell the bot to request coins from to someone; _@tipbot receive 0.1 DASH from @someone_ \n" +
        " _aliases: demand, ask, deserve, get, give me, owes me_ \n" +
         "\n" +
        " - *currencies*\task the bot for a list of supported currencies; _@tipbot what currencies do you know?_ \n" +
         "\n" +
        " - *price*\t\t\task the bot for the Dash price in a particular currency. Price info from coinmarketcap.\n "+ 
         "\t\t\t\t\t\t_@tipbot price in USD!_ \n" +
         "\n" +
        " - *convert*\t\task the bot to convert between a particular currency and Dash (or visa versa);  \n" +
        "\t\t\t\t\t\t _@tipbot 0.03 DASH to GBP_ \t or \t _@tipbot 15 EURO to DASH_\n"
    );
};

TipBot.prototype.onUserChange = function(member) {
    var self = this;

    self.updateUserFromMember(member);
};

TipBot.prototype.onMessage = function(channel, member, message) {
    var self = this;

    var amount, currency, providedCurrency;

    var user = self.users[member.id];

    if (!user) {
        return;
    }

    if (user.id == self.slack.self.id) {
        return;
    }

    // debug message
    debug(channel.name, member.name, message, channel.is_channel, channel.is_group);

    // check if we should parse this
    if ((channel.is_channel || channel.is_group) && !message.match(self.slack.self.id)) {
        debug("MESSAGE NOT FOR ME!");
        return;
    }

    // find user ID matches, ignore the sending user
    var userMatches = _.reject(message.match(self.userRegex), function(match) {
        return match == user.id;
    });

    // find real user objects
    userMatches = _.uniq(_.filter(_.map(userMatches, function(match) {
        // if it's an ID
        if (self.users[match]) {
            return self.users[match];
        }

        if (!user) {
            debug("Failed to find user match [" + match + "]");
        }

        return user;
    })));

    /*
     * ALL BALANCES
     */
    if (message.match(/(all|every(one)?s?) ?balances?/i)) {
        if (!self.OPTIONS.ALL_BALANCES) {
            channel.send("Retrieving all balances is disabled!");

            return;
        } else if (!user.is_admin) {
            channel.send("Only admins can list all balances!");

            return;
        }
//TODO: only via Direct Message ? Maybee users want to see (weekly) balance of tipbot to verify the integrity
        channel.send("Retrieving all balances... might take awhile depending on the amount of users!");

        async.mapLimit(Object.keys(self.users), 3, function(userID, cb) {
            var user = self.users[userID];

            user.getBalanceLine(cb);
        }, function(err, result) {
            if (err) {
                debug("ERROR", err);
                return;
            }

            channel.send(result.join("\n"));
        });

        return;
    }

    /*
     * BALANCE
     */
    if (message.match(/balance/i)) {
        if (channel.is_channel) {
            channel.send("I don't think you really want me to tell your balance public channel, " + user.handle + " :/");
        }

        user.tellBalance(self.slack.getDMByUserId(user.id));

        return;
    }

    /*
     * DEPOSIT
     */
    if (message.match(/deposit/i)) {
        user.tellDepositeAddress(self.slack.getDMByUserId(user.id));

        return;
    }

    /*
     * WITHDRAW
     */
    if (message.match(/withdraw/i)) {
        amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
        if (amount === null) {
            channel.send(user.name + " couldn't find the amount. Did you forget the decimal ?");
            return;
        }
        // check if currency was provide
        providedCurrency = message.match(self.CURRENCY_REGEX) ;
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
            address = _.uniq(_.filter(address, function(address) {
                try {
                    return bitcoin.Address.fromBase58Check(address);
                } catch (e) {
                    return false;
                }
            }));

            if (!address.length) {
                channel.send("Sorry " + user.handle + " that's not a valid address!");
                return;
            } else if (address.length > 1) {
                channel.send("Sorry " + user.handle + " I can't do a withdraw to more than 1 address [" + address.join(", ") + "]");
                return;
            }
            
        } else {
            // no address
            channel.send("Sorry " + user.handle + " I need to know an address to withdraw to.");
            return;
        }
        // no amount
        if (!amount) {
            channel.send("Sorry " + user.handle + " I need to know much you want to withdraw and the currency.");
            return;
        }

        self.normalizeValue(amount[1], amount[2], function(value, rate, originalCurrency, originalValue, valueText) {
            if (rate === false) {
                channel.send(user.handle + ": we don't support that currency yet!");
            } else if (!value) {
                channel.send(user.handle + ": that's an invalid amount");
            } else {
                var dm = self.slack.getDMByUserId(user.id);

                dm.send("You want to withdraw " + valueText + " to " + address + ".");
                dm.send("Are you OK with that?");

                self.triggers.push(new Trigger(
                    self,
                    function(channel, message, _user, userMatches) {
                        var trigger = this;

                        if (channel.id == dm.id && _user.id == user.id && message.match(/(OK|yes|fine|sure)/i)) {
                            user.withdraw(self.slack.getDMByUserId(user.id), value, address[0]);
                            trigger.destroy();

                            return true;
                        } else if (channel.id == dm.id && _user.id == user.id && message.match(/(no)/i)) {
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

    /*
     * IF MENTIONS ANOTHER USER MUST BE A GIVE OR REQUEST
     */
    if (userMatches.length == 1) {
        var mentioned = userMatches[0];

        amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
        if (amount === null) {
            channel.send(user.name + " couldn't find the amount. Did you forget the decimal ?");
            return;
        }
        // check if currency was provide
        providedCurrency = message.match(self.CURRENCY_REGEX) ;
        if (providedCurrency !== null && providedCurrency[0].length !== 0) {
            //  set provided currency
            amount[2] = message.match(self.CURRENCY_REGEX)[0];
        } else {
            //not provided, set dash as default currency
            amount[2] = "DASH";
        }
       

     /*
     * DEMAND
     */
        var matches = message.match(/(ask|demand|deserve|receive|send ?me|give ?me|gimme|ow[en]?s? me)/i);
        if (amount && matches) {
            debug("REQUEST [" + matches[1] +  "]");
            if (!self.OPTIONS.DEMAND) {
                channel.send("Requesting coins is disabled!");
                return;
            }

            self.normalizeValue(amount[1], amount[2], function(value, rate, originalCurrency, originalValue, valueText) {
                if (rate === false) {
                    channel.send(user.handle + ": we don't support that currency yet!");
                } else if (!value) {
                    channel.send(user.handle + ": that's an invalid amount. Did you forget to provide the currency ?");
                } else {
                    if (value < MIN_TIP) {
                        channel.send(user.handle + ": the minimum tip amount is " + blocktrail.toBTC(MIN_TIP) + " DASH");

                        return;
                    }

                    channel.send(mentioned.handle + ": " + user.handle + " is requesting " + valueText + " from you ...");
                    channel.send("Are you OK with that?");

                    self.triggers.push(new Trigger(
                        self,
                        function(channel, message, _user, userMatches) {
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

     /*
     * SEND
     */
        if (amount && message.match(/(send|give|sent|tip)/i)) {
            self.normalizeValue(amount[1], amount[2], function(value, rate, originalCurrency, originalValue, valueText) {
                if (rate === false) {
                    channel.send(user.handle + ": we don't support that currency yet!");
                } else if (!value) {
                    channel.send(user.handle + ": that's an invalid amount");
                } else {
                    if (value < MIN_TIP) {
                        channel.send(user.handle + ": the minimum tip amount is " + blocktrail.toBTC(MIN_TIP) + " DASH");

                        return;
                    }

                    channel.send("OK! I'll send " + mentioned.handle + " " + valueText);

                    user.send(channel, mentioned, value);
                }
            });

            return;
        }
    }

    /*
     * TMP TRIGGERS
     */
    var triggers = self.triggers.slice();
    if (_.any(triggers, function(trigger) {
        return trigger.match(channel, message, user, userMatches);
    })) {

        return;
    }

    /*
     * MENTIONS MULTIPLE USER
     */
    if (userMatches.length > 1) {
        channel.send("Sorry " + user.handle + " but you're mentioning too many people!");

        return;
    }
// TODO for dash
    /*
     * CONVERT
     */
    if (message.match(/(convert|rate|to)/i)) {
        var currencies = message.match(self.CURRENCY_REGEX);

        if (currencies.length < 2) {
            channel.send(user.handle + ": not enough currencies!");
        } else if (currencies.length > 2) {
            channel.send(user.handle + ": too many currencies!");
        } else {
            amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
            if (amount === null) {
                channel.send(user.name + " couldn't find the amount. Did you forget the decimal ?");
                return;
            } else if (amount) {
                var fromCurrency = currencies[0].toLowerCase() ;
                var toCurrency   = currencies[1].toLowerCase() ;
                if (fromCurrency === "dash") {
                    // Dash -> other
                    self.normalizeValue(amount[1], toCurrency, function(value, rate, originalCurrency, originalValue, valueText) {
                        if (rate === false) {
                            channel.send(user.handle + ": we don't support that currency yet!");
                        } else if (!value) {
                            channel.send(user.handle + ": that's an invalid amount");
                        } else {
                            var newValue = rate * amount[1];
                            channel.send(amount[1] + " " + fromCurrency + " = "  + newValue.toFixed(2) + "  " + toCurrency
                            + " (" + rate.toFixed(2) + " " + fromCurrency + " / DASH)");            
                        }
                    });
                } else if (toCurrency=== "dash"){
                    // other -> dash
                    self.normalizeValue(amount[1], fromCurrency, function(value, rate, originalCurrency, originalValue, valueText) {
                        if (rate === false) {
                            channel.send(user.handle + ": we don't support that currency yet!");
                        } else if (!value) {
                            channel.send(user.handle + ": that's an invalid amount");
                        } else {
                            channel.send(amount[1] + " " +  fromCurrency + " = "  + blocktrail.toBTC(value) + "  " + toCurrency
                            + " (" + rate.toFixed(2) + " " + fromCurrency + " / DASH)");            
                        }
                    });
                }
            }
        }
        return;
    }
    
    /*
     * PRICE
     */
    if (message.match(/price/i)) {
        currency = message.match(self.CURRENCY_REGEX);

        if (currency) {
            currency = currency[0].toLowerCase();

            self.getPriceRates(function(err, rates) {
                var rate = rates[currency];

                if (!rate) {
                    channel.send(user.handle + ": we don't support that currency yet!");
                } else {
                    channel.send("1.0 DASH is " + rate.toFixed(2) + " " + currency + " (price of coinmarketcap)");
                }
            });

            return;
        }
    }

    /*
     * LIST CURRENCIES
     */
    if (message.match(/currencies/i)) {
        channel.send("Price info from coinmarketcap");
        channel.send("Supported currencies: " + self.SUPPORTED_CURRENCIES.join(", "));
        channel.send("use this currency signs in your message: *" + self.CURRENCIES.join(", ") +"*");
        
        return;
    }

    /*
     * HELP
     */
    if (message.match(/help/i)) {
        self.tellHelp(channel);

        return;
    }

    /*
     * OOPS
     */
    channel.send("Sorry " + user.handle + " but I did not understand that :(" + 
      "\n use *help* to see the valid commands.");
   
    return;
};

module.exports = TipBot;
