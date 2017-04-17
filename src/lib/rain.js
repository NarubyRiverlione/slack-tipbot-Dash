'use strict'

let debug = require('debug')('tipbot:rain')
let helpTexts = require('../text/txt_dash.js').tipbotTxt
let Coin = require('./coin')
let mongoose = require('mongoose')
let Tipper = mongoose.model('Tipper')

let _ = require('lodash')

const RAIN_DEFAULT_THRESHOLD = Coin.toSmall(0.5)

module.exports = class Rain {
  constructor(rainUserName, users) {
    this.rainUser = null

    // get tipbot user that hold the rain/rain balance
    let findRainUser = _.filter(users,
      function (match) {
        return match.name.match(rainUserName, 'i')
      })
    if (findRainUser === undefined || findRainUser.length !== 1) {
      debug('ERROR Init: ' + helpTexts.RainCannotFindRainAccount1 + rainUserName + helpTexts.RainCannotFindRainAccount2)

    } else {
      this.rainUser = findRainUser[0]
      debug('Init: Tipbot user \'' + rainUserName + '\' found : ' + this.rainUser.handle)
    }
  }
  // Get Rain status
  GetRainStatus(wallet) {
    let replyTxt
    return new Promise(
      (resolve, reject) => {
        // show balance of Rain Account, available to non-admin user
        this.GetRainBalance(wallet)
          .then(rainBalance => {
            if (rainBalance !== undefined && rainBalance > 2e-8) {
              replyTxt = helpTexts.RainAvailibleAmount + rainBalance + ' dash'
            } else {
              replyTxt = helpTexts.RainEmpty
            }
            replyTxt += '\n' + helpTexts.RainReqDonation1 + this.rainUser.handle + '_'
            replyTxt += '\n' + helpTexts.RainReqDonation2 + this.rainUser.handle + helpTexts.RainReqDonation3
            // show threshold
            return this.GetThreshold()
          })
          .catch(err => {
            debug(err); return reject(err)
          })


          .then(threshold => {
            replyTxt += '\n' + helpTexts.RainThreshold1 +
              Coin.toLarge(threshold) + ' Dash \n' +
              helpTexts.RainThreshold2
            // show amount of eligible users
            return this.GetAmountOfEligibleRainUsers()
          })
          .catch(err => {
            debug(err); return reject(err)
          })


          .then(count => {
            replyTxt += '\n' + count + helpTexts.RainAmountEligibleUsers
            resolve(replyTxt)
          })
          .catch(err => {
            debug('ERROR get rain balance: ' + err)
            replyTxt = helpTexts.RainCannotFindRainBalance + this.rainUser.handle
            reject(replyTxt)
          })
      })
  }
  // get the balance of the Rain Account
  GetRainBalance(wallet) {
    return new Promise(
      (resolve, reject) => {
        if (!this.rainUser) {
          debug('ERROR Rain: ' + helpTexts.RainCannotFindRainAccount1)
          return reject('UnknowRainUser')
        }
        // get balance of Rain User
        wallet.GetBalance(this.rainUser.id, 6)
          .then(rainBalance => {
            // return balance
            resolve(rainBalance)
          })
          .catch(err => reject(err))
      })
  }
  // get size of rainray in  SATHOSHI = rain balance / eligible users
  GetRainRaySize(rainBalance) {
    return new Promise(
      (resolve, reject) => {
        this.GetAmountOfEligibleRainUsers()
          .then(amountOfTippers => {
            let rainraySize = Coin.toSmall(rainBalance) / amountOfTippers
            rainraySize -= 1 // 1 duff to prevent rouding errors so the last rainray is still enough
            debug('RAIN: ' + amountOfTippers + ' will recieve ' + Coin.toLarge(rainraySize))
            return resolve(rainraySize)
          })
          .catch(err => {
            debug('ERROR Rain, cannot cast rainray as amount of eligible users in unknow.')
            return reject(err)
          })
      })
  }
  // check rain balance and trigger a rainshine when higher then the threshold
  CheckThreshold(defaultThreshold, wallet) {
    let rainThreshold, rainBalance
    const rainUser = this.rainUser
    return new Promise(
      (resolve, reject) => {
        this.GetThreshold(defaultThreshold)
          .then(threshold => {
            rainThreshold = threshold
            return this.GetRainBalance(wallet)
          })
          .catch(err => reject(err))

          .then(balance => {
            rainBalance = balance
            if (Coin.toSmall(rainBalance) >= rainThreshold) {
              debug('Rain balance ' + rainBalance + ' > threshold ' + rainThreshold + ' : cast rain now !!')
              this.GetRainRaySize(rainBalance)
                .then(rainSize => {
                  return rainNow(rainBalance, rainSize, rainUser, wallet)
                })
                .catch(err => reject(err))

                .then(rainResult => {
                  debug(rainResult)
                  resolve(rainResult)
                })
                .catch(err => reject(err))

            } else {
              resolve()
            }
          })
          .catch(err => reject(err))
      })
  }
  //  save threshold (in Duffs)
  SaveThreshold(newThreshold) {
    return new Promise(
      (resolve, reject) => {
        Tipper.findOneAndUpdate(
          { name: 'threshold' },
          { $set: { tipCount: newThreshold } },
          { upsert: true },
          err => {
            reject(err)
          })
        resolve()
      })
  }
  // increment tip count in database for user on the record that hasn't recieverd a rainray yet
  IncTipCountInDb(user) {
    return new Promise(
      (resolve, reject) => {
        // check if Tipper already exists in Db
        if (!user) {
          debug('ERROR saving tip to db: no user')
          return reject()
        }
        Tipper.findOneAndUpdate(
          // filter
          {
            id: user.id, gotRainDrop: false
          },
          // update/insert fields
          {
            $set: { name: user.name, id: user.id },
            $inc: { tipCount: 1 },
            $currentDate: { lastTipDate: true }
          },
          // insert new, update existing
          {
            upsert: true
          },
          // callback
          () => {
            debug('Tip count for ' + user.name + ' incremented in database')
            resolve()
          }
        )
      })
  }

  GetAmountOfEligibleRainUsers() {
    return new Promise(
      (resolve, reject) => {

        Tipper.count(
          { gotRainDrop: false },
          (err, amountOfTippers) => {
            if (err) { return reject(err) }
            resolve(amountOfTippers)
          })
      })
  }
  // get saved threshold (in Duffs), if not saved us default threshold
  GetThreshold() {
    return new Promise(
      (resolve, reject) => {
        Tipper.findOne(
          { name: 'threshold' },
          (err, thresholdRecord) => {
            if (err) {
              return reject(err)
            }
            // use tipCount field to save threshold
            resolve(thresholdRecord === null ? RAIN_DEFAULT_THRESHOLD : thresholdRecord.tipCount)
          }
        )
      })
  }

  GetListOfRainEligibleUsers() {
    return getListOfRainEligibleUsers()
  }
}

