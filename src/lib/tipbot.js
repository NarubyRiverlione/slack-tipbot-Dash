'use strict'
/*  global wait */
const _ = require('lodash')
const debug = require('debug')('tipbot:tipbot')
const async = require('async')
const request = require('request')
const base58check = require('base58check')
const path = require('path')
const fs = require('fs')
require('waitjs')

import User from './user.js'
import Wallet from './wallet.js'
import { tipbotTxt } from '../text/txt_dash.js'
import * as  Coin from './coin.js'

let rain // only required if ENABLE_RAIN_FEATURE

const CYBERCURRENCY = 'DASH'  // upper case for compare
const BLACKLIST_CURRENCIES = [CYBERCURRENCY]

let TipBot = function (bot, RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS) {
  let self = this
  if (!bot) { throw new Error('Connection with Slack not availible for tipbot') }

  const HighBalanceWarningMark = Coin.toSmall(1.0)

  self.initializing = false

  self.users = {}

  self.slack = bot
  self.rainUser = null
  // 
  // default options
  self.OPTIONS = _.defaults(OPTIONS, {
    TMP_DIR: path.resolve(__dirname, '../../tmp'),
    ALL_BALANCES: false,// default admins cannnot see all balances
    OTHER_BALANCES: false,  // default admins cannot see a balance of an other specific user
    WARN_MODS_NEW_USER: false,
    WARN_MODS_USER_LEFT: false,
    TX_FEE: Coin.toSmall(0.0001), // TX fee, used in withdrawing, in Duffs
    WALLET_PASSW: null,

    PRICE_UPDATE_EVERY: 30, // minuts

    RAIN_USERNAME: null,
    RAIN_SEND_THROTTLE: 1250, // ms wait between rainrays to cast (prevent slack spam protection)
    RAIN_TIMER: 30, // check rain balance > threshold every X minutes
    RAIN_DEFAULT_THRESHOLD: Coin.toSmall(0.5) // duff
  })

  self.wallet = new Wallet(RPC_PORT, RPC_USER, RPC_PASSWORD, HighBalanceWarningMark, self.OPTIONS.TX_FEE)

  // will be updated with all available currencies when API call is done
  self.CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'CAD', 'RUB', 'HKD', 'JPY', 'AUD', 'btc']
  self.SUPPORTED_CURRENCIES = ['US Dollar, Euro, British pound', 'Chinese yuan ', 'Canadian Dollar', 'Russian Ruble', 'Hong Kong dollar', 'Japanese yen', 'Australian Dollar', 'Bitcoin']
  // the currencies that will has there price showed every x time
  self.LIST_PRICES = ['USD', 'EUR', 'GBP', 'BTC']

  self.CURRENCY_REGEX = new RegExp('\\b(duff?|' + CYBERCURRENCY + '|' + self.CURRENCIES.join('|') + ')\\b', 'ig') // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

  self.AMOUNT_REGEX = new RegExp('\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+)(?:\\s|$)')
  self.AMOUNT_OR_ALL_REGEX = new RegExp('\\s(\\d+\\.\\d{1,8}|\\.\\d{1,8}|\\d+|all)(?:\\s|$)')

  self.ADDRESS_REGEX = new RegExp('[X|y][a-zA-Z0-9]{25,36}', 'g')

  self.DUMMY_USERS_REGEX = new RegExp('.*[.]$', 'ig')

  // get the fiat prices
  self.getPriceRates()
    .then(rates => {
      self.CURRENCIES = []

      for (let rate in rates) {
        if (BLACKLIST_CURRENCIES.indexOf(rate) === -1) {
          self.CURRENCIES.push(rate)
        }
      }
      self.CURRENCY_REGEX = new RegExp('\\b(duff?|' + CYBERCURRENCY + '|' + self.CURRENCIES.join('|') + ')\\b', 'ig') // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)
    })
    .catch(err => { debug('ERROR: Init : getting rates : ' + err) })

  if (self.OPTIONS.ENABLE_RAIN_FEATURE) {
    rain = require('./rain')
  }
  // Init tipbot
  self.init()
}

// get a price of a currency pair
TipBot.prototype.tellPrice = function (currency) {
  let self = this
  return new Promise(
    (resolve, reject) => {
      self.getPriceRates()
        .then(rates => {
          let rate = rates[currency]
          if (!rate) {
            reject(tipbotTxt.UnsupportedCurrency)
          } else {
            resolve(tipbotTxt.PriceBase + rate.toPrecision(4) + ' ' + currency)
          }
        })
        .catch(err => {
          debug('ERROR: getting rate for ' + currency + ': ' + err)
          return reject(err)
        })
    })
}

// show prices of all currencies listed in LIST_PRICES
TipBot.prototype.showPriceList = function (tellInChannel, all) {
  let self = this
  let reply = { 'channel': tellInChannel.id, text: '' }
  // show all currencies of only the short list ?
  let priceList = (all ? self.CURRENCIES : self.LIST_PRICES)
  debug('Pricelist: show ' + priceList.length + ' currency pairs in ' + tellInChannel.name)

  var promises = []
  priceList.forEach(currency => {
    debug('get rate of ' + currency)
    let getRate = (currency => {
      return new Promise(
        (resolve, reject) => {
          self.tellPrice(currency.toLowerCase())
            .then(response => { reply.text += response + '\n'; resolve() })
            .catch(err => { reject(err) })
        })
    })
    debug(getRate)
    promises.push(getRate)
  }, this)

  Promise.all(promises)
    .then(() => {
      reply.text += tipbotTxt.PriceInfoFrom
      self.slack.say(reply)
    })
    .catch(err => {
      reply.text += err
      self.slack.say(reply)
    })
  /*
    async.forEach(priceList,
      function (currency, callback) {
        self.tellPrice(currency.toLowerCase())
          .then(respone => {
            reply.text += respone + '\n'
            callback()
          })
          .catch(err => {
            callback(err); return
          })
      },
      function (err) {
        // add  where price information is pulled from
        if (err) { debug(err); return }
        reply.text += tipbotTxt.PriceInfoFrom
        self.slack.say(reply)
      }
    )
    */
}

