'use strict'
const _ = require('lodash')
const debug = require('debug')('tipbot:onMessage')
const base58check = require('base58check')
const async = require('async')

const tipbotTxt = require('../text/txt_dash.js').tipbotTxt
const Coin = require('./coin.js')

let autowithdraw  // only requuired if ENABLE_AUTOWITHDRAW_FEATURE

module.exports = function (message, channel, user, DMchannelID, tipbot) {
  let amount, currency, providedCurrency
  let privateReply = { channel: DMchannelID }
  let reply = { 'channel': channel.id }

  // log message
  let channelName = channel.Name || channel.id // channelName = name of id if no name if found (group)
  debug('Message in channel: ' + channelName + ' from user ' + user.name + ' : \'' + message + '\'')

  if (tipbot.OPTIONS.ENABLE_AUTOWITHDRAW_FEATURE) {
    autowithdraw = require('./autowithdraw')
  }


  // find user ID matches, ignore the sending user
  let userMatches = _.reject(message.match(tipbot.userRegex), function (match) {
    return match === user.id
  })

  // find real user objects
  userMatches = _.uniq(_.filter(_.map(userMatches, function (match) {
    // if it's an ID
    if (tipbot.users[match]) {
      return tipbot.users[match]
    }

    if (!user) {
      debug('Failed to find user match . + match + ')
    }

    return user
  })))

  // MENTIONS MULTIPLE USER
  if (userMatches.length > 1) {
    reply.text = 'Sorry ' + user.handle + tipbotTxt.ToMuchUsers
    tipbot.slack.say(reply)
    return
  }

  // * SPEAK as bot (admin only)
  if (message.match(/\bspeak\b/i)) {
    // admin only command
    if (user.is_admin) {
      // find channel to talk into
      if (message.match(/\binto\b/i)) {
        tipbot.OPTIONS.talkInChannel = message.replace('speak', '').replace('into', '').trim()
        return
      }
      if (tipbot.OPTIONS.talkInChannel !== undefined) {
        //only if channel to speak into is set
        let say = message.replace('speak', '')
        //debug(say);

        tipbot.slack.api.channels.list({}, function (err, channelList) {
          if (err) {
            debug('Error retrieving list of channels ' + err)
            return
          }
          let foundChannelIDs = _.filter(channelList.channels, function (find) {
            return find.name.match(tipbot.OPTIONS.talkInChannel, 'i')
          })

          if (foundChannelIDs.length === 1) {
            //channel found, say message
            tipbot.slack.say({
              channel: foundChannelIDs[0].id,
              text: say
            })
          } else {
            debug('ERROR cannot find channel \'' + tipbot.OPTIONS.talkInChannel + '\'')
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
        tipbot.slack.say(reply)
        return
      }
      if (userMatches.length === 1) {
        let whisperTo = userMatches[0]
        tipbot.getDirectMessageChannelID(null, whisperTo.id)
          .then(dmChannel => {
            let whisperText = message.replace(whisperTo.name, '')
              .replace('whisper', '')
              .replace(tipbot.slack.identity.name, '')
              .replace('<@', '').replace(whisperTo.id, '').replace('>', '')
            debug('Whisper to ' + whisperTo.name + ' as bot : \'' + whisperText + '\'')
            let whisper = { channel: dmChannel, text: whisperText }
            tipbot.slack.say(whisper)
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
      if (tipbot.OPTIONS.ALL_BALANCES === false) {
        reply.text = tipbotTxt.RetrievingAllBalancesDisabled
        tipbot.slack.say(reply)
        return
      }
      if (!user.is_admin) {
        reply.text = tipbotTxt.RetrievingAllBalancesAdminOnly
        tipbot.slack.say(reply)
        return
      }
      // warn that this can take a while
      reply.text = tipbotTxt.RetrievingAllBalancesWait
      tipbot.slack.say(reply)
      //todo: refactoring async => Promise All
      async.mapLimit(Object.keys(
        tipbot.users),
        3,
        function (userID, cb) {
          let user = tipbot.users[userID]

          tipbot.wallet.GetBalanceLine(user)
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
          tipbot.getDirectMessageChannelID(channel, user.id)
            .then(DMchannelID => {
              reply.channel = DMchannelID
              tipbot.slack.say(reply)
            })
            .catch()
        })
      return
    }

    //  * SEE BALANCE OF OTHER USER (admin only, needs to be enabled via OPTIONS.OTHER_BALANCES)
    // feature asked for verifying dummy, fake, slack accounts
    if (message.match(/\bcheck\b/i)) {
      if (tipbot.OPTIONS.OTHER_BALANCES === false) {
        privateReply.text = tipbotTxt.CheckBalanceDisabled
        tipbot.slack.say(privateReply)
        return
      }
      if (!user.is_admin) {
        privateReply.text = tipbotTxt.CheckBalanceAdminOnly
        tipbot.slack.say(privateReply)
        return
      }
      // check if  user was provided
      if (userMatches.length === 0) {
        privateReply.text = tipbotTxt.Hello + user.handle + tipbotTxt.CheckBalanceNoUserFound
        tipbot.slack.say(privateReply)
        return
      }
      if (userMatches.length === 1) {
        balanceOfUser = userMatches[0] // get balance of mentioned user
      }
    }

    // tell  balance in private message
    tipbot.wallet.GetBalanceLine(balanceOfUser)
      .then(line => {
        privateReply.text = line
        tipbot.slack.say(privateReply)
      })
      .catch(err => {
        debug('ERROR: cannot tell ballance of ' + balanceOfUser.name + '/' + balanceOfUser.id)
        privateReply.text = err
        tipbot.slack.say(privateReply)
      })

    return
  }

  // * DEPOSIT
  if (message.match(/\bdeposit\b/i)) {
    tipbot.wallet.TellDepositeAddress(user)
      .then(line => {
        privateReply.text = line
        tipbot.slack.say(privateReply)
      })
      .catch(err => {
        debug('ERROR: cannot find a deposit address for \'' + user.name + '(' + user.id + ') : ' + err)
      })
    return
  }

  // * WITHDRAW
  if (message.match(/\bwithdraw\b/i)) {
    amount = message.match(tipbot.AMOUNT_OR_ALL_REGEX) // only the number, no currency
    if (amount === null) {
      reply.text = user.name + tipbotTxt.NoAmountFound
      tipbot.slack.say(reply)
      return
    }
    // check if currency was provide
    providedCurrency = message.match(tipbot.CURRENCY_REGEX)
    if (providedCurrency !== null && providedCurrency[0].length !== 0) {
      //  set provided currency
      amount[2] = message.match(tipbot.CURRENCY_REGEX)[0]
    } else {
      //not provided, set dash as default currency
      amount[2] = tipbot.CYBERCURRENCY
    }
    // debug(amount)

    let address = message.match(tipbot.ADDRESS_REGEX)

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
        tipbot.slack.say(reply)
        return
      } else if (address.length > 1) {
        reply.text = 'Sorry ' + user.handle + tipbotTxt.MoreThen1Address + ' [' + address.join(', ') + ']'
        tipbot.slack.say(reply)
        return
      }

    } else {
      // no address
      reply.text = 'Sorry ' + user.handle + tipbotTxt.NoAddress
      tipbot.slack.say(reply)
      return
    }
    // no amount
    if (!amount) {
      reply.text = 'Sorry ' + user.handle + tipbotTxt.NoAmountOrCurrency
      tipbot.slack.say(reply)
      return
    }
    // convert amount if currency isn't Dash
    tipbot.normalizeValue(amount[1], amount[2], user)
      .then(converted => {
        // ask for confirmation (needed if doing a conversion: withdraw x euro)
        let privateConversation = { user: user.id }
        tipbot.slack.startPrivateConversation(privateConversation, function (err, convo) {
          convo.ask(
            tipbotTxt.WithdrawQuestion[0] + converted.text +
            tipbotTxt.WithdrawQuestion[1] + address +
            tipbotTxt.WithdrawQuestion[2],
            [
              {
                pattern: tipbot.slack.utterances.yes,
                callback: function (response, convo) {
                  convo.say('Great! I will continue...')
                  // do something else...
                  tipbot.wallet.Withdraw(converted.newValue, address[0], tipbot.OPTIONS.WALLET_PASSW, user)
                    .then(response => {
                      debug(user.name + ' has succesfull withdraw ' + converted.newValue + ' to ' + address[0])
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
                pattern: tipbot.slack.utterances.no,
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
        tipbot.slack.say(reply)
      })

    return
  }

  // * AUTOWITHDRAW
  if (message.match(/\bautowithdraw\b/i)) {
    if (!tipbot.OPTIONS.ENABLE_AUTOWITHDRAW_FEATURE) { return }

    amount = message.match(tipbot.AMOUNT_OR_ALL_REGEX) // only the number, no currency
    if (amount) {
      // check if currency was provide
      providedCurrency = message.match(tipbot.CURRENCY_REGEX)
      if (providedCurrency !== null && providedCurrency[0].length !== 0) {
        //  set provided currency
        amount[2] = message.match(tipbot.CURRENCY_REGEX)[0]
      } else {
        //not provided, set dash as default currency
        amount[2] = tipbot.CYBERCURRENCY
      }
    }

    let address = message.match(tipbot.ADDRESS_REGEX)
    if (address) {
      address = _.uniq(_.filter(address, function (address) {
        try {
          base58check.decode(address)
          return true
        } catch (e) {
          return false
        }
      }))

      if (address.length > 1) {
        reply.text = 'Sorry ' + user.handle + tipbotTxt.MoreThen1Address + ' [' + address.join(', ') + ']'
        tipbot.slack.say(reply)
        return
      }
    } else { address = [] }

    // address and amount is provided => save setup
    if (amount !== null) {
      // convert amount if currency isn't Dash
      tipbot.normalizeValue(amount[1], amount[2], user)
        // amount converted, save setup
        .then(converted =>
          autowithdraw.SaveSetup(user.id, address[0], converted.newValue)
        )
        .catch(errLine => {
          privateReply.text = errLine
          tipbot.slack.say(privateReply)
          return
        })

        // get new setup
        .then(() =>
          autowithdraw.ShowSetup(user)
        )
        .catch(errLine => {
          privateReply.text = errLine
          tipbot.slack.say(privateReply)
          return
        })
        // show new setup 
        .then(optionsLine => {
          privateReply.text = optionsLine
          tipbot.slack.say(privateReply)
          return
        })
        .catch(errLine => {
          privateReply.text = errLine
          tipbot.slack.say(privateReply)
          return
        })
    }
    // no address or amount => show own autowithdraw setup
    else {
      autowithdraw.ShowSetup(user)
        .then(optionsLine => {
          privateReply.text = optionsLine
          tipbot.slack.say(privateReply)
          return
        })
        .catch(errLine => {
          privateReply.text = errLine
          tipbot.slack.say(privateReply)
          return
        })
    }
    return
  }

  // * SEND / TIP
  if (message.match(/\b(send|give|sent|tip)\b/i)) {
    // check if recieving user was provided
    if (userMatches.length === 0) {
      reply.text = tipbotTxt.Hello + user.handle + tipbotTxt.NoUserFoundForTip
      tipbot.slack.say(reply)
      return
    } else if (userMatches.length === 1) {
      let mentioned = userMatches[0]

      // get only the number, no currency
      amount = message.match(tipbot.AMOUNT_REGEX)
      if (amount === null) {
        reply.text = user.name + tipbotTxt.NoAmountFound
        tipbot.slack.say(reply)
        return
      }
      let currency
      // check if currency was provide
      providedCurrency = message.match(tipbot.CURRENCY_REGEX)
      if (providedCurrency !== null && providedCurrency[0].length !== 0) {
        //  set provided currency
        currency = message.match(tipbot.CURRENCY_REGEX)[0]
      } else {
        //not provided, set dash as default currency
        currency = tipbot.CYBERCURRENCY
      }
      // convert if currency isn't Dash
      tipbot.normalizeValue(amount[1], currency, user)
        .then(converted => {
          // send amount (move between accounts in wallet)
          tipbot.wallet.Move(mentioned, converted.newValue, user)
            .then(responses => {
              // response in public channel:  announce tip
              reply.text = responses.public
              tipbot.slack.say(reply)
              // response to sender: send thanks and new ballance
              privateReply.text = responses.privateToSender
              tipbot.slack.say(privateReply)
              // response to reciever:  inform of the tip
              tipbot.getDirectMessageChannelID(null, mentioned.id)
                .then(DMchannelRecievingUser => {
                  let recievingUserMessage = {
                    'channel': DMchannelRecievingUser,
                    'text': responses.privateToReciever +
                    tipbotTxt.SendMessageUsed +
                    '_' + message.trim() + '_'
                  }
                  // explain how to withdraw
                  recievingUserMessage.text += '\n\n use the command ' + tipbotTxt.helpText[4]

                  // if auto-withdraw is enabled check if new balance of recieve exide set amount
                  if (tipbot.OPTIONS.ENABLE_AUTOWITHDRAW_FEATURE) {
                    const recievingUser = tipbot.users[mentioned.id]
                    if (recievingUser !== null)
                      autowithdraw.Check(recievingUser, tipbot.wallet, tipbot.OPTIONS.WALLET_PASSW)
                        .then(result => {
                          if (result) {
                            debug('Preformed an auto-withdraw for user ' + recievingUser.handle)
                            debug(result)
                            // warn recieving user that an auto withdraw has executed
                            let recievingUserMessage = {
                              'channel': DMchannelRecievingUser,
                              'text': result
                            }
                            tipbot.slack.say(recievingUserMessage)
                          }
                        })
                        .catch(err => { debug('ERROR during auto withdraw check: ' + err) })
                  }
                  tipbot.slack.say(recievingUserMessage)
                })
                .catch()
              // save tip to database for Rain feature
              if (tipbot.OPTIONS.ENABLE_RAIN_FEATURE) { rain.incTipCountInDb(user) }

            })
            .catch(err => {
              debug('ERROR: cannot send ' + converted.newValue + ' to ' + mentioned.name + '(' + mentioned.id + ') : ' + err)
              // warn sender about the error
              // response to sender: send thanks and new ballance
              privateReply.text = err
              tipbot.slack.say(privateReply)
              return
            })
        })
        .catch(errTxt => {
          reply.text = errTxt
          tipbot.slack.say(reply)
        })
      return
    }
  }
  // 	* CONVERT
  if (message.match(/\b(convert|rate)\b/i)) {
    let currencies = message.match(tipbot.CURRENCY_REGEX)
    if (currencies === null || currencies.length < 2) {
      reply.text = user.handle + tipbotTxt.NotEnoughCurrencies
      tipbot.slack.say(reply)
      return
    }
    if (currencies.length > 2) {
      reply.text = user.handle + tipbotTxt.ToMuchCurrencies
      tipbot.slack.say(reply)
      return
    }
    // only the number, no currency
    amount = message.match(tipbot.AMOUNT_REGEX)
    if (amount === null) {
      reply.text = user.name + tipbotTxt.NoAmountFound
      tipbot.slack.say(reply)
      return
    }

    let toCurrency, fromCurrency
    // check convertion flow (fiat-cyber or cyber->fiat)
    // convert fiat -> cybercoin = second currency is cybercoin 
    if (currencies[1].toLowerCase() === tipbot.CYBERCURRENCY.toLocaleLowerCase) {
      //  fiat is first
      fromCurrency = currencies[1].toLowerCase()
      toCurrency = currencies[0].toLowerCase()

    } else {
      // cyber -> fiat = fiat is second
      fromCurrency = currencies[0].toLowerCase()
      toCurrency = currencies[1].toLowerCase()
    }

    tipbot.normalizeValue(amount[1], toCurrency, user, fromCurrency)
      .then(converted => {
        reply.text = amount[1] + ' ' + fromCurrency + ' = '
          + converted.newValue + '  ' + toCurrency +
          ' ( 1.0 ' + tipbot.CYBERCURRENCY + ' = ' + converted.rate + ' ' + toCurrency + ' )'

        tipbot.slack.say(reply)
      })
      .catch(errTxt => {
        reply.text = errTxt
        tipbot.slack.say(reply)
      })
    return
  }

  // 	* PRICE
  if (message.match(/\bprice\b/i)) {
    currency = message.match(tipbot.CURRENCY_REGEX)

    if (currency) {
      currency = currency[0].toLowerCase()
      tipbot.tellPrice(currency)
        .then(response => {
          // tell where price is pulled from
          reply.text = response + '\n' + tipbotTxt.PriceInfoFrom
          tipbot.slack.say(reply)
          return
        })
        .catch(err => {
          debug('ERROR reading price information for ' + currency + ' :' + err)
          return
        })
    } else {
      // no currency provided, show short list in channel where command was issued
      tipbot.showPriceList(channel, false)
    }
    return
  }

  // 	* PRICE TICKER
  if (message.match(/\bpriceticker|pricelist|prices\b/i)) {
    let tellChannel = tipbot.OPTIONS.PRICETICKER_CHANNEL
    if (tipbot.OPTIONS.PRICETICKER_CHANNEL === undefined) {
      reply.text = 'ERROR don\'t know in which channel I need to post the priceticker'
      tipbot.slack.say(reply)
      return
    }
    // show the pricticker manual
    if (message.match(/\bshort\b/i)) {
      // short list
      tipbot.showPriceList(tellChannel, false)
    } else {
      // show all currencies in the dedicated channel to prevent wall of text in other channels
      tipbot.showPriceList(tellChannel, true)
      // inform the user about its location
      privateReply.text = tipbotTxt.LocationOfPriceList1 + tipbot.OPTIONS.PRICETICKER_CHANNEL.name + tipbotTxt.LocationOfPriceList2
      tipbot.slack.say(privateReply)
    }
    return
  }

  // 	* LIST CURRENCIES
  if (message.match(/\bcurrencies\b/i)) {
    reply.text = tipbotTxt.CurrenciesTitle +
      tipbotTxt.SupportedCurrenciesFull + tipbot.SUPPORTED_CURRENCIES.join(', ') + '\n' +
      tipbotTxt.SupportedSymbols + tipbot.CURRENCIES.join(', ') + '* \n' +
      tipbotTxt.SupportedBase
    tipbot.slack.say(reply)
    return
  }

  //	* HELP
  if (message.match(/\bhelp\b/i)) {
    tipbot.getDirectMessageChannelID(channel, user.id)
      .then(DMchannelID => {
        reply.channel = DMchannelID
        reply.text = tipbot.tellHelp(user.is_admin)
        tipbot.slack.say(reply)
      })
      .catch()
    return
  }

  //  * RAIN (reward to users that have tipped others)
  if (tipbot.OPTIONS.ENABLE_RAIN_FEATURE && message.match(/\brain\b/i)) {

    // all users can check the balance of the Rain Account
    // get Rain User for OPTIONS
    if (tipbot.rainUser === undefined || tipbot.rainUser === null) {
      reply.text = tipbotTxt.RainCannotFindRainAccount1 + tipbot.OPTIONS.RAIN_USERNAME + tipbotTxt.RainCannotFindRainAccount2
      reply.text += tipbotTxt.RainExplain
      tipbot.slack.say(reply)
      return
    }
    // show balance of Rain Account, available to non-admin user
    rain.getRainBalance(tipbot.rainUser, function (err, rainBalance) {
      if (err) {
        reply.text = tipbotTxt.RainCannotFindRainBalance + tipbot.OPTIONS.RAIN_USERNAME
        tipbot.slack.say(reply)
        return
      } else {
        if (rainBalance !== undefined && rainBalance > 2e-8) {
          reply.text = tipbotTxt.RainAvailibleAmount + rainBalance + ' dash'
        } else {
          reply.text = tipbotTxt.RainEmpty
        }
        reply.text += '\n' + tipbotTxt.RainReqDonation1 + tipbot.OPTIONS.RAIN_USERNAME + '_'
        reply.text += '\n' + tipbotTxt.RainReqDonation2 + tipbot.OPTIONS.RAIN_USERNAME + tipbotTxt.RainReqDonation3
        // show threshold
        rain.getThreshold(tipbot.OPTIONS.RAIN_DEFAULT_THRESHOLD, function (err, threshold) {
          if (err) { debug(err); return }
          reply.text += '\n' + tipbotTxt.RainThreshold1 +
            Coin.toLarge(threshold) + ' Dash \n' +
            tipbotTxt.RainThreshold2
          // show amount of eligible users
          rain.getAmountOfEligibleRainUsers(
            function (err, count) {
              if (err) { debug(err) }
              reply.text += '\n' + count + tipbotTxt.RainAmountEligibleUsers
              tipbot.slack.say(reply)
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
              tipbot.privateReply.text = tipbotTxt.ERRORreadingDb + ': ' + err
              tipbot.slack.say(privateReply)
            }
            // show list all tippers
            privateReply.text = tipbotTxt.RainEligibleUsersList
            allTippers.forEach(function (tipper) {
              privateReply.text += tipper.name + '(' + tipper.id + ') has tipped ' + tipper.tipCount + ' times.\n'
            })
            //  debug(reply.text);
            tipbot.slack.say(privateReply)
          })
      }

      // threshold (rain will be cast if amount of rain balance > threshold)
      if (message.match(/\bthreshold\b/i)) {
        // set new threshold
        amount = message.match(tipbot.AMOUNT_REGEX) // only the number
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
              // rain.getThreshold(tipbot.OPTIONS.RAIN_DEFAULT_THRESHOLD,
              // function (err, threshold) {
              //     if (err) { debug(err); return; }
              //     reply.text += '\n' + tipbotTxt.RainThreshold1 +
              //         Coin.toLarge(threshold) + ' Dash \n' +
              //         tipbotTxt.RainThreshold2;
              //     tipbot.slack.say(reply);
              // });
              // threshold changed => check balance now
              tipbot.checkForRain(reply)
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
    } else if (message.match(/\bme\b/i)) {
      privateReply.text = 'Slack ID of user ' + user.name + ' = ' + user.id
    } else {
      privateReply.text = 'Sorry user not found.'
    }
    tipbot.slack.say(privateReply)

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
  tipbot.slack.say(reply)
}