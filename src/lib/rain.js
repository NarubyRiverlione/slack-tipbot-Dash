'use strict'
let debug = require('debug')('tipbot:rain')
let helpTexts = require('../text/txt_dash.js').tipbotTxt
let Coin = require('./coin')
let mongoose = require('mongoose')
let Tipper = mongoose.model('Tipper')

let _ = require('lodash')

let async = require('async')
require('waitjs')


module.exports = class Rain {
  constructor(rainUserName, users) {
    this.rainUser = null
    // get tipbot user that hold the rain/rain balance
    let findRainUser = _.filter(users,
      function (match) {
        return match.name.match(rainUserName, 'i')
      })
    if (findRainUser === undefined || findRainUser.length !== 1) {
      debug('ERROR Init: ' + helpTexts.RainCannotFindRainAccount1 +
        rainUserName +
        helpTexts.RainCannotFindRainAccount2)
    } else {
      debug('Init: Tipbot user \'' + rainUserName + '\' found : ' + this.rainUser.handle)
      this.rainUser = findRainUser[0]
    }
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
        wallet.getBalance(this.rainUser.id, 6, (err, rainBalance) => {
          if (err) { return reject(err) }
          // return balance
          resolve(rainBalance)
        })
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
            resolve(rainraySize)
          })
          .catch(err => {
            debug('ERROR Rain, cannot cast rainray as amount of eligible users in unknow.')
            return reject(err)
          })
      })
  }

  // check rain balance and trigger a rainshine when higher then the threshold
  CheckThreshold(defaultThreshold, wallet) {
    return new Promise(
      (resolve, reject) => {
        getThreshold(defaultThreshold,
          (err, threshold) => {
            if (err) { return reject(err) }
            this.getRainBalance(this.rainUser, wallet)
              .then(rainBalance => {
                if (Coin.toSmall(rainBalance) >= threshold) {
                  debug('Rain balance ' + rainBalance + ' > threshold ' + threshold + ' : cast rain now !!')

                  rainNow(this.rainUser, rainBalance, function (err, reviecedUsers, rainraySize) {
                    resolve({ reviecedUsers, rainraySize })
                  })
                }
              })
          })
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
}

// get list of all users that have tipped before and didn't recieved a rainray yet
function getListOfRainEligibleUsers() {
  return new Promise(
    (resolve, reject) => {
      Tipper.find(
        { gotRainDrop: false },
        (err, allTippers) => {
          if (err) { return reject(err) }
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

// get saved threshold (in Duffs), if not saved us default threshold
function getThreshold(defaultThreshold) {
  return new Promise(
    (resolve, reject) => {
      Tipper.findOne(
        { name: 'threshold' },
        (err, thresholdRecord) => {
          if (err) {
            return reject(err)
          }
          // use tipCount field to save threshold
          resolve(thresholdRecord === null ? defaultThreshold : thresholdRecord.tipCount)
        }
      )
    })
}



// it's rainny day, look at all thoese rainrays !
function rainNow(rainBalance, wallet) {
  return new Promise(
    (resolve, reject) => {
      if (!this.rainUser) {
        return reject('ERROR rain: cannot let is rain as rain User is unknown !')
      }
      if (rainBalance === undefined) {
        return reject('ERROR rain:cannot make the rain shining as rainray size is unknown !')
      }
      if (rainBalance <= 2e-80) {
        // no rain available, don\'t continue
        return reject(helpTexts.rainEmpty)
      }
      // get rainray size
      this.getRainRaySize(rainBalance)
        .then(rainraySize => {
          //get list of users that have tipped
          getListOfRainEligibleUsers(function (err, usersList) {
            async.forEachSeries(usersList,
              (oneUser, asyncCB) => {
                debug('Cast a rainray of ' + Coin.toLarge(rainraySize) + ' dash on ' + oneUser.name + ' (' + oneUser.id + ')')
                wallet.Move(oneUser, rainraySize, this.rainUser)
                  .then(() => {
                    // mark this tipper records as recieved a rainray, don't delete them so we have a history
                    setTipperAsRecievedRain(oneUser.id, function (err) {
                      if (err) { asyncCB(err); return }
                      debug(oneUser.name + ' just recieved a rainray !')
                      asyncCB()
                    })
                  })
                  .catch(err => { return reject(err) })
              },
              err => {
                if (err) { return reject }
                resolve({ usersList, rainraySize })
              })
          })
        })
        .catch(err => { return reject(err) })
    })
}