// get list of all users that have tipped before and didn't recieved a rainray yet
function getListOfRainEligibleUsers() {
  return new Promise(
    (resolve, reject) => {
      Tipper.find(
        { gotRainDrop: false },
        (err, allTippers) => {
          if (err) {
            return reject(err)
          }
          resolve(allTippers)
        })
    })
}

// mark all tipper records of a user as recieved a rainray, don't delete them so we have a history
function setTipperAsRecievedRain(tipperId) {
  return new Promise(
    (resolve, reject) => {
      Tipper.update(
        { id: tipperId },
        { $set: { gotRainDrop: true } },
        { multi: true },// set all users tip record as used for rain, not only the first found
        err => {
          reject(err)
        })
      resolve()
    })
}

// it's rainny day, look at all thoese rainrays !
function rainNow(rainBalance, rainSize, rainUser, wallet) {
  return new Promise(
    (resolve, reject) => {
      if (!rainUser) {
        return reject('ERROR rain: cannot let it rain as rain User is unknown !')
      }
      if (!rainBalance) {
        return reject('ERROR rain: cannot let it rain as rain amount (balance) is unknown !')
      }
      if (rainBalance <= 2e-80) {
        // no rain available, don\'t continue
        return reject(helpTexts.rainEmpty)
      }
      if (!rainSize) {
        return reject('ERROR rain: cannot let it rain as rain size is unknown !')
      }

      //get list of users that have tipped
      getListOfRainEligibleUsers()
        .then(usersList => {
          let promiseSequence = Promise.resolve() // empty promise
          usersList.forEach(oneUser => {
            promiseSequence = promiseSequence.then(() => { return cast1raindrop(oneUser, rainSize, rainUser, wallet) }).catch(err => { debug(err) })
          })
          // when all is done
          resolve({ reviecedUsers: usersList, rainSize })
        })
        .catch(err =>
          reject('ERROR: cannnot cast rain because error in getting List Of Rain EligibleUsers:' + err)
        )
    })
}

function cast1raindrop(oneUser, rainSize, rainUser, wallet) {
  return new Promise(
    (resolve, reject) => {
      debug('Cast a rainray of ' + Coin.toLarge(rainSize) + ' dash on ' + oneUser.name + ' (' + oneUser.id + ')')
      wallet.Move(oneUser, rainSize, rainUser)
        .then(() => {
          // mark this tipper records as recieved a rainray, don't delete them so we have a history
          setTipperAsRecievedRain(oneUser.id)
            .then(() => {
              debug(oneUser.name + ' just recieved a rainray !')
              resolve()
            })
            .catch(err => reject(err))
        })
        .catch(err => reject(err))
    })
}