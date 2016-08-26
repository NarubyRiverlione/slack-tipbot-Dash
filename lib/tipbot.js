'use strict';
let _ = require('lodash');
let debug = require('debug')('tipbot:tipbot');
let async = require('async');
let request = require('request');
//let blocktrail = require('blocktrail-sdk');
let User = require('./user');
let bitcoin = require('bitcoinjs-lib');
let path = require('path');
let fs = require('fs');
let dashd = require('bitcoin');
let texts = require('../text/dash.js').tipbotTxt;
let sun = require('./sun');
let quiz = require('./quiz');
require('waitjs');

const BLACKLIST_CURRENCIES = ['DASH'];

function toDuff(dash) {
    let checkMaxMin = (dash * 1e8).toFixed(0);
    if (checkMaxMin > Number.MAX_SAFE_INTEGER || checkMaxMin < Number.MIN_SAFE_INTEGER) {
        return null;
    } else {
        return parseInt(checkMaxMin, 10);
    }
}

function toDash(duff) {
    return (duff / 1e8).toFixed(8);
}

let TipBot = function (bot, RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS) {
    let self = this;
    if (!bot) { throw new Error('Connection with Slack not availible for tipbot'); }

    self.HighBalanceWarningMark = toDuff(2.0);

    self.initializing = false;

    self.users = {};
    // self.triggers = [];

    self.slack = bot;
    self.sunUser = null;

    // default options
    self.OPTIONS = _.defaults(OPTIONS, {
        TMP_DIR: path.resolve(__dirname, '../tmp'),
        ALL_BALANCES: false,                // default admins cannnot see all balances
        OTHER_BALANCES: false,              // default admins cannot see a balance of an other specific user
        WARN_MODS_NEW_USER: false,
        WARN_MODS_USER_LEFT: false,
        TX_FEE: toDuff(0.0001),     // TX fee, used in withdrawing, in satochi
        WALLET_PASSW: null,

        PRICE_UPDATE_EVERY: 30, // minuts
        // PRICETICKER_CHANNEL: null,
        // PRICETICKER_TIMER: 30,  // show the complete price list every X minutes in the PRICE_CHANNEL_NAME channel
        // PRICETICKER_BOUNDARY: 0.5, // check boundaries ever x minutes

        SUN_USERNAME: null,
        SUN_SEND_THROTTLE: 1250, // ms wait between sunrays to cast (prevent slack spam protection)
        SUN_TIMER: 30, // check sun balance > threshold every X minutes
        SUN_THRESHOLD: toDuff(5) // satoshis
    });

    // create connection via RPC to wallet
    self.wallet = new dashd.Client({
        host: 'localhost',
        port: RPC_PORT,
        user: RPC_USER,
        pass: RPC_PASSWORD,
        timeout: 30000
    });

    // will be updated with all available currencies when API call is done
    self.CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'CAD', 'RUB', 'HKD', 'JPY', 'AUD', 'btc'];
    self.SUPPORTED_CURRENCIES = ['US Dollar, Euro, British pound', 'Chinese yuan ', 'Canadian Dollar', 'Russian Ruble', 'Hong Kong dollar', 'Japanese yen', 'Australian Dollar', 'Bitcoin'];
    // the currencies that will has there price showed every x time
    self.LIST_PRICES = ['USD', 'EUR', 'GBP', 'BTC'];

    self.CURRENCY_REGEX = new RegExp('\\b(Satoshis?|DASH|' + self.CURRENCIES.join('|') + ')\\b', 'ig'); // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

    self.AMOUNT_REGEX = new RegExp('\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+)(?:\\s|$)');
    self.AMOUNT_OR_ALL_REGEX = new RegExp('\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+|all)(?:\\s|$)');

    self.ADDRESS_REGEX = new RegExp('[X|y][a-zA-Z0-9]{25,36}', 'g');

    // get the fiat prices
    self.getPriceRates(function (err, rates) {
        self.CURRENCIES = [];

        for (let rate in rates) {
            if (BLACKLIST_CURRENCIES.indexOf(rate) === -1) {
                self.CURRENCIES.push(rate);
            }
        }
        self.CURRENCY_REGEX = new RegExp('\\b(Satoshis?|DASH|' + self.CURRENCIES.join('|') + ')\\b', 'ig'); // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

        // self.CURRENCY_REGEX = new RegExp('(Satoshis?|DASH|' + self.CURRENCIES.join('|') + ')', 'ig');
    });

    // Init tipbot
    self.init();
};


// get a price of a currency pair
TipBot.prototype.tellPrice = function (currency, cb) {
    let self = this;
    self.getPriceRates(function (err, rates) {
        let rate = rates[currency];
        if (!rate) {
            cb(texts.UnsupportedCurrency, null);
        } else {
            cb(null, texts.PriceBase + rate.toPrecision(4) + ' ' + currency);
        }
    });
};

// show prices of all currencies listed in LIST_PRICES
TipBot.prototype.showPriceList = function (tellInChannel, all) {
    let self = this;
    let reply = { 'channel': tellInChannel.id, text: '' };
    // show all currencies of only the short list ?
    let priceList = (all ? self.CURRENCIES : self.LIST_PRICES);
    debug('Pricelist: show ' + priceList.length + ' currency pairs in ' + tellInChannel.name);

    async.forEach(priceList,
        function (currency, callback) {
            self.tellPrice(currency.toLowerCase(), function (err, respone) {
                if (err) { callback(err); return; }
                reply.text += respone + '\n';
                callback();
            });
        },
        function (err) {
            // add  where price information is pulled from
            if (err) { debug(err); return; }
            reply.text += texts.PriceInfoFrom;
            self.slack.say(reply);
        }
    );
};