// get new price cache file and remove old then PRICE_UPDATE_EVERY minutes
// return via callback the error(null) and current price information
TipBot.prototype.getPriceRates = function () {
  let cacheDir = path.resolve(this.OPTIONS.TMP_DIR, 'rates')
  let timeBucket = Math.floor((new Date()).getTime() / 1000 / 60) * this.OPTIONS.PRICE_UPDATE_EVERY
  let filename = cacheDir + '/rates.cache.' + timeBucket + '.json'

  return new Promise(
    (resolve, reject) => {
      // fire and forget
      // remove files older then PRICE_UPDATE_EVERY minuts
      this.clearPriceRatesCache(cacheDir, function (err) {
        if (err) { debug(err) }
      })

      // read current file (not older then PRICE_UPDATE_EVERY minuts) or download a new one
      // return 'rates' with price data as object
      // add manual 'fun' units to rates
      this._getPriceRates(filename, function (err, rates) {
        if (err) { return reject(err) }
        if (rates !== undefined) {
          // vanity currencies
          rates.beer = rates.eur / 1.6
          rates.pie = rates.eur / 3.0
          rates.coffee = rates.eur

          if (rates.eur) {
            rates['€'] = rates.eur
            rates.euro = rates.eur
          }
          if (rates.usd) {
            rates.dollar = rates.usd
          }

          resolve(rates)
        }
      })
    })
}

// remove price cache files older then 1 hour
TipBot.prototype.clearPriceRatesCache = function (cacheDir, cb) {
  let self = this

  fs.readdir(cacheDir, function (err, files) {
    async.forEach(files, function (file, cb) {
      if (file !== '.gitignore') {
        fs.stat(path.join(cacheDir, file), function (err, stat) {
          let endTime, now
          if (err) {
            return cb(err)
          }

          now = new Date().getTime()
          // time of file + timeout = endTime that file is usefull
          endTime = new Date(stat.ctime).getTime() + 60 * 1000 * self.OPTIONS.PRICE_UPDATE_EVERY
          // are we passed the endTime of the file ?
          if (now > endTime) {
            return fs.unlink(path.join(cacheDir, file), function (err) {
              if (err) {
                return cb(err)
              }

              cb()
            })
          } else {
            return cb()
          }
        })
      }
    }, function (err) {
      cb(err)
    })
  })
}

// read current cached file (not older then PRICE_UPDATE_EVERY minuts) or download a new one from coinmarketcap
// return price info as object via the callback (err, rates)
TipBot.prototype._getPriceRates = function (filename, cb) {
  fs.exists(filename, function (exists) {
    if (exists) {
      fs.readFile(filename, 'utf8', function (err, data) {
        if (err) {
          return cb(err)
        }

        cb(null, JSON.parse(data))
      })
    } else {
      request.get('http://coinmarketcap-nexuist.rhcloud.com/api/dash/price', function (err, response, body) {
        fs.writeFile(filename, body, function (err) {
          if (err) {
            return cb(err)
          }

          cb(null, JSON.parse(body))
        })
      })
    }
  })
}

// add a Slack user to the list of users (key = user.id)
TipBot.prototype.addUser = function (user, updateRegex) {
  let self = this

  if (typeof updateRegex === 'undefined') {
    updateRegex = true
  }
  // // check for dummy users
  // if (user.name.match(self.DUMMY_USERS_REGEX)) {
  //   debug('Found dummy user ! ' + user.name);
  //   if (self.OPTIONS.WARN_MODS_CHANNEL) {
  //     let newDummyUserMsg = {
  //       channel: self.OPTIONS.WARN_MODS_CHANNEL.id,
  //       text:
  //       tipbotTxt.FoundDummyUser1 +
  //       user.name +
  //       tipbotTxt.FoundDummyUser2
  //     };
  //     self.slack.say(newDummyUserMsg);
  //   }
  // }
  // else {
  self.users[user.id] = user
  if (updateRegex) {
    self.updateUserRegex()
  }

  // warn admins that new users has arrived, only when not initializing the tipbot
  if (self.OPTIONS.WARN_MODS_NEW_USER && self.OPTIONS.WARN_NEW_USER_CHANNEL !== undefined && !self.initializing) {
    let newUserMsg = {
      channel: self.OPTIONS.WARN_NEW_USER_CHANNEL.id,
      text:
      tipbotTxt.WarningNewUser1 +
      user.name +
      tipbotTxt.WarningNewUser2
    }
    self.slack.say(newUserMsg)
  }
  // }
}

