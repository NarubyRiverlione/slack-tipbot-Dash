'use strict';

let _ = require('lodash');
let debug = require('debug')('tipbot:tipbot');
let async = require('async');
let request = require('request');
let User = require('./user');
let path = require('path');
let fs = require('fs');
let nexusd = require('bitcoin');
let texts = require('../text/txt_nexus.js').tipbotTxt;
let sun; // only required if ENABLE_SUN_FEATURE

let waits = require('waitjs');
let coin = require('./coin');

const CYBERCURRENCY = 'nexus';
const BLACKLIST_CURRENCIES = [CYBERCURRENCY];

let TipBot = function (bot, RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS) {
  let self = this;
  if (!bot) { throw new Error('Connection with Slack not availible for tipbot'); }

  self.HighBalanceWarningMark = coin.toSmall(10.0);

  self.initializing = false;

  self.users = {};

  self.slack = bot;
  self.sunUser = null;

  // default options
  self.OPTIONS = _.defaults(OPTIONS, {
    TMP_DIR: path.resolve(__dirname, '../tmp'),
    ALL_BALANCES: false,// default admins cannnot see all balances
    OTHER_BALANCES: false,  // default admins cannot see a balance of an other specific user
    WARN_MODS_NEW_USER: false,
    WARN_MODS_USER_LEFT: false,
    TX_FEE: coin.toSmall(0.0001), // TX fee, used in withdrawing, in Duffs
    WALLET_PASSW: null,

    PRICE_UPDATE_EVERY: 30, // minuts

    SUN_USERNAME: null,
    SUN_SEND_THROTTLE: 1250, // ms wait between sunrays to cast (prevent slack spam protection)
    SUN_TIMER: 30, // check sun balance > threshold every X minutes
    SUN_DEFAULT_THRESHOLD: coin.toSmall(5) // duff
  });

  // create connection via RPC to wallet
  self.wallet = new nexusd.Client({
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

  self.CURRENCY_REGEX = new RegExp('\\b(duff?|' + CYBERCURRENCY + '|' + self.CURRENCIES.join('|') + ')\\b', 'ig'); // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

  self.AMOUNT_REGEX = new RegExp('\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+)(?:\\s|$)');
  self.AMOUNT_OR_ALL_REGEX = new RegExp('\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+|all)(?:\\s|$)');

  self.ADDRESS_REGEX = new RegExp('[2|y][a-zA-Z0-9]{25,50}', 'g');

  self.DUMMY_USERS_REGEX = new RegExp('.*[.]$', 'ig');

  // get the fiat prices
  self.getPriceRates(function (err, rates) {
    self.CURRENCIES = [];

    for (let rate in rates) {
      if (BLACKLIST_CURRENCIES.indexOf(rate) === -1) {
        self.CURRENCIES.push(rate);
      }
    }
    self.CURRENCY_REGEX = new RegExp('\\b(duff?|' + CYBERCURRENCY + '|' + self.CURRENCIES.join('|') + ')\\b', 'ig'); // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)
  });

  if (self.OPTIONS.ENABLE_SUN_FEATURE) {
    sun = require('./sun');
  }

  // Init tipbot
  self.init();
};


// get a price of a currency pair
TipBot.prototype.tellPrice = function (currency, cb) {
  let self = this;
  self.getPriceRates(function (err, rates) {
    if (err || rates === undefined) {
      debug('ERROR: getting rate for ' + currency + ': ' + err);
      cb(err);
      return;
    }
    let rate = Number(rates[currency]);
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
      cb(err);
    }
    if (rates !== undefined) {
      // vanity currencies
      /*
      rates.ml = 1.0 / 1.2;
      rates.mile = 1.0 / 16.0;
      rates.oz = 1.0 / 36.0;
      rates.tsp = 1.0 / 6.0;
*/
      if (rates.eur) {
        rates['€'] = rates.eur;
        rates.euro = rates.eur;
      }
      if (rates.usd) {
        rates.dollar = rates.usd;
      }

      cb(null, rates);
    }
  });
};

// remove price cache files older then 1 hour
TipBot.prototype.clearPriceRatesCache = function (cacheDir, cb) {
  let self = this;

  fs.readdir(cacheDir, function (err, files) {
    async.forEach(files, function (file, cb) {
      if (file !== '.gitignore') {
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
      }
    }, function (err) {
      cb(err);
    });
  });
};

// read current cached file (not older then PRICE_UPDATE_EVERY minuts) or download a new one from coinmarketcap
// return price info as object via the callback (err, rates)
TipBot.prototype._getPriceRates = function (filename, cb) {
  fs.exists(filename, function (exists) {
    if (exists) {
      fs.readFile(filename, 'utf8', function (err, data) {
        if (err) {
          return cb(err);
        }

        cb(null, JSON.parse(data));
      });
    } else {
      request.get('http://coinmarketcap-nexuist.rhcloud.com/api/nxs/price', function (err, response, body) {
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
  // check for dummy users
  if (user.name.match(self.DUMMY_USERS_REGEX)) {
    debug('Found dummy user ! ' + user.name);
    if (self.OPTIONS.WARN_MODS_CHANNEL) {
      let newDummyUserMsg = {
        channel: self.OPTIONS.WARN_MODS_CHANNEL.id,
        text:
        texts.FoundDummyUser1 +
        user.name +
        texts.FoundDummyUser2
      };
      self.slack.say(newDummyUserMsg);
    }
  }
  else {
    self.users[user.id] = user;
    if (updateRegex) {
      self.updateUserRegex();
    }

    // warn admins that new users has arrived, only when not initializing the tipbot
    if (self.OPTIONS.WARN_MODS_NEW_USER && self.OPTIONS.WARN_NEW_USER_CHANNEL !== undefined && !self.initializing) {
      let newUserMsg = {
        channel: self.OPTIONS.WARN_NEW_USER_CHANNEL.id,
        text:
        texts.WarningNewUser1 +
        user.name +
        texts.WarningNewUser2
      };
      self.slack.say(newUserMsg);
    }
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
    if (self.OPTIONS.WARN_MODS_USER_LEFT && self.OPTIONS.WARN_USER__LEFT_CHANNEL !== undefined && !self.initializing) {
      let userLeftMsg = {
        channel: self.OPTIONS.WARN_USER__LEFT_CHANNEL.id,
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
        // debug(member.name + '(' + member.id + ') =  ' + member.profile.email);
        self.updateUserFromMember(member, false);
        cb();
      },
      function (err) {
        if (err) {
          debug('ERROR Init: ', err);
        }

        self.updateUserRegex();

        // get Sun user
        if (self.OPTIONS.ENABLE_SUN_FEATURE) {
          self.sunUser = sun.init(self.OPTIONS.SUN_USERNAME, self.users);
        }

        // Done !
        debug('I am <@%s:%s> of %s', self.slack.identity.id, self.slack.identity.name, self.slack.team_info.name);
        debug('***** TipBot ready! *****');
        // debug('We have the following . + Object.keys(self.users).length +  known users; ', _.map(self.users, function(user) {
        // return user.name;
        // }).join(', '));

        self.initializing = false;
      });

  });

};

// convert currency if needed,
// return via callback amount in CYBERCURRENCY, and if it was needed to convertion rate and originalCurrency
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
      let value = coin.toSmall(balance);
      debug('Log: using ALL balance of ' + user.name + ' = ' + balance);
      cb(value, null, null, null, coin.toLarge(value) + ' ' + CYBERCURRENCY);
    });

  } else {
    // no 'all', evaluate the unit
    if (unit.match(/duff?/i)) {
      currency = CYBERCURRENCY;
      value = parseInt(inputValue);
    } else if (unit.match(/nexus/i)) {
      currency = CYBERCURRENCY;
      value = coin.toSmall(inputValue);
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
  if (currency !== CYBERCURRENCY) {
    // check if a price update is needed
    self.getPriceRates(function (err, rates) {
      let rate = rates[currency];
      debug('Rate for ' + currency + ' = ' + rate);
      if (!rate) {
        return cb(false, false, currency, value);
      } else {
        let newValue = Math.ceil(value / rate * 1e8);

        let text = value.toFixed(2) + ' ' + currency + ' ' +
          '(' + coin.toLarge(newValue) + ' ' + CYBERCURRENCY + ' at ' + rate.toFixed(2) + ' ' + currency + ' / ' + CYBERCURRENCY + ')';
        // return converted value in CYBERCURRENCY,  convertion rate, originalCurrency, originalValue, text about the convertion
        return cb(newValue, rate, currency, value, text);
      }
    });
  } else {
    // amount is in CYBERCURRENCY, return only value, no convertion rate
    return cb(value, null, null, null, coin.toLarge(value) + ' ' + CYBERCURRENCY + '');
  }
};

// tell all help text, if call by an admin show also the admin-only commands
TipBot.prototype.tellHelp = function (is_admin) {
  var self = this;
  let text = _.reduce(texts.helpText, function (completeHelpText, helpPart) {
    return completeHelpText + helpPart + '\n';
  }, '');
  if (self.OPTIONS.ENABLE_SUN_FEATURE) {
    text += self.texts.help_sun;
  }

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
  getHelpNR = getHelpNR === 0 ? 1 : getHelpNR; // don\'t show title
  let helpTxt = texts.helpText[getHelpNR].replace(/[*]/g, '').replace(/[_]/g, ''); // * for bold doesn't show in a code block
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
  if (sun !== undefined) {
    sun.checkThreshold(self.OPTIONS.SUN_DEFAULT_THRESHOLD, self.sunUser,
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
              waits.wait(self.OPTIONS.SUN_SEND_THROTTLE, function () {
                // ignore all response to prevent wall of text in public, sender = sun User = not usefull to inform
                // custom message to reciever:
                self.getDirectMessageChannelID(null, oneUser.id, function (err, DMchannelRecievingUser) {
                  if (err === null) {
                    // send private message to lucky user
                    let recievingUserMessage = {
                      'channel': DMchannelRecievingUser,
                      'text': texts.SunRecieved + coin.toLarge(sunraySize) + ' ' + CYBERCURRENCY + ''
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
  }
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

    // * BALANCE
    if (message.match(/\bbalance\b/i)) {
      let balanceOfUser = user; // default show own balance (see balance check cmd)

      // * ALL BALANCES (admin only, needs to be enabled via OPTIONS.ALL_BALANCES)
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
          privateReply.text = err;
          self.slack.say(privateReply);
        } else {
          privateReply.text = line;
          self.slack.say(privateReply);
        }
      });

      return;
    }

    // * DEPOSIT
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

    // * WITHDRAW
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
        //not provided, set CYBERCURRENCY as default currency
        amount[2] = CYBERCURRENCY;
      }
      // no amount
      if (!amount) {
        reply.text = 'Sorry ' + user.handle + texts.NoAmountOrCurrency;
        self.slack.say(reply);
        return;
      }
      // convert amount if currency isn't CYBERCURRENCY
      self.normalizeValue(amount[1], amount[2], user, function (value, rate, originalCurrency, originalValue, valueText) {
        if (rate === false) {
          reply.text = user.handle + texts.UnsupportedCurrency;
          self.slack.say(reply);
          return;
        }
        if (!value) {
          reply.text = user.handle + texts.InvalidAmount;
          self.slack.say(reply);
          return;
        }

        let address = message.match(self.ADDRESS_REGEX);
        if (address.length > 1) {
          reply.text = 'Sorry ' + user.handle + texts.MoreThen1Address + ' [' + address.join(', ') + ']';
          self.slack.say(reply);
          return;
        }

        address = _.uniq(address)[0];

        if (!address) {
          // no address
          reply.text = 'Sorry ' + user.handle + texts.NoAddress;
          self.slack.say(reply);
          return;
        }

        user.validateAddress(address,
          (err, info) => {
            if (err) {
              reply.text = 'Sorry ' + user.handle + texts.NoValidAddress + ': ' + err;
              self.slack.say(reply);
              return;
            }
            debug(info);
            if (info.isvalid === false) {
              reply.text = 'Sorry ' + user.handle + texts.NoValidAddress;
              self.slack.say(reply);
              return;
            }

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
                      user.withdraw(value, address, self.OPTIONS.WALLET_PASSW, function (err, response) {
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
          });
        return;
      });
    }

    // * SEND / TIP
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
          //not provided, set CYBERCURRENCY as default currency
          amount[2] = CYBERCURRENCY;
        }
        // convert if currency isn't CYBERCURRENCY
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
                      '_' + message + '_' + '\n' +
                      // explain how to withdraw
                      texts.helpText[4]
                    };
                    self.slack.say(recievingUserMessage);
                  }
                });
                // save tip to database for Sun feature
                if (self.OPTIONS.ENABLE_SUN_FEATURE) { sun.incTipCountInDb(user); }
              }
            });
          }
        });
        return;
      }
    }
    // 	* CONVERT
    if (message.match(/\b(convert|rate)\b/i)) {
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
        if (fromCurrency === CYBERCURRENCY) {
          // CYBERCURRENCY -> other
          self.normalizeValue(amount[1], toCurrency, user, function (value, rate) {
            if (rate === false) {
              reply.text = user.handle + texts.UnsupportedCurrency;
            } else if (!value) {
              reply.text = user.handle + texts.InvalidAmount;
            } else {
              let newValue = rate * amount[1];
              reply.text = amount[1] + ' ' + fromCurrency + ' = ' + newValue.toPrecision(4) + '  ' + toCurrency +
                ' ( 1.0 ' + CYBERCURRENCY + ' = ' + rate.toPrecision(4) + ' ' + toCurrency + ' )';
            }
            self.slack.say(reply);
          });
        } else if (toCurrency === CYBERCURRENCY) {
          // other -> CYBERCURRENCY
          self.normalizeValue(amount[1], fromCurrency, user, function (value, rate) {
            if (rate === false) {
              reply.text = user.handle + texts.UnsupportedCurrency;
            } else if (!value) {
              reply.text = user.handle + texts.InvalidAmount;
            } else {
              reply.text = amount[1] + ' ' + fromCurrency + ' = ' + coin.toLarge(value) + '  ' + toCurrency +
                ' ( 1.0 ' + fromCurrency + ' = ' + (1.0 / rate).toPrecision(4) + ' ' + CYBERCURRENCY + ')';
            }
            self.slack.say(reply);
          });
        }
      }

      return;
    }

    // 	* PRICE
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

    // 	* PRICE TICKER
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

    // 	* LIST CURRENCIES
    if (message.match(/\bcurrencies\b/i)) {
      reply.text = texts.CurrenciesTitle +
        texts.SupportedCurrenciesFull + self.SUPPORTED_CURRENCIES.join(', ') + '\n' +
        texts.SupportedSymbols + self.CURRENCIES.join(', ') + '* \n' +
        texts.SupportedBase;
      self.slack.say(reply);
      return;
    }

    //	* HELP
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

    //  * RAIN (replaced by SUN)
    if (message.match(/\brain\b/i)) {
      reply.text = texts.RainReplacedBySun;
      self.slack.say(reply);
      return;
    }

    //  * SUN (reward to users that have tipped others)
    if (self.OPTIONS.ENABLE_SUN_FEATURE && message.match(/\bsun\b/i)) {

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
            reply.text = texts.SunAvailibleAmount + sunBalance + ' ' + CYBERCURRENCY + '';
          } else {
            reply.text = texts.SunEmpty;
          }
          reply.text += '\n' + texts.SunReqDonation1 + self.OPTIONS.SUN_USERNAME + '_';
          reply.text += '\n' + texts.SunReqDonation2 + self.OPTIONS.SUN_USERNAME + texts.SunReqDonation3;
          // show threshold
          sun.getThreshold(self.OPTIONS.SUN_DEFAULT_THRESHOLD, function (err, threshold) {
            if (err) { debug(err); return; }
            reply.text += '\n' + texts.SunThreshold1 +
              coin.toLarge(threshold) + ' ' + CYBERCURRENCY + ' \n' +
              texts.SunThreshold2;
            // show amount of eligible users
            sun.getAmountOfEligibleSunUsers(
              function (err, count) {
                if (err) { debug(err); }
                reply.text += '\n' + count + texts.SunAmountEligibleUsers;
                self.slack.say(reply);
              });
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
            // amount found in message, save this as the new threshold
            sun.saveThreshold(coin.toSmall(amount[1]),
              function (err) {
                if (err) {
                  debug(err); return;
                } else {
                  debug('New Sun threshold saved as ' + amount[1] + ' by ' + user.name);
                }
                // //show new threshold
                // sun.getThreshold(self.OPTIONS.SUN_DEFAULT_THRESHOLD,
                // function (err, threshold) {
                //     if (err) { debug(err); return; }
                //     reply.text += '\n' + texts.SunThreshold1 +
                //         coin.toLarge(threshold) + ' CYBERCURRENCY \n' +
                //         texts.SunThreshold2;
                //     self.slack.say(reply);
                // });
                // threshold changed => check balance now
                self.checkForSun(reply);
              });
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
