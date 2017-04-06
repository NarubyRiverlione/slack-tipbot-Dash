'use strict'
let debug = require('debug')('tipbot:autowithdraw')
const autoWithdrawTxt = require('../text/txt_dash.js').autoWithdrawTxt

const REQUIRED_WITHDRAW_CONFIRMATIONS = 6 //todo: read from wallet

function showSetup(user) {
  return new Promise(
    (resolve, reject) => {
      getSetup(user.id)
        .then(options => {
          if (options === null) {
            // not setup for user
            resolve(user.name + autoWithdrawTxt.noSetup)
          }
          if (options.amount && options.address) {
            let line = user.name + autoWithdrawTxt.setupAmount_1 + options.amount + autoWithdrawTxt.setupAmount_2
            line += autoWithdrawTxt.setupAddress_1 + options.address + autoWithdrawTxt.setupAddress_2
            resolve(line)
          } else {
            debug('ERROR incomplete auto-withdraw setup for user ' + user.handle())
            reject(autoWithdrawTxt.errorIncompleteSetup)
          }
        })
        .catch(err => reject(err))
    })
}

function setup(userID, address, amount) {
  return new Promise(
    (resolve, reject) => {
      if (address === null || amount || null) {
        return reject('ERROR auto-withdraw: params address and amount are mandatory')
      }
      // save for user the address and amount to Db
      // todo: resolve: line 'saved',  reject: error line

    })
}

function check(user, wallet, walletPass) {
  return new Promise(
    (resolve, reject) => {
      // check if auto-withdraw is setup for user
      getSetup(user.id)
        .then(options => {
          if (options !== null && options.address !== null && options.amount !== null) {
            // auto-withdraw isn't setup for this user, no check needed
            return resolve()
          }
          // check balance > setup amount
          wallet.GetBalance(user.id, REQUIRED_WITHDRAW_CONFIRMATIONS)
            .then(balance => {
              if (balance > options.amount) {
                //  withdraw now
                const user =
                  wallet.Withdraw(options.amount, options.address, walletPass, user)
                    .then(result => {
                      debug('Preformed an auto-withdraw for user ' + user.handle())
                      debug(result)
                    })
                    .catch(err => reject(err)) // error withdraw
              }
            })
            .catch(err => reject(err)) // error get balance
        })
        .catch(err => reject(err)) // error getting auto-withdraw setup
    })


}

// return  if set options.amount and options.address, or null if not set
function getSetup(userID) {
  return new Promise(
    (resolve, reject) => {
      //todo read for userID setup form Db
    })
}

module.exports = { setup, showSetup, check }