TipBot.prototype.updateUserFromMember = function (member, updateRegex) {
  let self = this

  if (typeof updateRegex === 'undefined') {
    updateRegex = true
  }

  if (self.users[member.id] && member.deleted) {
    delete self.users[member.id]
  }

  if (member.deleted || member.is_bot) {
    // warn admins that  users has left, only when not initializing the tipbot
    if (self.OPTIONS.WARN_MODS_USER_LEFT && self.OPTIONS.WARN_USER__LEFT_CHANNEL !== undefined && !self.initializing) {
      let userLeftMsg = {
        channel: self.OPTIONS.WARN_USER__LEFT_CHANNEL.id,
        text: tipbotTxt.WarnUserLeft1 +
        member.name +
        tipbotTxt.WarnUserLeft2
      }
      self.slack.say(userLeftMsg)
    }
    return
  }

  if (self.users[member.id]) {
    // existing user = has updated profile or account
    self.users[member.id].updateFromMember(member)
    if (updateRegex) {
      self.updateUserRegex()
    }
  } else {
    // new user
    const newUser = new User(member)
    self.addUser(newUser, updateRegex)
  }
}

/**
 * create a regex that matches any of the user IDs
 */
TipBot.prototype.updateUserRegex = function () {
  let self = this

  let ids = _.reject(_.map(self.users, 'id'), function (id) {
    return id === self.slack.identity.id
  })

  self.userRegex = new RegExp('(' + ids.join('|') + ')', 'g')
}

// open a Direct Message channel to talk to an user, return channelID
TipBot.prototype.getDirectMessageChannelID = function (channel, userID) {
  let self = this
  return new Promise(
    (resolve, reject) => {
      // check if already in a DM channel
      if (channel !== null && channel.id !== undefined) {
        let firstCharOfChannelID = channel.id.substring(0, 1)
        if (firstCharOfChannelID === 'D') {
          return resolve(channel.id)
        }
      }
      self.slack.api.im.open({ 'user': userID }, function (err, response) {
        if (err) {
          debug('ERROR cannot open DM channel for ' + userID + ' : ' + err)
          reject()
        }
        resolve(response.channel.id)
      })
    })
}


// get ID of a channel
TipBot.prototype.getChannel = function (channelName) {
  let self = this
  let findNameExp = new RegExp(channelName + '(?![\\w-])', 'i') // word boundaries that include the '-'
  return new Promise(
    (resolve, reject) => {
      self.slack.api.channels.list({}, function (err, channelList) {
        if (err) {
          debug('ERROR retrieving list of channels ' + err)
          return reject(err)
        }
        let foundChannelIDs = _.filter(channelList.channels, function (find) {
          return find.name.match(findNameExp)
        })

        if (foundChannelIDs.length === 1) {
          return resolve(foundChannelIDs[0])
        } else {
          // debug('tipbot:bot')('Didn't found the ' + channelName + ', looking in private groups now.');
          self.slack.api.groups.list({}, function (err, groupList) {
            if (err) {
              debug('ERROR retrieving list of private channels (groups)' + err)
              return reject(err)
            }
            let priceGroupID = _.filter(groupList.groups, function (find) {
              return find.name.match(findNameExp)
            })
            if (priceGroupID.length === 1) {
              return resolve(priceGroupID[0])
            } else {
              debug('Didn\'t found the ' + channelName + ', in public nor private groups.')
            }
          })
        }
      })
    })
}

// initializing of TipBot :  get list of current users
TipBot.prototype.init = function () {
  let self = this
  // prevent multiple initializations
  if (self.initializing) {
    debug('++ Init called but still initializing...')
    return
  }
  self.initializing = true

  // create all user objects for online users (will be updated via 'user_change' slack event in bot.js )
  self.slack.api.users.list({}, function (err, data) {
    if (err) { throw new Error(err) }
    // add each user to our list of users
    async.forEachLimit(data.members, 100,
      function (member, cb) {
        // debug(member.name + '(' + member.id + ') =  ' + member.profile.email);
        self.updateUserFromMember(member, false)
        cb()
      },
      function (err) {
        if (err) {
          debug('ERROR Init: ', err)
        }

        self.updateUserRegex()

        // get Rain user
        if (self.OPTIONS.ENABLE_RAIN_FEATURE) {
          self.rainUser = rain.init(self.OPTIONS.RAIN_USERNAME, self.users)
        }

        // Done !
        debug('I am <@%s:%s> of %s', self.slack.identity.id, self.slack.identity.name, self.slack.team_info.name)
        debug('***** TipBot ready! *****')
        // debug('We have the following . + Object.keys(self.users).length +  known users; ', _.map(self.users, function(user) {
        // return user.name;
        // }).join(', '));

        self.initializing = false
      })

  })

}

