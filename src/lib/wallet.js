'use strict'

let debug = require('debug')('tipbot:user')

let dashd = require('bitcoin')

let helpText = require('../text/txt_dash.js').userTxt
let Coin = require('./coin')

const BLOCKCHAIN_EXPLORER_URL = 'https://chainz.cryptoid.info/dash/tx.dws?'

const REQUIRED_WITHDRAW_CONFIRMATIONS = 6
const REQUIRED_TIP_CONFIRMATIONS = 5 // to immediately be able to send a tip after deposit with InstantSend

module.exports = class Wallet {
  constructor(RPC_PORT, RPC_USER, RPC_PASSWORD, HighBalanceWarningMark, TX_FEE) {
    // create connection via RPC to wallet
    this.walletDaemon = new dashd.Client({
      host: 'localhost',
      port: RPC_PORT,
      user: RPC_USER,
      pass: RPC_PASSWORD,
      timeout: 30000
    })

    this.HighBalanceWarningMark = HighBalanceWarningMark
    this.TX_FEE = TX_FEE
  }

  GetBalanceLine(user) {
    let balanceText = ''
    let confirmedBalance = 0.0

    return new Promise(
      (resolve, reject) => {
        this.GetBalance(user.id, REQUIRED_TIP_CONFIRMATIONS)
          .then(balance => {
            if (balance === 0) { return reject(helpText.NoBalance) }
            balanceText = user.handle + helpText.BalanceIs + balance + ' ' + helpText.BaseCurrency
            // check for High Balance
            if (Coin.toSmall(balance) >= this.HighBalanceWarningMark) {
              // warn user
              balanceText += '\n *' + helpText.BalanceWarningHigh + '*'
            }
            confirmedBalance = balance
            // check if there is an unconfirmed balance
            return this.GetBalance(user.id, 1)
          })
          .catch(err => { return reject(err) })

          .then(unconfirmedBalance => {
            if (unconfirmedBalance !== confirmedBalance) {
              // add unconfirmed balance information to the text
              balanceText += '\n' + helpText.UnconfirmedBalance1 + REQUIRED_WITHDRAW_CONFIRMATIONS +
                helpText.UnconfirmedBalance2 + unconfirmedBalance + ' ' + helpText.BaseCurrency
            }
            debug(balanceText + ' (' + user.id + ')')
            resolve(balanceText)
          })
          .catch(err => { return reject(err) })
      })
  }

  // reusable getBalance function
  GetBalance(userID, reqConfirmantions) {
    return new Promise(
      (resolve, reject) => {
        // debug('Get balance with ' + reqConfirmantions + ' confirmations for ' + userID);
        this.walletDaemon.getBalance(userID, reqConfirmantions,
          (err, balance) => {
            if (err) {
              let errorTx = 'ERROR getting balance with ' + reqConfirmantions + ' confirmations: ' + err
              debug(errorTx)
              return reject(errorTx)
            }
            resolve(balance)
          })
      })
  }

  TellDepositeAddress(user) {
    let depositAddress
    return new Promise(
      (resolve, reject) => {
        // get all addresses in de the wallet for this user
        // should be 1 if users has already an account, if he hasn't give hem one now
        this.walletDaemon.getAddressesByAccount(user.id,
          (err, addresses) => {
            if (err) { return reject(err) }
            if (addresses !== undefined && addresses.length > 0) {
              // found an address for this userID in the wallet
              depositAddress = addresses[0] // get first address
              debug('Existing address for ' + user.handle + '  ' + depositAddress)
              resolve(user.handle + ' you can deposit to: ' + depositAddress)
            } else {
              // didn't find an address for this user in the wallet, create an account now
              this.walletDaemon.getNewAddress(user.id,
                (err, address) => {
                  if (err) { reject(err) }
                  depositAddress = address
                  debug('New address for ' + user.handle + '  ' + depositAddress)
                  resolve(user.handle + ' you can deposit to: ' + depositAddress)
                })
            }
          })
      })
  }

  // value is in smallCoin !
  Withdraw(value, toAddress, walletPass, user) {
    // substract tx fee from amount
    const withdrawAmount = value - this.TX_FEE

    return new Promise(
      (resolve, reject) => {
        // prevent multiple transactions, only continue if not already locked
        if (user.locked === true) {
          let error = user.handle + helpText.Locked
          return reject(error)
        }
        // lock now to prevent new transactions
        user.locked = true

        this.GetBalance(user.id, REQUIRED_WITHDRAW_CONFIRMATIONS)
          .then(balance => {
            balance = Coin.toSmall(balance)
            if (balance < value) {
              // not enough balance
              user.locked = false
              let error = helpText.InsufficientBalance1 + user.handle + helpText.InsufficientBalance2
              return reject(error)
            }
            // enough balance
            // unlock wallet if needed
            return unlockWalletIfNeeded(this.walletDaemon, walletPass)
          })
          // error getting balance
          .catch(err => {
            user.locked = false
            return reject(err)
          })

          // wallet is now unlocked, send now
          .then(() => {
            return sendAmount(user.id, toAddress, withdrawAmount, this.walletDaemon, this.TX_FEE)
          })
          // error unlocking wallet
          .catch(err => {
            user.locked = false
            return reject(err)
          })

          //  this transaction is done, clear lock to allow new transactions
          .then(blockchainTxLine => {
            user.locked = false
            resolve(blockchainTxLine)
          })
          // error send amount
          .catch(err => {
            user.locked = false
            reject(err)
          })
      })
  }
  // value is in smallCoin !
  Move(sendToUser, value, user) {
    let error = ''
    return new Promise(
      (resolve, reject) => {

        // prevent multiple transactions, only continue if not already locked
        if (user.locked === true) {
          error = user.handle + helpText.Locked
          return reject(error)
        }
        // lock now to prevent new transactions
        user.locked = true

        // check balance before sending amount to prevent negative saldo
        this.GetBalance(user.id, REQUIRED_TIP_CONFIRMATIONS)
          .then(balance => {
            balance = Coin.toSmall(balance)
            if (balance < value) {
              error = helpText.InsufficientBalance1 + user.handle + helpText.InsufficientBalance2
              user.locked = false //  this transaction is done, clear lock to allow new transactions
              return reject(error)
            }
            // use a in wallet transfer
            this.walletDaemon.move(user.id, sendToUser.id, parseFloat(Coin.toLarge(value)),
              (err, result) => {
                if (err) {
                  debug('ERROR: moving between account (' + user.id + ') to acount (' + sendToUser.id + ')' + err)
                  error = helpText.SendOops1 + Coin.toLarge(value) + ' ' + helpText.BaseCurrency + helpText.SendOops2 + sendToUser.name + ''
                  user.locked = false //  this transaction is done, clear lock to allow new transactions
                  return reject(error)
                }
                if (result === true) {
                  debug('Sending Tip: Moved ' + Coin.toLarge(value) + ' Dash from ' + user.handle + ' to ' + sendToUser.name + '(' + sendToUser.id + ')')
                  // prepare message in channel where Tip command was issued
                  let responses = {
                    public: helpText.SendPublicMessage1 + user.handle + helpText.SendPublicMessage2 + sendToUser.handle
                  }
                  //  prepare message to recieving user to inform of tip
                  responses.privateToReciever = helpText.SendPrivateMssRecievingUser1 + sendToUser.handle +
                    helpText.SendPrivateMssRecievingUser2 + Coin.toLarge(value) + ' ' +
                    helpText.BaseCurrency + helpText.SendPrivateMssRecievingUser3 + user.handle + ' !'
                  // prepare message to sending user to inform of new balance
                  this.GetBalanceLine(user)
                    .then(balanceLine => {
                      responses.privateToSender = user.handle + helpText.SendPrivateMssSendingUser + balanceLine
                      user.locked = false //  this transaction is done, clear lock to allow new transactions
                      // all responses are prepared, send them in tipbot.js
                      resolve(responses)
                    })
                    .catch(err => { debug(err) })
                } else {
                  // result == false
                  error = helpText.SendOops1 + Coin.toLarge(value) + ' ' + helpText.BaseCurrency + helpText.SendOops2 + sendToUser.name + ''
                  user.locked = false  //  this transaction is done, clear lock to allow new transactions
                  reject(error)
                }

              })

          })
          .catch(err => {
            debug('ERROR checking balance before sending tip: ' + err)
            let error = 'ERROR checking balance before sending tip.'
            user.locked = false //  this transaction is done, clear lock to allow new transactions
            return reject(error)
          })
      })
  }
}

