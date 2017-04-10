'use strict'
// const debug = require('debug')('tipbot:autowithdraw')
const autoWithdrawTxt = require('../text/txt_dash.js').autoWithdrawTxt
const mongoose = require('mongoose')
const AutowithdrawModel = mongoose.model('Autowithdraw')
const Coin = require('./coin.js')

const REQUIRED_WITHDRAW_CONFIRMATIONS = 6 //todo: read from wallet

function ShowSetup(user) {
  return new Promise(
    (resolve, reject) => {
      getSetup(user.id)
        .then(options => {
          if (options === null) {
            // not setup for user
            resolve(user.name + autoWithdrawTxt.noSetup)
          }
          let line = user.name

          if (!options.amount || options.amount === 0 || !options.amount || options.amount === '')
            // incomplete  setup => add warning disabled  
            line += autoWithdrawTxt.disabled + '\n\n'
          else
            // complete setup => say how to disable
            line += autoWithdrawTxt.setup_4
          line += '\n\n'
          // amount
          line += autoWithdrawTxt.setup_1 +
            (options.amount ? options.amount + ' dash'
              : autoWithdrawTxt.notSet)
          // address
          line += '\n' + autoWithdrawTxt.setup_2 +
            (options.address ?
              options.address + autoWithdrawTxt.setup_3
              : autoWithdrawTxt.notSet)

          resolve(line)
        })
        .catch(err => reject(err))
    })
}

function SaveSetup(userID, address, amount) {
  return new Promise(
    (resolve, reject) => {
      if (address === null || amount === null) {
        return reject('ERROR auto-withdraw: params address and amount are mandatory')
      }
      // save for user the address and amount to Db
      AutowithdrawModel.findOneAndUpdate(
        { userID },
        { $set: { address, amount } },
        { upsert: true },
        () => {
          resolve()
        }
      )
    })
}

function Check(user, wallet, walletPass) {
  return new Promise(
    (resolve, reject) => {

      let autowithdrawSetup
      // check if auto-withdraw is setup for user
      getSetup(user.id)
        .then(options => {
          if (options === null || options.address === null || options.amount === null)
            // auto-withdraw isn't setup for this user, no check needed
            return resolve()
          if (options.address === '' || options.amount === 0)
            // user disabled autowithdraw
            return resolve()

          autowithdrawSetup = { options, user }
          // check balance > setup amount
          return wallet.GetBalance(user.id, REQUIRED_WITHDRAW_CONFIRMATIONS)
        })
        // error getting auto-withdraw setup
        .catch(err =>
          reject('ERROR get auto withdraw  setup for ' + user.handle + '\n' + err)
        )

        // get balance and compare to set threshold
        .then(balance => {
          if (Coin.toSmall(balance) > autowithdrawSetup.options.amount) {
            //  withdraw complete balance now
            return wallet.Withdraw(Coin.toSmall(balance), autowithdrawSetup.options.address, walletPass, autowithdrawSetup.user)
          }
          return resolve()
        })
        // error get balance
        .catch(err =>
          reject('ERROR get balance: ' + err)
        )

        // result of withdraw
        .then(blockchainTxLine => {
          let line = autowithdrawSetup.user.handle + autoWithdrawTxt.executed_1 + blockchainTxLine
          return resolve(line)

        })
        //error withdraw
        .catch(err => {
          return reject('ERROR sending withdraw to ' + user.handle + ': ' + err)
        })
    })
}

// return  if set options.amount and options.address, or null if not set
function getSetup(userID) {
  return new Promise(
    (resolve, reject) => {
      AutowithdrawModel.findOne(
        { userID },
        (err, record) => {
          if (err) return reject(err)
          resolve(record)
        }
      )
    })
}

module.exports = { SaveSetup, ShowSetup, Check }