// get new price cache file and remove old then PRICE_UPDATE_EVERY minutes
// return via callback the error(null) and current price information
TipBot.prototype.getPriceRates = function (cb) {
    let self = this;

    let cacheDir = path.resolve(self.OPTIONS.TMP_DIR, 'rates');
    let timeBucket = Math.floor((new Date()).getTime() / 1000 / 60) * self.OPTIONS.PRICE_UPDATE_EVERY;
    let filename = cacheDir + '/rates.cache.' + timeBucket + '.json';

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
            /*
            rates.ml = 1.0 / 1.2;
            rates.mile = 1.0 / 16.0;
            rates.oz = 1.0 / 36.0;
            rates.tsp = 1.0 / 6.0;

            if (rates.eur) {
                rates['€'] = rates.eur;
                rates.euro = rates.eur;
            }
            if (rates.usd) {
                rates.dollar = rates.usd;
            }
            */
        }
        cb(null, rates);
    });
};

// remove price cache files older then 1 hour
TipBot.prototype.clearPriceRatesCache = function (cacheDir, cb) {
    let self = this;

    fs.readdir(cacheDir, function (err, files) {
        async.forEach(files, function (file, cb) {
            fs.stat(path.join(cacheDir, file), function (err, stat) {
                let endTime, now;
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
    // let self = this;

    fs.exists(filename, function (exists) {
        if (exists) {
            fs.readFile(filename, 'utf8', function (err, data) {
                if (err) {
                    return cb(err);
                }

                cb(null, JSON.parse(data));
            });
        } else {
            request.get('http://coinmarketcap-nexuist.rhcloud.com/api/dash/price', function (err, response, body) {
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
    let self = this;

    if (typeof updateRegex === 'undefined') {
        updateRegex = true;
    }

    self.users[user.id] = user;
    if (updateRegex) {
        self.updateUserRegex();
    }

    // warn admins that new users has arrived, only when not initializing the tipbot
    if (self.OPTIONS.WARN_MODS_NEW_USER && self.OPTIONS.MODERATOR_CHANNEL !== undefined && !self.initializing) {
        let newUserMsg = {
            channel: self.OPTIONS.MODERATOR_CHANNEL.id,
            text: texts.WarningNewUser1 +
            user.name +
            texts.WarningNewUser2
        };
        self.slack.say(newUserMsg);
    }
};

TipBot.prototype.updateUserFromMember = function (member, updateRegex) {
    let self = this;

    if (typeof updateRegex === 'undefined') {
        updateRegex = true;
    }

    if (self.users[member.id] && member.deleted) {
        delete self.users[member.id];
    }

    if (member.deleted || member.is_bot) {
        // warn admins that  users has left, only when not initializing the tipbot
        if (self.OPTIONS.WARN_MODS_USER_LEFT && self.OPTIONS.MODERATOR_CHANNEL !== undefined && !self.initializing) {
            let userLeftMsg = {
                channel: self.OPTIONS.MODERATOR_CHANNEL.id,
                text: texts.WarnUserLeft1 +
                member.name +
                texts.WarnUserLeft2
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
    let self = this;

    let ids = _.reject(_.map(self.users, 'id'), function (id) {
        return id === self.slack.identity.id;
    });

    self.userRegex = new RegExp('(' + ids.join('|') + ')', 'g');
};

// open a Direct Message channel to talk to an user, return channelID
TipBot.prototype.getDirectMessageChannelID = function (channel, userID, cb) {
    let self = this;
    // check if already in a DM channel
    if (channel !== null && channel.id !== undefined) {
        let firstCharOfChannelID = channel.id.substring(0, 1);
        if (firstCharOfChannelID === 'D') {
            cb(null, channel.id);
            return;
        }
    }
    self.slack.api.im.open({ 'user': userID }, function (err, response) {
        if (err) {
            debug('ERROR cannot open DM channel for ' + userID + ' : ' + err);
            return;
        }
        cb(null, response.channel.id);
    });
};

// get ID of a channel
TipBot.prototype.getChannel = function (channelName, cb) {
    let self = this;
    let findNameExp = new RegExp(channelName + '(?![\\w-])', 'i'); // word boundaries that include the '-'
    self.slack.api.channels.list({}, function (err, channelList) {
        if (err) {
            debug('ERROR retrieving list of channels ' + err);
            cb(err, null);
        }
        let foundChannelIDs = _.filter(channelList.channels, function (find) {
            return find.name.match(findNameExp);
        });

        if (foundChannelIDs.length === 1) {
            cb(null, foundChannelIDs[0]);
        } else {
            // debug('tipbot:bot')('Didn't found the ' + channelName + ', looking in private groups now.');
            self.slack.api.groups.list({}, function (err, groupList) {
                if (err) {
                    debug('ERROR retrieving list of private channels (groups)' + err);
                    cb(err, null);
                }
                let priceGroupID = _.filter(groupList.groups, function (find) {
                    return find.name.match(findNameExp);
                });
                if (priceGroupID.length === 1) {
                    cb(null, priceGroupID[0]);
                } else {
                    debug('Didn\'t found the ' + channelName + ', in public nor private groups.');
                }
            });
        }

    });
};

// initializing of TipBot :  get list of current users
TipBot.prototype.init = function () {
    let self = this;
    // prevent multiple initializations
    if (self.initializing) {
        debug('.init called but still initializing...');
        return;
    }
    self.initializing = true;

    // create all user objects for online users (will be updated via 'user_change' slack event in bot.js )
    self.slack.api.users.list({}, function (err, data) {
        if (err) { throw new Error(err); }
        // add each user to our list of users
        async.forEachLimit(data.members, 100,
            function (member, cb) {
                self.updateUserFromMember(member, false);
                cb();
            },
            function (err) {
                if (err) {
                    debug('ERROR Init: ', err);
                }

                self.updateUserRegex();

                // get Sun user
                self.sunUser = sun.init(self.OPTIONS.SUN_USERNAME, self.users);

                // Done !
                debug('I am <@%s:%s> of %s', self.slack.identity.id, self.slack.identity.name, self.slack.team_info.name);
                debug('***** TipBot ready! *****');
                // debug('We have the following . + Object.keys(self.users).length +  known users; ', _.map(self.users, function(user) {
                //     return user.name;
                // }).join(', '));

                self.initializing = false;
            });

    });

};

// convert currency if needed,
// return via callback amount in dash, and if it was needed to convertion rate and originalCurrency
// CB (value, rate, originalCurrency, originalValue, valueText)
TipBot.prototype.normalizeValue = function (inputValue, unit, user, cb) {
    let self = this;
    let currency, value;

    // asked for all = balance
    if (inputValue === 'all' && user !== undefined) {
        user.getBalance(user.id, 6, function (err, balance) {
            if (err) {
                debug(err);
                cb(null, null, null, null, 'ERROR');
            }
            let value = toDuff(balance);
            debug('Log: using ALL balance of ' + user.name + ' = ' + balance);
            cb(value, null, null, null, toDash(value) + ' DASH');
        });

    } else {
        // no 'all', evaluate the unit
        if (unit.match(/satoshis?/i)) {
            currency = 'DASH';
            value = parseInt(inputValue);
        } else if (unit.match(/DASH/i)) {
            currency = 'DASH';
            value = toDuff(inputValue);
        } else {
            currency = unit.trim().toLowerCase();
            if (self.CURRENCIES.indexOf(currency) !== -1) {
                value = parseFloat(inputValue);
            } else {
                value = null;
            }
        }

        if (!value) {
            // no valid currency = return without converted amount = amount will be undefined
            return cb();
        }
    }
    if (currency !== 'DASH') {
        // check if a price update is needed
        self.getPriceRates(function (err, rates) {
            let rate = rates[currency];
            debug('Rate for ' + currency + ' = ' + rate);
            if (!rate) {
                return cb(false, false, currency, value);
            } else {
                let newValue = Math.ceil(value / rate * 1e8);

                let text = value.toFixed(2) + ' ' + currency + ' ' +
                    '(' + toDash(newValue) + ' DASH at ' + rate.toFixed(2) + ' ' + currency + ' / DASH)';
                // return converted value in dash,  convertion rate, originalCurrency, originalValue, text about the convertion
                return cb(newValue, rate, currency, value, text);
            }
        });
    } else {
        // amount is in Dash, return only value, no convertion rate
        return cb(value, null, null, null, toDash(value) + ' DASH');
    }
};

// tell all help text, if call by an admin show also the admin-only commands
TipBot.prototype.tellHelp = function (is_admin) {
    let text = _.reduce(texts.helpText, function (completeHelpText, helpPart) {
        return completeHelpText + helpPart + '\n';
    }, '');
    if (is_admin) {
        text += '\n\n' + texts.helpAdminOnly;
    }
    return text;
};

// get random help text
TipBot.prototype.showRandomHelp = function () {
    let self = this;
    if (self.OPTIONS.MAIN_CHANNEL === undefined) {
        debug('ERROR: cannot show random helptext because Main Chat channel is not set.');
        return;
    }
    let helpCount = texts.helpText.length;
    let getHelpNR = Math.floor((Math.random() * helpCount));
    getHelpNR = getHelpNR === 0 ? 1 : getHelpNR;                         // don\'t show title
    let helpTxt = texts.helpText[getHelpNR].replace(/[*]/g, '').replace(/[_]/g, '');     // * for bold doesn't show in a code block
    debug('show helptext number ' + getHelpNR);

    let helpMsg = {
        channel: self.OPTIONS.MAIN_CHANNEL.id,
        text: '>>>' + texts.HelpRandom1 + '\n' +
        '```' + helpTxt + '```'
    };
    self.slack.say(helpMsg);
};

TipBot.prototype.onUserChange = function (bot, member) {
    let self = this;
    self.updateUserFromMember(member);
};

// check if sun balance > sun threshold
TipBot.prototype.checkForSun = function () {
    let self = this;
    sun.checkThreshold(self.OPTIONS.SUN_THRESHOLD, self.sunUser,
        function (err, reviecedUsers, sunraySize) {
            if (err) {
                debug(err); return;
            }
            if (sunraySize !== null && reviecedUsers !== null) {
                // show public announcement
                let reply = {
                    channel: self.OPTIONS.MAIN_CHANNEL.id,
                    text: texts.SunRay + '\n' +
                    texts.SunExplain + '\n' +
                    texts.SunRay + '\n'
                };
                self.slack.say(reply);
                //send private message to each revieced user
                debug('sun: ===== ASYNC start sending private messages for sun =====');
                async.forEachSeries(reviecedUsers,
                    function (oneUser, asyncCB) {
                        // wait the time set via sun Throttle to prevent slack spam protection
                        wait(self.OPTIONS.SUN_SEND_THROTTLE, function () {
                            // ignore all response to prevent wall of text in public, sender = sun User = not usefull to inform
                            // custom message to reciever:
                            self.getDirectMessageChannelID(null, oneUser.id, function (err, DMchannelRecievingUser) {
                                if (err === null) {
                                    // send private message to lucky user
                                    let recievingUserMessage = {
                                        'channel': DMchannelRecievingUser,
                                        'text': texts.SunRecieved + toDash(sunraySize) + ' dash'
                                    };
                                    self.slack.say(recievingUserMessage);
                                }
                            });
                        });
                        asyncCB();// callback needed to let async know everyhing is done
                    },
                    // function called when all async tasks are done
                    function (err) {
                        if (err) {
                            debug('ERROR sun: during async sun: ' + err);
                            return;
                        }
                        debug('SUN ===== ASYNC stop sending private messages for sun =====');
                    });
            }
        });
};

// a Slack message was send,
// if the bot name mentioned look for command keywords
TipBot.prototype.onMessage = function (channel, member, message) {
    let self = this;
    let reply = { 'channel': channel.id };

    let amount, currency, providedCurrency;

    let user = self.users[member];

    if (user === undefined) {
        // don\'t know who send the message
        debug('ERROR don\'t have the user ' + member.name + ' (' + member.id + ') in my known users (array)');
        return;
    }

    if (user.id === self.slack.identity.id) {
        // message was from bot (reply to a command)
        return;
    }

    let privateReply = {};
    self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
        privateReply.channel = DMchannelID;
        // debug message
        let channelName = channel.Name || channel.id; // channelName = name of id if no name if found (group)
        debug('Message in channel: ' + channelName + ' from user ' + user.name + ' : \'' + message + '\'');

        // find user ID matches, ignore the sending user
        let userMatches = _.reject(message.match(self.userRegex), function (match) {
            return match === user.id;
        });

        // find real user objects
        userMatches = _.uniq(_.filter(_.map(userMatches, function (match) {
            // if it's an ID
            if (self.users[match]) {
                return self.users[match];
            }

            if (!user) {
                debug('Failed to find user match . + match + ');
            }

            return user;
        })));

        // MENTIONS MULTIPLE USER
        if (userMatches.length > 1) {
            reply.text = 'Sorry ' + user.handle + texts.ToMuchUsers;
            self.slack.say(reply);
            return;
        }

        // * SPEAK as bot (admin only)
        if (message.match(/\bspeak\b/i)) {
            // admin only command
            if (user.is_admin) {
                // find channel to talk into
                if (message.match(/\binto\b/i)) {
                    self.OPTIONS.talkInChannel = message.replace('speak', '').replace('into', '').trim();
                    return;
                }
                if (self.OPTIONS.talkInChannel !== undefined) {
                    //only if channel to speak into is set
                    let say = message.replace('speak', '');
                    //debug(say);

                    self.slack.api.channels.list({}, function (err, channelList) {
                        if (err) {
                            debug('Error retrieving list of channels ' + err);
                            return;
                        }
                        let foundChannelIDs = _.filter(channelList.channels, function (find) {
                            return find.name.match(self.OPTIONS.talkInChannel, 'i');
                        });

                        if (foundChannelIDs.length === 1) {
                            //channel found, say message
                            self.slack.say({
                                channel: foundChannelIDs[0].id,
                                text: say
                            });
                        } else {
                            debug('ERROR cannot find channel \'' + self.OPTIONS.talkInChannel + '\'');
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
                if (userMatches.length === 0) {
                    reply.text = texts.Hello + user.handle + texts.NoUserFoundForTip;
                    self.slack.say(reply);
                    return;
                } else if (userMatches.length === 1) {
                    let whisperTo = userMatches[0];
                    self.getDirectMessageChannelID(null, whisperTo.id, function (err, dmChannel) {
                        if (err) { return; }
                        let whisperText = message.replace(whisperTo.name, '')
                            .replace('whisper', '')
                            .replace(self.slack.identity.name, '')
                            .replace('<@', '').replace(whisperTo.id, '').replace('>', '');
                        debug('Whisper to ' + whisperTo.name + ' as bot : \'' + whisperText + '\'');
                        let whisper = { channel: dmChannel, text: whisperText };
                        self.slack.say(whisper);

                    });
                }
            }
            return;
        }

        //     * BALANCE
        if (message.match(/\bbalance\b/i)) {
            let balanceOfUser = user; // default show own balance (see balance check cmd)

            //     * ALL BALANCES (admin only, needs to be enabled via OPTIONS.ALL_BALANCES)
            if (message.match(/\ball\b/i)) {
                if (self.OPTIONS.ALL_BALANCES === false) {
                    reply.text = texts.RetrievingAllBalancesDisabled;
                    self.slack.say(reply);
                    return;
                }
                if (!user.is_admin) {
                    reply.text = texts.RetrievingAllBalancesAdminOnly;
                    self.slack.say(reply);
                    return;
                }
                // warn that this can take a while
                reply.text = texts.RetrievingAllBalancesWait;
                self.slack.say(reply);

                async.mapLimit(Object.keys(
                    self.users),
                    3,
                    function (userID, cb) {
                        let user = self.users[userID];

                        user.getBalanceLine(cb);
                    },
                    function (err, result) {
                        if (err) { debug('ERROR', err); return; }

                        reply.text = result.join('\n');
                        // reply in Direct Message
                        self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                            if (err === null) {
                                reply.channel = DMchannelID;
                                self.slack.say(reply);
                            }
                        });

                    });

                return;
            }

            //  * SEE BALANCE OF OTHER USER (admin only, needs to be enabled via OPTIONS.OTHER_BALANCES)
            // feature asked for verifying dummy, fake, slack accounts
            if (message.match(/\bcheck\b/i)) {
                if (self.OPTIONS.OTHER_BALANCES === false) {
                    privateReply.text = texts.CheckBalanceDisabled;
                    self.slack.say(privateReply);
                    return;
                }
                if (!user.is_admin) {
                    privateReply.text = texts.CheckBalanceAdminOnly;
                    self.slack.say(privateReply);
                    return;
                }
                // check if  user was provided
                if (userMatches.length === 0) {
                    privateReply.text = texts.Hello + user.handle + texts.CheckBalanceNoUserFound;
                    self.slack.say(privateReply);
                    return;
                }
                if (userMatches.length === 1) {
                    balanceOfUser = userMatches[0]; // get balance of mentioned user
                }
            }

            // tell  balance in private message
            balanceOfUser.getBalanceLine(function (err, line) {
                if (err) {
                    debug('ERROR: cannot tell ballance of ' + balanceOfUser.name + '/' + balanceOfUser.id);
                } else {
                    privateReply.text = line;
                    self.slack.say(privateReply);
                }
            });

            return;
        }

        //     * DEPOSIT
        if (message.match(/\bdeposit\b/i)) {
            user.tellDepositeAddress(function (err, line) {
                if (err) {
                    debug('ERROR: cannot find a deposit address for \'' + user.name + '(' + user.id + ') : ' + err);
                } else {
                    privateReply.text = line;
                    self.slack.say(privateReply);
                }
            });

            return;
        }

        //     * WITHDRAW
        if (message.match(/\bwithdraw\b/i)) {
            amount = message.match(self.AMOUNT_OR_ALL_REGEX); // only the number, no currency
            if (amount === null) {
                reply.text = user.name + texts.NoAmountFound;
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
                amount[2] = 'DASH';
            }
            debug(amount);

            let address = message.match(self.ADDRESS_REGEX);

            if (address) {
                address = _.uniq(_.filter(address, function (address) {
                    try {
                        return bitcoin.Address.fromBase58Check(address);
                    } catch (e) {
                        return false;
                    }
                }));

                if (!address.length) {
                    reply.text = 'Sorry ' + user.handle + texts.NoValidAddress;
                    self.slack.say(reply);
                    return;
                } else if (address.length > 1) {
                    reply.text = 'Sorry ' + user.handle + texts.MoreThen1Address + ' [' + address.join(', ') + ']';
                    self.slack.say(reply);
                    return;
                }

            } else {
                // no address
                reply.text = 'Sorry ' + user.handle + texts.NoAddress;
                self.slack.say(reply);
                return;
            }
            // no amount
            if (!amount) {
                reply.text = 'Sorry ' + user.handle + texts.NoAmountOrCurrency;
                self.slack.say(reply);
                return;
            }
            // convert amount if currency isn't Dash
            self.normalizeValue(amount[1], amount[2], user, function (value, rate, originalCurrency, originalValue, valueText) {
                if (rate === false) {
                    reply.text = user.handle + texts.UnsupportedCurrency;
                    self.slack.say(reply);
                } else if (!value) {
                    reply.text = user.handle + texts.InvalidAmount;
                    self.slack.say(reply);
                } else {
                    // ask for confirmation (needed if doing a conversion: withdraw x euro)
                    let privateConversation = { user: user.id };
                    self.slack.startPrivateConversation(privateConversation, function (err, convo) {
                        convo.ask(
                            texts.WithdrawQuestion[0] + valueText +
                            texts.WithdrawQuestion[1] + address +
                            texts.WithdrawQuestion[2],
                            [
                                {
                                    pattern: self.slack.utterances.yes,
                                    callback: function (response, convo) {
                                        convo.say('Great! I will continue...');
                                        // do something else...
                                        user.withdraw(value, address[0], self.OPTIONS.WALLET_PASSW, function (err, response) {
                                            if (err) {
                                                debug('ERROR: cannot withdraw because: ' + err);
                                                convo.say(err);
                                            } else {
                                                convo.say(response);
                                                debug(user.name + ' had succesfull withdraw ' + value + ' to ' + address[0]);
                                            }
                                        });
                                        convo.next();
                                        return;
                                    }
                                },
                                {
                                    pattern: self.slack.utterances.no,
                                    callback: function (response, convo) {
                                        convo.say('Perhaps later.');
                                        // do something else...
                                        debug('Withdraw canceled by user: ' + user.name + '/' + user.id);
                                        convo.next();
                                        return;
                                    }
                                }
                            ]);
                    });
                }
            });
            return;
        }

        //     * SEND / TIP
        if (message.match(/\b(send|give|sent|tip)\b/i)) {
            // check if recieving user was provided
            if (userMatches.length === 0) {
                reply.text = texts.Hello + user.handle + texts.NoUserFoundForTip;
                self.slack.say(reply);
                return;
            } else if (userMatches.length === 1) {
                let mentioned = userMatches[0];

                // get only the number, no currency
                amount = message.match(self.AMOUNT_REGEX);
                if (amount === null) {
                    reply.text = user.name + texts.NoAmountFound;
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
                    amount[2] = 'DASH';
                }
                // convert if currency isn't Dash
                self.normalizeValue(amount[1], amount[2], user, function (value, rate) {
                    if (rate === false) {
                        reply.text = user.handle + texts.UnsupportedCurrency;
                        self.slack.say(reply);
                    } else if (!value) {
                        reply.text = user.handle + texts.InvalidAmount;
                        self.slack.say(reply);
                    } else {
                        // send amount (move between accounts in wallet)
                        user.send(mentioned, value, function (err, responses) {
                            if (err) {
                                debug('ERROR: cannot send ' + value + ' to ' + mentioned.name + '(' + mentioned.id + ') : ' + err);
                                // warn sender about the error
                                // response to sender: send thanks and new ballance
                                privateReply.text = err;
                                self.slack.say(privateReply);
                            } else {
                                // response in public channel:  announce tip
                                reply.text = responses.public;
                                self.slack.say(reply);
                                // response to sender: send thanks and new ballance
                                privateReply.text = responses.privateToSender;
                                self.slack.say(privateReply);
                                // response to reciever:  inform of the tip
                                self.getDirectMessageChannelID(null, mentioned.id, function (err, DMchannelRecievingUser) {
                                    if (err === null) {
                                        let recievingUserMessage = {
                                            'channel': DMchannelRecievingUser,
                                            'text': responses.privateToReciever +
                                            texts.SendMessageUsed +
                                            '_' + message + '_'
                                        };
                                        self.slack.say(recievingUserMessage);
                                    }
                                });
                                // save tip to database for Sun feature
                                sun.incTipCountInDb(user);
                            }
                        });
                    }
                });
                return;
            }
        }

        //     * CONVERT
        if (message.match(/\b(convert|rate|to)\b/i)) {
            let currencies = message.match(self.CURRENCY_REGEX);
            if (currencies === null || currencies.length < 2) {
                reply.text = user.handle + texts.NotEnoughCurrencies;
                self.slack.say(reply);
                return;
            }
            if (currencies.length > 2) {
                reply.text = user.handle + texts.ToMuchCurrencies;
                self.slack.say(reply);
                return;
            }

            amount = message.match(self.AMOUNT_REGEX); // only the number, no currency
            if (amount === null) {
                reply.text = user.name + texts.NoAmountFound;
                self.slack.say(reply);
                return;
            } else if (amount) {
                let fromCurrency = currencies[0].toLowerCase();
                let toCurrency = currencies[1].toLowerCase();
                if (fromCurrency === 'dash') {
                    // Dash -> other
                    self.normalizeValue(amount[1], toCurrency, user, function (value, rate) {
                        if (rate === false) {
                            reply.text = user.handle + texts.UnsupportedCurrency;
                        } else if (!value) {
                            reply.text = user.handle + texts.InvalidAmount;
                        } else {
                            let newValue = rate * amount[1];
                            reply.text = amount[1] + ' ' + fromCurrency + ' = ' + newValue.toPrecision(4) + '  ' + toCurrency +
                                ' ( 1.0 Dash = ' + rate.toPrecision(4) + ' ' + toCurrency + ' )';
                        }
                        self.slack.say(reply);
                    });
                } else if (toCurrency === 'dash') {
                    // other -> dash
                    self.normalizeValue(amount[1], fromCurrency, user, function (value, rate) {
                        if (rate === false) {
                            reply.text = user.handle + texts.UnsupportedCurrency;
                        } else if (!value) {
                            reply.text = user.handle + texts.InvalidAmount;
                        } else {
                            reply.text = amount[1] + ' ' + fromCurrency + ' = ' + toDash(value) + '  ' + toCurrency +
                                ' ( 1.0 ' + fromCurrency + ' = ' + (1.0 / rate).toPrecision(4) + ' DASH)';
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
                self.tellPrice(currency, function (err, response) {
                    if (err) {
                        debug('ERROR reading price information for ' + currency);
                        return;
                    }
                    // tell where price is pulled from
                    reply.text = response + '\n' + texts.PriceInfoFrom;
                    self.slack.say(reply);
                    return;
                });
            } else {
                // no currency provided, show short list in channel where command was issued
                self.showPriceList(channel, false);
            }
            return;
        }

        //     * PRICE TICKER
        if (message.match(/\bpriceticker\b/i)) {
            let tellChannel = self.OPTIONS.PRICETICKER_CHANNEL;
            if (self.OPTIONS.PRICETICKER_CHANNEL === undefined) {
                reply.text = 'ERROR don\'t know in which channel I need to post the priceticker';
                self.slack.say(reply);
                return;
            }
            // show the pricticker manual
            if (message.match(/\bshort\b/i)) {
                // short list
                self.showPriceList(tellChannel, false);
            } else {
                // show all currencies in the dedicated channel to prevent wall of text in other channels
                self.showPriceList(tellChannel, true);
                // inform the user about its location
                privateReply.text = texts.LocationOfPriceList1 + self.OPTIONS.PRICETICKER_CHANNEL.name + texts.LocationOfPriceList2;
                self.slack.say(privateReply);
            }
            return;
        }

        //     * LIST CURRENCIES
        if (message.match(/\bcurrencies\b/i)) {
            reply.text = texts.CurrenciesTitle +
                texts.SupportedCurrenciesFull + self.SUPPORTED_CURRENCIES.join(', ') + '\n' +
                texts.SupportedSymbols + self.CURRENCIES.join(', ') + '* \n' +
                texts.SupportedBase;
            self.slack.say(reply);
            return;
        }

        //    * HELP
        if (message.match(/\bhelp\b/i)) {
            self.getDirectMessageChannelID(channel, user.id, function (err, DMchannelID) {
                if (err === null) {
                    reply.channel = DMchannelID;
                    reply.text = self.tellHelp(user.is_admin);
                    self.slack.say(reply);
                }
            });
            return;
        }

        //   * RAIN (replaced by SUN)
        if (message.match(/\brain\b/i)) {
            reply.text = texts.RainReplacedBySun;
            self.slack.say(reply);
            return;
        }

        //   * SUN (reward to users that have tipped others)
        if (message.match(/\bsun\b/i)) {

            // all users can check the balance of the Sun Account
            // get Sun User for OPTIONS
            if (self.sunUser === undefined || self.sunUser === null) {
                reply.text = texts.SunCannotFindSunAccount1 + self.OPTIONS.SUN_USERNAME + texts.SunCannotFindSunAccount2;
                reply.text += texts.SunExplain;
                self.slack.say(reply);
                return;
            }
            // show balance of Sun Account, available to non-admin user
            sun.getSunBalance(self.sunUser, function (err, sunBalance) {
                if (err) {
                    reply.text = texts.SunCannotFindSunBalance + self.OPTIONS.SUN_USERNAME;
                    self.slack.say(reply);
                    return;
                } else {
                    if (sunBalance !== undefined && sunBalance > 2e-8) {
                        reply.text = texts.SunAvailibleAmount + sunBalance + ' dash';
                    } else {
                        reply.text = texts.SunEmpty;
                    }
                    reply.text += '\n' + texts.SunReqDonation1 + self.OPTIONS.SUN_USERNAME + '_';
                    reply.text += '\n' + texts.SunReqDonation2 + self.OPTIONS.SUN_USERNAME + texts.SunReqDonation3;
                    // show amount of eligible users
                    sun.getAmountOfEligibleSunUsers(
                        function (err, count) {
                            if (err) { debug(err); }
                            reply.text += '\n' + count + texts.SunAmountEligibleUsers;
                            self.slack.say(reply);
                        });
                }
            });

            // ADMIN ONLY COMMANDS
            if (user.is_admin) {
                // show Eligible users (ahs tip before)
                if (message.match(/\beligible\b/i)) {
                    sun.getListOfSunEligibleUsers(
                        function (err, allTippers) {
                            if (err) {
                                debug(texts.ERRORreadingDb + err);
                                self.privateReply.text = texts.ERRORreadingDb + ': ' + err;
                                self.slack.say(privateReply);
                            }
                            // show list all tippers
                            privateReply.text = texts.SunEligibleUsersList;
                            allTippers.forEach(function (tipper) {
                                privateReply.text += tipper.name + '(' + tipper.id + ') has tipped ' + tipper.tipCount + ' times.\n';
                            });
                            //  debug(reply.text);
                            self.slack.say(privateReply);
                        });
                }

                // threshold (sun will be cast if amount of sun balance > threshold)
                if (message.match(/\bthreshold\b/i)) {
                    // set new threshold
                    amount = message.match(self.AMOUNT_REGEX); // only the number
                    if (amount !== null) {
                        // amount found in message, set this as the new threshold
                        self.OPTIONS.SUN_THRESHOLD = toDuff(amount[1]);
                        // threshold changed => check balance now
                        self.checkForSun(reply);
                    }
                    //show threshold
                    if (self.OPTIONS.SUN_THRESHOLD !== undefined) {
                        reply.text = texts.SunThreshold1 + toDash(self.OPTIONS.SUN_THRESHOLD) + ' Dash \n';
                        reply.text += texts.SunThreshold2;
                        self.slack.say(reply);
                    } else {
                        // inform admin that no threshold set yet
                        privateReply.text = texts.SunThresholdNotSet;
                        self.slack.say(privateReply);
                    }
                }
            }
            return;
        }

        //  * GET SLACK ID
        if (message.match(/\bgetid\b/i)) {
            if (userMatches.length === 1 && user.is_admin) {
                let mentioned = userMatches[0];
                privateReply.text = 'Slack ID of user ' + mentioned.name + ' = ' + mentioned.id;
                self.slack.say(privateReply);
            } else if (message.match(/\bme\b/i)) {
                privateReply.text = 'Slack ID of user ' + user.name + ' = ' + user.id;
                self.slack.say(privateReply);
            }
            return;
        }

        //  * QUIZ
        if (message.match(/\bquiz\b/i)) {

            // list all approved questions
            if (message.match(/\blist\b/i)) {
                quiz.getApprovedQuestions(function (err, questions) {
                    if (err) { debug('Quiz: ERROR loading questions: ' + err); return; }
                    if (questions.length === 0) {
                        privateReply.text = texts.QuizNoQuestionsYet;
                        self.slack.say(privateReply);
                    } else {
                        let questionsSentence = texts.QuizListQuestions;
                        // show all questions and there number so the can be selected for deletion
                        questions.forEach(function (QandA) {
                            questionsSentence += '*' + QandA.qaNumber + '*: ' +
                                QandA.question + '\n' +
                                //TODO: add currency
                                '\tReward: ' + QandA.reward + '\n';
                        });
                        // tell how to delete a question
                        if (user.is_admin) {
                            questionsSentence += '\n\n' + texts.QuizDeleteQuestion;
                            questionsSentence += '\n' + texts.QuizChangeReward;
                        }
                        privateReply.text = questionsSentence;
                        self.slack.say(privateReply);
                    }
                });
            }
            // show questions that needs reviewing
            if (message.match(/\breview\b/i)) {
                quiz.getUnreviewedQuestions(function (err, questions) {
                    if (err) { debug('Quiz: ERROR loading questions: ' + err); return; }
                    if (questions.length === 0) {
                        privateReply.text = texts.QuizNoQuestionsYet;
                        self.slack.say(privateReply);
                    } else {
                        let questionsSentence = texts.QuizUnreviewed;
                        // show all questions without a reward and there number so the reward can be set
                        questions.forEach(function (QandA) {
                            questionsSentence += QandA.qaNumber + ' ```' +
                                'Q:' + QandA.question + '\n' +
                                'A: ' + QandA.answer + ' ``` ';
                        });
                        // tell how set a reward for a question
                        questionsSentence += '\n\n' + texts.QuizRewardQuestion;
                        privateReply.text = questionsSentence;
                        self.slack.say(privateReply);
                    }
                });
            }
            // start adding question & answer
            if (message.match(/\badd\b/i)) {
                // show question and answer and ask for conformation to add it
                let askConfirmation = function (question, answer, convo) {
                    convo.ask(
                        '```Q:' + question + '\nA: ' + answer + '``` \n' +
                        texts.QuizConfirmNewQA,
                        [
                            {
                                pattern: self.slack.utterances.yes,
                                callback: function (response, convo) {
                                    // save newQ&A to database
                                    quiz.saveNew(question, answer, function (err, qaNumber) {
                                        if (err) {
                                            debug('ERROR saving new quiz question: ' + err);
                                        } else {
                                            privateReply.text = texts.QuizSavedToDb;
                                            self.slack.say(privateReply);
                                            debug('Quiz question ' + qaNumber + 'is added.');
                                        }
                                    });
                                    convo.next();
                                }
                            },
                            {
                                pattern: self.slack.utterances.no,
                                callback: function (response, convo) {
                                    privateReply.text = texts.QuizAbortedSaving;
                                    self.slack.say(privateReply);
                                    convo.next();
                                }
                            }
                        ]);
                };
                // ask for answer
                let askAnswer = function (question, convo) {
                    convo.ask(texts.QuizAddAnser, function (answer, convo) {
                        askConfirmation(question, answer.text, convo);
                        convo.next();
                    });
                };
                // ask for question
                let askQuestion = function (err, convo) {
                    if (err) {
                        debug('ERROR cannot start conversation to add a quiz question & answer: ' + err);
                        return;
                    }
                    convo.ask(texts.QuizAddQuestion, function (question, convo) {
                        askAnswer(question.text, convo);
                        convo.next();
                    });
                };
                let privateConversation = { user: user.id };
                self.slack.startPrivateConversation(privateConversation, askQuestion);

            }
            // delete a question and answer
            if (message.match(/\bdelete\b/i)) {
                let questionNumber = message.match(/\d+/i);
                if (questionNumber === null) {
                    privateReply.text = texts.QuizNoQAnumber;
                    self.slack.say(privateReply);
                    return;
                }
                quiz.deleteQuestion(questionNumber, function (err) {
                    if (err) {
                        debug('ERROR deleting question ' + questionNumber + ': ' + err);
                        privateReply.text = texts.QuizDeleteNOK + questionNumber;
                        self.slack.say(privateReply);
                        return;
                    } else {
                        privateReply.text = texts.QuizDeleteOk;
                        self.slack.say(privateReply);
                        debug('Quiz question ' + questionNumber + ' is deleted.');
                    }

                });
            }
            // set reward (aka approve a question)
            if (message.match(/\breward\b/i)) {
                let questionNumber = message.match(/\d+/i);
                if (questionNumber === null || questionNumber.length !== 1) {
                    privateReply.text = texts.QuizNoQAnumber;
                    self.slack.say(privateReply);
                    return;
                }
                questionNumber = parseInt(questionNumber[0]);
                quiz.getQuestion(questionNumber, function (err, question) {
                    if (err) {
                        debug('ERROR getting question number: ' + questionNumber + ': ' + err);
                        privateReply.text = texts.QuizNoQAnumber;
                        self.slack.say(privateReply);
                        return;
                    }
                    if (question === null) {
                        privateReply.text = texts.QuizNoQAnumber;
                        self.slack.say(privateReply);
                        return;
                    }

                    let privateConversation = { user: user.id };
                    self.slack.startPrivateConversation(privateConversation, function (err, convo) {
                        let askSentence = '_' + question.question + '_\n' + texts.QuizSetReward;
                        convo.ask(askSentence, function (response, convo) {
                            let reward = parseFloat(response.text);
                            if (reward === undefined) {
                                privateReply.text = texts.QuizSetRewardNoAmountFound;
                                self.slack.say(privateReply);
                            } else {
                                quiz.setReward(questionNumber, reward, function (err) {
                                    if (err) {
                                        debug('ERROR setting reward for quiz question number ' + questionNumber + ' to ' + reward + ': ' + err);
                                        return;
                                    }
                                    privateReply.text = texts.QuizSetRewardOk;
                                    self.slack.say(privateReply);
                                    debug('Reward for quiz question number ' + questionNumber + ' is set to ' + reward);
                                });

                            }
                            convo.next();
                        });

                    });
                });
            }

            // start a quiz
            if (message.match(/\bstart\b/i)) {
                quiz.start(function (err, result) {
                    if (err) {
                        debug('ERROR starting quiz: ' + err);
                        reply.text = texts.QuizErrorStarting + err;
                        self.slack.say(reply);
                        return;
                    }
                    reply.text = result + '\n' + texts.QuizStarted1;
                    //TODO decide of a dedicated quiz channel is needed (private & payed enterance ?)
                    //                    reply.text += QuizStarted2 + self.OPTIONS.QuizChannel.name + QuizStarted3;
                    self.slack.say(reply);
                });
            }
            // end a quiz
            if (message.match(/\end\b/i)) {
                reply.text = texts.QuizEnded;

                // get correct answers
                let showAnswers = () => {
                    quiz.showCorrectAnswers(function (err, QAs) {
                        if (err) { debug('ERROR cannot get correct quiz answers: ' + err); }
                        reply.text += '\n' + texts.QuizShowCorrectAnswers;
                        reply.text += QAs;
                    });
                };

                // get scores
                quiz.end(function (scores) {
                    let quizScoreText = '';
                    _.forEach(scores, (score, username) => {
                        let scoreText = username + ' scored ' + score + '\n';
                        debug(scoreText);
                        quizScoreText += scoreText;
                    });
                    // show complete scores
                    reply.text += quizScoreText;
                    // show correct answers
                    showAnswers();
                });
                reply.text += texts.QuizThanks;
                self.slack.say(reply);
            }
            // abort a quiz (normaly not used)
            if (message.match(/\abort\b/i)) {
                quiz.abort();
                reply.text = texts.QuizAborted;
                self.slack.say(reply);
            }

            //ask for a question in a running quiz
            if (message.match(/\banswer\b/i)) {
                // ask  question
                let askQuizQuestion = function (err, convo) {
                    if (err) {
                        debug('ERROR cannot start conversation to tell a quiz question: ' + err);
                        return;
                    }
                    quiz.askQuestion(user.name, function (err, question) {
                        if (err) { debug('ERROR cannot tell a quiz question to user:' + user.name + ': ' + err); }
                        else {
                            convo.ask(question, function (answer, convo) {
                                quiz.recordAnswer(user.name, answer.text, function (err, done) {
                                    if (err) { debug('ERROR cannot record the quiz answer for user:' + user.name + ' :' + err); }
                                    debug('Quiz: ' + user.name + ' answered a question.');
                                    if (!done) {
                                        // ask next question
                                        askQuizQuestion(null, convo);
                                    }
                                    else { // aswered all questions = done
                                        privateReply.text = texts.QuizDone;
                                        self.slack.say(privateReply);
                                    }
                                });
                                convo.next();
                            });
                        }
                    });
                };
                // start asking questions in private channel
                let privateConversation = { user: user.id };
                self.slack.startPrivateConversation(privateConversation, askQuizQuestion);
            }
            return;
        }
        //  * OOPS
        let amountOfPossibleResponds = texts.NoCommandFound.length;
        let randomRespons = Math.floor((Math.random() * amountOfPossibleResponds) + 1);
        if (texts.NoCommandFound[randomRespons] === undefined) {
            randomRespons = 'Unknow helptext (Nr: ' + randomRespons / amountOfPossibleResponds + ')';
        } else {
            reply.text = '>>>' + texts.NoCommandFound[randomRespons];
            reply.text += '\n' + texts.Oops;
        }
        self.slack.say(reply);
        return;
    });

    return;
};

module.exports = TipBot;