// private functions
// send via Blockchain
function sendAmount(fromAccount, toAddress, value, walletDaemon, tx_fee) {
  return new Promise(
    (resolve, reject) => {
      // send  users Account to Address
      walletDaemon.sendFrom(fromAccount, toAddress, parseFloat(Coin.toLarge(value)),
        (err, tx_id) => {
          if (err) {
            debug('ERROR sending via blockchain : ' + err)
            let error = 'An error prevents withdrawing.'
            return reject(error)
          }
          let url = BLOCKCHAIN_EXPLORER_URL + tx_id
          let withdrawAmount = value + tx_fee
          let line = helpText.Withdrawal1 + Coin.toLarge(withdrawAmount).toString() + ' ' +
            helpText.BaseCurrency + ' to ' +
            toAddress +
            helpText.WithdrawalTransaction +
            url
          return resolve(line)
        })
    })
}

// unlock the wallet for 10 seconds if a passPhrase is provided
function unlockWalletIfNeeded(walletDaemon, walletPass) {
  return new Promise(
    (resolve, reject) => {
      // no password supplied = no unlocking needed
      if (!walletPass) resolve()
      walletDaemon.walletPassphrase(walletPass, 10,
        err => {
          if (err) {
            let error = 'ERROR could not unlock the wallet because: '
            debug(error + err)
            reject(err)
          }
          resolve()
        })
    })
}

