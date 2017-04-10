'use strict'
/*  global wait */
const _ = require('lodash')
const debug = require('debug')('tipbot:tipbot')
const async = require('async')
const request = require('request')

const path = require('path')
const fs = require('fs')
require('waitjs')

const User = require('./user.js')
const Wallet = require('./wallet.js')
const Coin = require('./coin.js')
const tipbotTxt = require('../text/txt_dash.js').tipbotTxt


let TipBot = function (bot, RPC_USER, RPC_PASSWORD, RPC_PORT, OPTIONS) {
  let self = this
  if (!bot) { throw new Error('Connection with Slack not availible for tipbot') }

  const HighBalanceWarningMark = Coin.toSmall(1.0)
  self.CYBERCURRENCY = 'DASH'  // upper case for compare
  const BLACKLIST_CURRENCIES = [self.CYBERCURRENCY]

  self.initializing = false

  self.users = {}

  self.slack = bot
  self.rain = null
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

  self.CURRENCY_REGEX = new RegExp('\\b(duff?|' + self.CYBERCURRENCY + '|' + self.CURRENCIES.join('|') + ')\\b', 'ig') // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)

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
      const prurals = self.CURRENCIES.map(cur => cur + 's') // for vanity currencies ( send 2  beers)
      self.CURRENCY_REGEX = new RegExp('\\b(duff?|' + self.CYBERCURRENCY + '|' + self.CURRENCIES.join('|') + '|' + prurals.join('|') + ')\\b', 'ig') // added \b: bugfix for only finding the currencr symbol instead parts of words (aud = audit)
    })
    .catch(err => { debug('ERROR: Init : getting rates : ' + err) })

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
    self.users[member.id] = new User(member)
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
        self.updateUserFromMember(member, false)
        cb()
      },
      function (err) {
        if (err) {
          debug('ERROR Init: ', err)
        }

        self.updateUserRegex()

        // get Rain user if needed
        if (self.OPTIONS.ENABLE_RAIN_FEATURE === true && self.OPTIONS.RAIN_USERNAME) {
          const Rain = require('./rain')
          self.rain = new Rain(self.OPTIONS.RAIN_USERNAME, self.users)
        }

        // Done !
        debug('I am <@%s:%s> of %s', self.slack.identity.id, self.slack.identity.name, self.slack.team_info.name)
        debug('***** TipBot ready! *****')

        self.initializing = false
      })

  })

}

// convert currency if needed,
//  amount in Coin Large, and if it was needed to convertion rate and originalCurrency
TipBot.prototype.normalizeValue = function (inputValue, unit, user, outputCurrency) {
  let self = this
  let currency, value
  return new Promise(
    (resolve, reject) => {
      // asked for all = balance
      if (inputValue === 'all' && user !== undefined) {
        currency = self.CYBERCURRENCY
        self.wallet.GetBalance(user.id, 6)
          .then(balance => {
            let value = Coin.toSmall(balance)
            debug('Log: using ALL balance of ' + user.name + ' = ' + balance)
            // amount is in cybercoin, return only value, no convertion rate
            const converted = { newValue: value, rate: null, text: Coin.toLarge(value) + ' ' + self.CYBERCURRENCY }
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
          currency = self.CYBERCURRENCY
          value = Coin.toSmall(inputValue)
        }
        if (unit.match(/DASH/i)) {
          currency = self.CYBERCURRENCY
          value = parseFloat(inputValue)
        }

        let cyberToFiat = false

        currency = unit.trim().toLowerCase()
        if (currency.endsWith('s')) // remove plurar 's'
          currency = currency.slice(0, -1)

        if (currency === self.CYBERCURRENCY.toLowerCase()) {
          if (!outputCurrency) {
            // amount is in cybercoin, return only value, no convertion rate
            const converted = { newValue: value, rate: null, text: Coin.toLarge(value) + ' ' + self.CYBERCURRENCY }
            return resolve(converted)
          } else {
            // outputCurrency is know =>  convert cybercoin -> fiat
            // unit = outputCurrency
            cyberToFiat = true
            currency = outputCurrency
          }
        }


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
              let newValue = 0.0
              if (!cyberToFiat)
                newValue = Math.ceil(value / rate * 1e8)
              else
                newValue = Math.ceil(value * rate * 1e8)

              newValue = Coin.toLarge(newValue)
              rate = rate.toFixed(2)

              let text = value.toFixed(2) + ' ' + currency + ' ' +
                '(' + newValue + ' ' + self.CYBERCURRENCY +
                ' at ' + rate + ' ' + currency + ' / ' + self.CYBERCURRENCY + ')'

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
  if (self.OPTIONS.ENABLE_AUTOWITHDRAW_FEATURE) {
    text += tipbotTxt.help_autowithdraw
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
  if (self.rain && self.rain.rainUser) {
    self.rain.CheckThreshold(self.OPTIONS.RAIN_DEFAULT_THRESHOLD, self.wallet)
      .then(result => {
        if (result && result.rainraySize !== null && result.reviecedUsers !== null) {
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
          async.forEachSeries(result.reviecedUsers,
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
                      'text': tipbotTxt.RainRecieved + Coin.toLarge(result.rainraySize) + ' dash'
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
      .catch(err => {
        debug(err)
        return
      })
  }
}

// a Slack message was send,
// if the bot name mentioned look for command keywords
TipBot.prototype.onMessage = function (channel, member, message) {
  let self = this
  if (self.initializing) {
    debug('Ignore message, still initializing...')
    return
  }

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

  self.getDirectMessageChannelID(channel, user.id)
    .then(DMchannelID => {
      const ProcessMessage = require('./processMessage.js')
      ProcessMessage(message, channel, user, DMchannelID, self)
    })
}

module.exports = TipBot