// convert currency if needed,
// return via callback amount in dash, and if it was needed to convertion rate and originalCurrency
// CB (value, rate, originalCurrency, originalValue, valueText)
TipBot.prototype.normalizeValue = function (inputValue, unit, user, outputCurrency) {
  let self = this
  let currency, value
  return new Promise(
    (resolve, reject) => {
      // asked for all = balance
      if (inputValue === 'all' && user !== undefined) {
        currency = CYBERCURRENCY
        self.wallet.GetBalance(user.id, 6)
          .then(balance => {
            let value = Coin.toSmall(balance)
            debug('Log: using ALL balance of ' + user.name + ' = ' + balance)
            // amount is in cybercoin, return only value, no convertion rate
            const converted = { newValue: value, rate: null, text: Coin.toLarge(value) + ' ' + CYBERCURRENCY }
            resolve(converted)
          })
          .catch(err => {
            debug(err)
            return reject('ERROR getting balance to find "all" ' + err)
          })
      } else {
        // no 'all', evaluate the unit
        // large cybercoin -> small cybercoin or fiat -> float
        if (unit.match(/duff?/i)) {
          currency = CYBERCURRENCY
          value = parseInt(inputValue)
        }
        if (unit.match(/DASH/i)) {
          currency = CYBERCURRENCY
          value = Coin.toSmall(inputValue)
        }


        let cyberToFiat = false

        if (currency === CYBERCURRENCY) {
          // amount is in cybercoin, return only value, no convertion rate
          if (!outputCurrency) {
            const converted = { newValue: value, rate: null, text: Coin.toLarge(value) + ' ' + CYBERCURRENCY }
            return resolve(converted)
          } else {
            // outputCurrency is know =>  convert cybercoin -> fiat
            unit = outputCurrency
            cyberToFiat = true
          }
        }

        currency = unit.trim().toLowerCase()
        if (self.CURRENCIES.indexOf(currency) !== -1) {
          value = parseFloat(inputValue)
        } else {
          return reject(user.handle + tipbotTxt.UnsupportedCurrency + ' "' + currency + '"')
        }

        // check if a price update is needed
        self.getPriceRates()
          .then(rates => {
            let rate = rates[currency]
            debug('Rate for ' + currency + ' = ' + rate)
            if (!rate) {
              return reject(user.handle + tipbotTxt.UnsupportedCurrency + ' "' + currency + '"')
            } else {
              let newValue
              if (cyberToFiat)
                newValue = Math.ceil(value / rate * 1e8)
              else
                newValue = Math.ceil(value * rate * 1e8)

              newValue = Coin.toLarge(newValue)
              rate = rate.toFixed(2)

              let text = value.toFixed(2) + ' ' + currency + ' ' +
                '(' + newValue + ' ' + CYBERCURRENCY +
                ' at ' + rate + ' ' + currency + ' / ' + CYBERCURRENCY + ')'

              // return converted value in dash, convertion rate, originalCurrency, originalValue, text about the convertion
              const converted = { newValue, rate, text }
              return resolve(converted)
            }
          })
          .catch(err => {
            debug('ERROR: getting rate for ' + currency + ': ' + err)
            return reject(err)
          })
      }
    })
}

// tell all help text, if call by an admin show also the admin-only commands
TipBot.prototype.tellHelp = function (is_admin) {
  var self = this
  let text = _.reduce(tipbotTxt.helpText, function (completeHelpText, helpPart) {
    return completeHelpText + helpPart + '\n'
  }, '')
  if (self.OPTIONS.ENABLE_RAIN_FEATURE) {
    text += tipbotTxt.help_rain
  }

  if (is_admin) {
    text += '\n\n' + tipbotTxt.helpAdminOnly
  }
  return text
}

// get random help text
TipBot.prototype.showRandomHelp = function () {
  let self = this
  if (self.OPTIONS.MAIN_CHANNEL === undefined) {
    debug('ERROR: cannot show random helptext because Main Chat channel is not set.')
    return
  }
  let helpCount = tipbotTxt.helpText.length
  let getHelpNR = Math.floor((Math.random() * helpCount))
  getHelpNR = getHelpNR === 0 ? 1 : getHelpNR // don\'t show title
  let helpTxt = tipbotTxt.helpText[getHelpNR].replace(/[*]/g, '').replace(/[_]/g, '') // * for bold doesn't show in a code block
  debug('show helptext number ' + getHelpNR)

  let helpMsg = {
    channel: self.OPTIONS.MAIN_CHANNEL.id,
    text: '>>>' + tipbotTxt.HelpRandom1 + '\n' +
    '```' + helpTxt + '```'
  }
  self.slack.say(helpMsg)
}

TipBot.prototype.onUserChange = function (bot, member) {
  let self = this
  self.updateUserFromMember(member)
}

// check if rain balance > rain threshold
TipBot.prototype.checkForRain = function () {
  let self = this
  if (rain !== undefined) {
    rain.checkThreshold(self.OPTIONS.RAIN_DEFAULT_THRESHOLD, self.rainUser,
      function (err, reviecedUsers, rainraySize) {
        if (err) {
          debug(err); return
        }
        if (rainraySize !== null && reviecedUsers !== null) {
          // show public announcement
          let reply = {
            channel: self.OPTIONS.MAIN_CHANNEL.id,
            text: tipbotTxt.RainRay + '\n' +
            tipbotTxt.RainExplain + '\n' +
            tipbotTxt.RainRay + '\n'
          }
          self.slack.say(reply)
          //send private message to each revieced user
          debug('rain: ===== ASYNC start sending private messages for rain =====')
          async.forEachSeries(reviecedUsers,
            function (oneUser, asyncCB) {
              // wait the time set via rain Throttle to prevent slack spam protection
              wait(self.OPTIONS.RAIN_SEND_THROTTLE, function () {
                // ignore all response to prevent wall of text in public, sender = rain User = not usefull to inform
                // custom message to reciever:
                self.getDirectMessageChannelID(null, oneUser.id)
                  .then(DMchannelRecievingUser => {
                    // send private message to lucky user
                    let recievingUserMessage = {
                      'channel': DMchannelRecievingUser,
                      'text': tipbotTxt.RainRecieved + Coin.toLarge(rainraySize) + ' dash'
                    }
                    self.slack.say(recievingUserMessage)
                  })
                  .catch()
                //})
              })
              asyncCB()// callback needed to let async know everyhing is done
            },
            // function called when all async tasks are done
            function (err) {
              if (err) {
                debug('ERROR rain: during async rain: ' + err)
                return
              }
              debug('RAIN ===== ASYNC stop sending private messages for rain =====')
            })
        }
      })
  }
}

// a Slack message was send,
// if the bot name mentioned look for command keywords
TipBot.prototype.onMessage = function (channel, member, message) {
  let self = this
  let reply = { 'channel': channel.id }

  let amount, currency, providedCurrency

  let user = self.users[member]

  if (user === undefined) {
    // don\'t know who send the message
    debug('ERROR don\'t have the user ' + member.name + ' (' + member.id + ') in my known users (array)')
    return
  }

  if (user.id === self.slack.identity.id) {
    // message was from bot (reply to a command)
    return
  }

  let privateReply = {}
  self.getDirectMessageChannelID(channel, user.id)
    .then(DMchannelID => {
      privateReply.channel = DMchannelID
      // debug message
      let channelName = channel.Name || channel.id // channelName = name of id if no name if found (group)
      debug('Message in channel: ' + channelName + ' from user ' + user.name + ' : \'' + message + '\'')

      // find user ID matches, ignore the sending user
      let userMatches = _.reject(message.match(self.userRegex), function (match) {
        return match === user.id
      })

      // find real user objects
      userMatches = _.uniq(_.filter(_.map(userMatches, function (match) {
        // if it's an ID
        if (self.users[match]) {
          return self.users[match]
        }

        if (!user) {
          debug('Failed to find user match . + match + ')
        }

        return user
      })))

      // MENTIONS MULTIPLE USER
      if (userMatches.length > 1) {
        reply.text = 'Sorry ' + user.handle + tipbotTxt.ToMuchUsers
        self.slack.say(reply)
        return
      }

      // * SPEAK as bot (admin only)
      if (message.match(/\bspeak\b/i)) {
        // admin only command
        if (user.is_admin) {
          // find channel to talk into
          if (message.match(/\binto\b/i)) {
            self.OPTIONS.talkInChannel = message.replace('speak', '').replace('into', '').trim()
            return
          }
          if (self.OPTIONS.talkInChannel !== undefined) {
            //only if channel to speak into is set
            let say = message.replace('speak', '')
            //debug(say);

            self.slack.api.channels.list({}, function (err, channelList) {
              if (err) {
                debug('Error retrieving list of channels ' + err)
                return
              }
              let foundChannelIDs = _.filter(channelList.channels, function (find) {
                return find.name.match(self.OPTIONS.talkInChannel, 'i')
              })

              if (foundChannelIDs.length === 1) {
                //channel found, say message
                self.slack.say({
                  channel: foundChannelIDs[0].id,
                  text: say
                })
              } else {
                debug('ERROR cannot find channel \'' + self.OPTIONS.talkInChannel + '\'')
              }
            })
          }
        }
        return
      }

      // *  WHISPER (send as admin a DM to a user as bot)
      if (message.match(/\bwhisper\b/i)) {
        if (user.is_admin) {
          // check if recieving user was provided
          if (userMatches.length === 0) {
            reply.text = tipbotTxt.Hello + user.handle + tipbotTxt.NoUserFoundForTip
            self.slack.say(reply)
            return
          }
          if (userMatches.length === 1) {
            let whisperTo = userMatches[0]
            self.getDirectMessageChannelID(null, whisperTo.id)
              .then(dmChannel => {
                let whisperText = message.replace(whisperTo.name, '')
                  .replace('whisper', '')
                  .replace(self.slack.identity.name, '')
                  .replace('<@', '').replace(whisperTo.id, '').replace('>', '')
                debug('Whisper to ' + whisperTo.name + ' as bot : \'' + whisperText + '\'')
                let whisper = { channel: dmChannel, text: whisperText }
                self.slack.say(whisper)
              })
              .catch()
          }
        }
        return
      }

      // * BALANCE
      if (message.match(/\bbalance\b/i)) {
        let balanceOfUser = user // default show own balance (see balance check cmd)

        // * ALL BALANCES (admin only, needs to be enabled via OPTIONS.ALL_BALANCES)
        if (message.match(/\ball\b/i)) {
          if (self.OPTIONS.ALL_BALANCES === false) {
            reply.text = tipbotTxt.RetrievingAllBalancesDisabled
            self.slack.say(reply)
            return
          }
          if (!user.is_admin) {
            reply.text = tipbotTxt.RetrievingAllBalancesAdminOnly
            self.slack.say(reply)
            return
          }
          // warn that this can take a while
          reply.text = tipbotTxt.RetrievingAllBalancesWait
          self.slack.say(reply)
          //todo: refactoring async => Promise All
          async.mapLimit(Object.keys(
            self.users),
            3,
            function (userID, cb) {
              let user = self.users[userID]

              self.wallet.GetBalanceLine(user)
                .then(line => {
                  cb(null, line)
                })
                .catch(err => {
                  cb(err, null)
                })
            },
            function (err, result) {
              if (err) { debug('ERROR', err); return }

              reply.text = result.join('\n')
              // reply in Direct Message
              self.getDirectMessageChannelID(channel, user.id)
                .then(DMchannelID => {
                  reply.channel = DMchannelID
                  self.slack.say(reply)
                })
                .catch()
            })
          return
        }

        //  * SEE BALANCE OF OTHER USER (admin only, needs to be enabled via OPTIONS.OTHER_BALANCES)
        // feature asked for verifying dummy, fake, slack accounts
        if (message.match(/\bcheck\b/i)) {
          if (self.OPTIONS.OTHER_BALANCES === false) {
            privateReply.text = tipbotTxt.CheckBalanceDisabled
            self.slack.say(privateReply)
            return
          }
          if (!user.is_admin) {
            privateReply.text = tipbotTxt.CheckBalanceAdminOnly
            self.slack.say(privateReply)
            return
          }
          // check if  user was provided
          if (userMatches.length === 0) {
            privateReply.text = tipbotTxt.Hello + user.handle + tipbotTxt.CheckBalanceNoUserFound
            self.slack.say(privateReply)
            return
          }
          if (userMatches.length === 1) {
            balanceOfUser = userMatches[0] // get balance of mentioned user
          }
        }

        // tell  balance in private message
        self.wallet.GetBalanceLine(balanceOfUser)
          .then(line => {
            privateReply.text = line
            self.slack.say(privateReply)
          })
          .catch(err => {
            debug('ERROR: cannot tell ballance of ' + balanceOfUser.name + '/' + balanceOfUser.id)
            privateReply.text = err
            self.slack.say(privateReply)
          })

        return
      }

      // * DEPOSIT
      if (message.match(/\bdeposit\b/i)) {
        self.wallet.TellDepositeAddress(user)
          .then(line => {
            privateReply.text = line
            self.slack.say(privateReply)
          })
          .catch(err => {
            debug('ERROR: cannot find a deposit address for \'' + user.name + '(' + user.id + ') : ' + err)
          })
        return
      }

      // * WITHDRAW
      if (message.match(/\bwithdraw\b/i)) {
        amount = message.match(self.AMOUNT_OR_ALL_REGEX) // only the number, no currency
        if (amount === null) {
          reply.text = user.name + tipbotTxt.NoAmountFound
          self.slack.say(reply)
          return
        }
        // check if currency was provide
        providedCurrency = message.match(self.CURRENCY_REGEX)
        if (providedCurrency !== null && providedCurrency[0].length !== 0) {
          //  set provided currency
          amount[2] = message.match(self.CURRENCY_REGEX)[0]
        } else {
          //not provided, set dash as default currency
          amount[2] = CYBERCURRENCY
        }
        debug(amount)

        let address = message.match(self.ADDRESS_REGEX)

        if (address) {
          address = _.uniq(_.filter(address, function (address) {
            try {
              base58check.decode(address)
              return true
            } catch (e) {
              return false
            }
          }))

          if (!address.length) {
            reply.text = 'Sorry ' + user.handle + tipbotTxt.NoValidAddress
            self.slack.say(reply)
            return
          } else if (address.length > 1) {
            reply.text = 'Sorry ' + user.handle + tipbotTxt.MoreThen1Address + ' [' + address.join(', ') + ']'
            self.slack.say(reply)
            return
          }

        } else {
          // no address
          reply.text = 'Sorry ' + user.handle + tipbotTxt.NoAddress
          self.slack.say(reply)
          return
        }
        // no amount
        if (!amount) {
          reply.text = 'Sorry ' + user.handle + tipbotTxt.NoAmountOrCurrency
          self.slack.say(reply)
          return
        }
        // convert amount if currency isn't Dash
        self.normalizeValue(amount[1], amount[2], user)
          .then(converted => {
            // ask for confirmation (needed if doing a conversion: withdraw x euro)
            let privateConversation = { user: user.id }
            self.slack.startPrivateConversation(privateConversation, function (err, convo) {
              convo.ask(
                tipbotTxt.WithdrawQuestion[0] + converted.text +
                tipbotTxt.WithdrawQuestion[1] + address +
                tipbotTxt.WithdrawQuestion[2],
                [
                  {
                    pattern: self.slack.utterances.yes,
                    callback: function (response, convo) {
                      convo.say('Great! I will continue...')
                      // do something else...
                      self.wallet.Withdraw(converted.newValue, address[0], self.OPTIONS.WALLET_PASSW, user)
                        .then(response => {
                          debug(user.name + ' had succesfull withdraw ' + converted.value + ' to ' + address[0])
                          convo.say(response)
                        })
                        .catch(err => {
                          debug('ERROR: cannot withdraw because: ' + err)
                          convo.say(err)
                        })
                      convo.next()
                      return
                    }
                  },
                  {
                    pattern: self.slack.utterances.no,
                    callback: function (response, convo) {
                      convo.say('Perhaps later.')
                      // do something else...
                      debug('Withdraw canceled by user: ' + user.name + '/' + user.id)
                      convo.next()
                      return
                    }
                  }
                ])
            })
          })
          .catch(errTxt => {
            reply.text = errTxt
            self.slack.say(reply)
          })

        return
      }

      // * SEND / TIP
      if (message.match(/\b(send|give|sent|tip)\b/i)) {
        // check if recieving user was provided
        if (userMatches.length === 0) {
          reply.text = tipbotTxt.Hello + user.handle + tipbotTxt.NoUserFoundForTip
          self.slack.say(reply)
          return
        } else if (userMatches.length === 1) {
          let mentioned = userMatches[0]

          // get only the number, no currency
          amount = message.match(self.AMOUNT_REGEX)
          if (amount === null) {
            reply.text = user.name + tipbotTxt.NoAmountFound
            self.slack.say(reply)
            return
          }
          let currency
          // check if currency was provide
          providedCurrency = message.match(self.CURRENCY_REGEX)
          if (providedCurrency !== null && providedCurrency[0].length !== 0) {
            //  set provided currency
            currency = message.match(self.CURRENCY_REGEX)[0]
          } else {
            //not provided, set dash as default currency
            currency = CYBERCURRENCY
          }
          // convert if currency isn't Dash
          self.normalizeValue(amount[1], currency, user)
            .then(converted => {
              // send amount (move between accounts in wallet)
              self.wallet.Move(mentioned, converted.newValue, user)
                .then(responses => {
                  // response in public channel:  announce tip
                  reply.text = responses.public
                  self.slack.say(reply)
                  // response to sender: send thanks and new ballance
                  privateReply.text = responses.privateToSender
                  self.slack.say(privateReply)
                  // response to reciever:  inform of the tip
                  self.getDirectMessageChannelID(null, mentioned.id)
                    .then(DMchannelRecievingUser => {
                      let recievingUserMessage = {
                        'channel': DMchannelRecievingUser,
                        'text': responses.privateToReciever +
                        tipbotTxt.SendMessageUsed +
                        '_' + message + '_' + '\n\n use the command ' +
                        // explain how to withdraw
                        tipbotTxt.helpText[4]
                      }
                      self.slack.say(recievingUserMessage)
                    })
                    .catch()
                  // save tip to database for Rain feature
                  if (self.OPTIONS.ENABLE_RAIN_FEATURE) { rain.incTipCountInDb(user) }

                })
                .catch(err => {
                  debug('ERROR: cannot send ' + converted.newValue + ' to ' + mentioned.name + '(' + mentioned.id + ') : ' + err)
                  // warn sender about the error
                  // response to sender: send thanks and new ballance
                  privateReply.text = err
                  self.slack.say(privateReply)
                  return
                })
            })
            .catch(errTxt => {
              reply.text = errTxt
              self.slack.say(reply)
            })
          return
        }
      }
      // 	* CONVERT
      if (message.match(/\b(convert|rate)\b/i)) {
        let currencies = message.match(self.CURRENCY_REGEX)
        if (currencies === null || currencies.length < 2) {
          reply.text = user.handle + tipbotTxt.NotEnoughCurrencies
          self.slack.say(reply)
          return
        }
        if (currencies.length > 2) {
          reply.text = user.handle + tipbotTxt.ToMuchCurrencies
          self.slack.say(reply)
          return
        }
        // only the number, no currency
        amount = message.match(self.AMOUNT_REGEX)
        if (amount === null) {
          reply.text = user.name + tipbotTxt.NoAmountFound
          self.slack.say(reply)
          return
        }

        let toCurrency, fromCurrency
        // check convertion flow (fiat-cyber or cyber->fiat)
        // convert fiat -> cybercoin = second currency is cybercoin 
        if (currencies[1].toLowerCase() === CYBERCURRENCY.toLocaleLowerCase) {
          //  fiat is first
          fromCurrency = currencies[1].toLowerCase()
          toCurrency = currencies[0].toLowerCase()

        } else {
          // cyber -> fiat = fiat is second
          fromCurrency = currencies[0].toLowerCase()
          toCurrency = currencies[1].toLowerCase()
        }

        self.normalizeValue(amount[1], toCurrency, user, fromCurrency)
          .then(converted => {
            reply.text = amount[1] + ' ' + fromCurrency + ' = '
              + converted.newValue + '  ' + toCurrency +
              ' ( 1.0 ' + CYBERCURRENCY + ' = ' + converted.rate + ' ' + toCurrency + ' )'

            self.slack.say(reply)
          })
          .catch(errTxt => {
            reply.text = errTxt
            self.slack.say(reply)
          })
        return
      }

      // 	* PRICE
      if (message.match(/\bprice\b/i)) {
        currency = message.match(self.CURRENCY_REGEX)

        if (currency) {
          currency = currency[0].toLowerCase()
          self.tellPrice(currency)
            .then(response => {
              // tell where price is pulled from
              reply.text = response + '\n' + tipbotTxt.PriceInfoFrom
              self.slack.say(reply)
              return
            })
            .catch(err => {
              debug('ERROR reading price information for ' + currency + ' :' + err)
              return
            })
        } else {
          // no currency provided, show short list in channel where command was issued
          self.showPriceList(channel, false)
        }
        return
      }

      // 	* PRICE TICKER
      if (message.match(/\bpriceticker|pricelist|prices\b/i)) {
        let tellChannel = self.OPTIONS.PRICETICKER_CHANNEL
        if (self.OPTIONS.PRICETICKER_CHANNEL === undefined) {
          reply.text = 'ERROR don\'t know in which channel I need to post the priceticker'
          self.slack.say(reply)
          return
        }
        // show the pricticker manual
        if (message.match(/\bshort\b/i)) {
          // short list
          self.showPriceList(tellChannel, false)
        } else {
          // show all currencies in the dedicated channel to prevent wall of text in other channels
          self.showPriceList(tellChannel, true)
          // inform the user about its location
          privateReply.text = tipbotTxt.LocationOfPriceList1 + self.OPTIONS.PRICETICKER_CHANNEL.name + tipbotTxt.LocationOfPriceList2
          self.slack.say(privateReply)
        }
        return
      }

      // 	* LIST CURRENCIES
      if (message.match(/\bcurrencies\b/i)) {
        reply.text = tipbotTxt.CurrenciesTitle +
          tipbotTxt.SupportedCurrenciesFull + self.SUPPORTED_CURRENCIES.join(', ') + '\n' +
          tipbotTxt.SupportedSymbols + self.CURRENCIES.join(', ') + '* \n' +
          tipbotTxt.SupportedBase
        self.slack.say(reply)
        return
      }

      //	* HELP
      if (message.match(/\bhelp\b/i)) {
        self.getDirectMessageChannelID(channel, user.id)
          .then(DMchannelID => {
            reply.channel = DMchannelID
            reply.text = self.tellHelp(user.is_admin)
            self.slack.say(reply)
          })
          .catch()
        return
      }

      //  * RAIN (reward to users that have tipped others)
      if (self.OPTIONS.ENABLE_RAIN_FEATURE && message.match(/\brain\b/i)) {

        // all users can check the balance of the Rain Account
        // get Rain User for OPTIONS
        if (self.rainUser === undefined || self.rainUser === null) {
          reply.text = tipbotTxt.RainCannotFindRainAccount1 + self.OPTIONS.RAIN_USERNAME + tipbotTxt.RainCannotFindRainAccount2
          reply.text += tipbotTxt.RainExplain
          self.slack.say(reply)
          return
        }
        // show balance of Rain Account, available to non-admin user
        rain.getRainBalance(self.rainUser, function (err, rainBalance) {
          if (err) {
            reply.text = tipbotTxt.RainCannotFindRainBalance + self.OPTIONS.RAIN_USERNAME
            self.slack.say(reply)
            return
          } else {
            if (rainBalance !== undefined && rainBalance > 2e-8) {
              reply.text = tipbotTxt.RainAvailibleAmount + rainBalance + ' dash'
            } else {
              reply.text = tipbotTxt.RainEmpty
            }
            reply.text += '\n' + tipbotTxt.RainReqDonation1 + self.OPTIONS.RAIN_USERNAME + '_'
            reply.text += '\n' + tipbotTxt.RainReqDonation2 + self.OPTIONS.RAIN_USERNAME + tipbotTxt.RainReqDonation3
            // show threshold
            rain.getThreshold(self.OPTIONS.RAIN_DEFAULT_THRESHOLD, function (err, threshold) {
              if (err) { debug(err); return }
              reply.text += '\n' + tipbotTxt.RainThreshold1 +
                Coin.toLarge(threshold) + ' Dash \n' +
                tipbotTxt.RainThreshold2
              // show amount of eligible users
              rain.getAmountOfEligibleRainUsers(
                function (err, count) {
                  if (err) { debug(err) }
                  reply.text += '\n' + count + tipbotTxt.RainAmountEligibleUsers
                  self.slack.say(reply)
                })
            })
          }
        })

        // ADMIN ONLY COMMANDS
        if (user.is_admin) {
          // show Eligible users (ahs tip before)
          if (message.match(/\beligible\b/i)) {
            rain.getListOfRainEligibleUsers(
              function (err, allTippers) {
                if (err) {
                  debug(tipbotTxt.ERRORreadingDb + err)
                  self.privateReply.text = tipbotTxt.ERRORreadingDb + ': ' + err
                  self.slack.say(privateReply)
                }
                // show list all tippers
                privateReply.text = tipbotTxt.RainEligibleUsersList
                allTippers.forEach(function (tipper) {
                  privateReply.text += tipper.name + '(' + tipper.id + ') has tipped ' + tipper.tipCount + ' times.\n'
                })
                //  debug(reply.text);
                self.slack.say(privateReply)
              })
          }

          // threshold (rain will be cast if amount of rain balance > threshold)
          if (message.match(/\bthreshold\b/i)) {
            // set new threshold
            amount = message.match(self.AMOUNT_REGEX) // only the number
            if (amount !== null) {
              // amount found in message, save this as the new threshold
              rain.saveThreshold(Coin.toSmall(amount[1]),
                function (err) {
                  if (err) {
                    debug(err); return
                  } else {
                    debug('New Rain threshold saved as ' + amount[1] + ' by ' + user.name)
                  }
                  // //show new threshold
                  // rain.getThreshold(self.OPTIONS.RAIN_DEFAULT_THRESHOLD,
                  // function (err, threshold) {
                  //     if (err) { debug(err); return; }
                  //     reply.text += '\n' + tipbotTxt.RainThreshold1 +
                  //         Coin.toLarge(threshold) + ' Dash \n' +
                  //         tipbotTxt.RainThreshold2;
                  //     self.slack.say(reply);
                  // });
                  // threshold changed => check balance now
                  self.checkForRain(reply)
                })
            }
          }
        }
        return
      }

      //  * GET SLACK ID
      if (message.match(/\bgetid\b/i)) {
        if (userMatches.length === 1 && user.is_admin) {
          let mentioned = userMatches[0]
          privateReply.text = 'Slack ID of user ' + mentioned.name + ' = ' + mentioned.id
          self.slack.say(privateReply)
        } else if (message.match(/\bme\b/i)) {
          privateReply.text = 'Slack ID of user ' + user.name + ' = ' + user.id
          self.slack.say(privateReply)
        }
        return
      }

      //  * OOPS
      let amountOfPossibleResponds = tipbotTxt.NoCommandFound.length
      let randomRespons = Math.floor((Math.random() * amountOfPossibleResponds) + 1)
      if (tipbotTxt.NoCommandFound[randomRespons] === undefined) {
        randomRespons = 'Unknow helptext (Nr: ' + randomRespons / amountOfPossibleResponds + ')'
      } else {
        reply.text = '>>>' + tipbotTxt.NoCommandFound[randomRespons]
        reply.text += '\n' + tipbotTxt.Oops
      }
      self.slack.say(reply)
      return
    })

  return
}

module.exports = TipBot
