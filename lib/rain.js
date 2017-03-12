'use strict';
let debug = require('debug')('tipbot:rain');
let helpTexts = require('../text/txt_dash.js').tipbotTxt;
let Coin = require('./coin');
let mongoose = require('mongoose');
let Tipper = mongoose.model('Tipper');

let _ = require('lodash');

let async = require('async');
require('waitjs');



let init = (rainUserName, users) => {
  let rainUser = null;
  // get tipbot user that hold the rain/rain balance
  let findRainUser = _.filter(users,
    function (match) {
      return match.name.match(rainUserName, 'i');
    });
  if (findRainUser === undefined || findRainUser.length !== 1) {
    debug('ERROR Init: ' + helpTexts.RainCannotFindRainAccount1 +
      rainUserName +
      helpTexts.RainCannotFindRainAccount2);
  } else {
    rainUser = findRainUser[0];
    debug('Init: Tipbot user \'' + rainUserName + '\' found : ' + rainUser.handle);
  }
  return rainUser;
};

// get the balance of the Rain Account
let getRainBalance = (rainUser, cb) => {
  if (rainUser === undefined || rainUser === null) {
    debug('ERROR Rain: ' + helpTexts.RainCannotFindRainAccount1);
    cb('UnknowRainUser', null); return;
  }
  // get balance of Rain User
  rainUser.getBalance(rainUser.id, 6, (err, rainBalance) => {
    if (err) { cb(err, null); return; }
    // return balance
    cb(null, rainBalance);
  });
};

let getAmountOfEligibleRainUsers = cb => {
  Tipper.count(
    { gotRainDrop: false },
    (err, amountOfTippers) => {
      cb(err, amountOfTippers);
    });
};

// get size of rainray in  SATHOSHI = rain balance / eligible users
function getRainRaySize(rainBalance, cb) {
  getAmountOfEligibleRainUsers(
    (err, amountOfTippers) => {
      if (err) {
        debug('ERROR Rain, cannot cast rainray as amount of eligible users in unknow.');
        cb(err, null);
      }
      let rainraySize = Coin.toSmall(rainBalance) / amountOfTippers;
      rainraySize -= 1; // 1 duff to prevent rouding errors so the last rainray is still enough
      debug('RAIN: ' + amountOfTippers + ' will recieve ' + Coin.toLarge(rainraySize));
      cb(null, rainraySize);
    });
}

// get list of all users that have tipped before and didn't recieved a rainray yet
let getListOfRainEligibleUsers = cb => {
  Tipper.find(
    { gotRainDrop: false },
    (err, allTippers) => {
      if (err) { cb(err, null); }
      cb(null, allTippers);
    });
};

// increment tip count in database for user on the record that hasn't recieverd a rainray yet
let incTipCountInDb = user => {
  // check if Tipper already exists in Db
  if (!user) {
    debug('ERROR saving tip to db: no user');
  } else {
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
        debug('Tip count for ' + user.name + ' incremented in database');
        // if (cb) { cb(data); }
      }
    );
  }
};

// mark all tipper records of a user as recieved a rainray, don't delete them so we have a history
function setTipperAsRecievedRain(tipperId, cb) {
  Tipper.update(
    { id: tipperId },
    { $set: { gotRainDrop: true } },
    { multi: true },// set all users tip record as used for rain, not only the first found
    err => {
      cb(err);
    });
}

// it's rainny day, look at all thoese rainrays !
function rainNow(rainUser, rainBalance, cb) {
  if (rainUser === undefined || rainUser === null) {
    cb('ERROR rain: cannot let is rain as rain User is unknown !');
    return;
  }
  if (rainBalance === undefined) {
    cb('ERROR rain:cannot make the rain shining as rainray size is unknown !');
    return;
  }
  if (rainBalance <= 2e-80) {
    // no rain available, don\'t continue
    cb(helpTexts.rainEmpty);
    return;
  }
  // get rainray size
  getRainRaySize(rainBalance, function (err, rainraySize) {
    if (err) { cb(err, null); return; }
    //get list of users that have tipped
    getListOfRainEligibleUsers(function (err, usersList) {
      async.forEachSeries(usersList,
        (oneUser, asyncCB) => {
          debug('Cast a rainray of ' + Coin.toLarge(rainraySize) + ' dash on ' + oneUser.name + ' (' + oneUser.id + ')');
          rainUser.send(oneUser, rainraySize, function (err) {
            if (err) { cb(err); return; }
            else {// mark this tipper records as recieved a rainray, don't delete them so we have a history
              setTipperAsRecievedRain(oneUser.id, function (err) {
                if (err) { asyncCB(err); return; }
                debug(oneUser.name + ' just recieved a rainray !');
                asyncCB();
              });
            }
          });
        },
        err => {
          cb(err, usersList, rainraySize);
        });
    });
  });
}

// check rain balance and trigger a rainshine when higher then the threshold
let checkThreshold = (defaultThreshold, rainUser, cb) => {
  getThreshold(defaultThreshold,
    (err, threshold) => {
      if (err) { cb(err); return; }
      getRainBalance(rainUser,
        function (err, rainBalance) {
          if (Coin.toSmall(rainBalance) >= threshold) {
            debug('Rain balance ' + rainBalance + ' > threshold ' + threshold + ' : cast rain now !!');
            rainNow(rainUser, rainBalance, function (err, reviecedUsers, rainraySize) {
              cb(err, reviecedUsers, rainraySize);
            });
          }
        });
    });

};

// get saved threshold (in Duffs), if not saved us default threshold
function getThreshold(defaultThreshold, cb) {
  Tipper.findOne(
    { name: 'threshold' },
    (err, thresholdRecord) => {
      if (err) {
        cb(err); return;
      }
      // use tipCount field to save threshold
      cb(null, thresholdRecord === null ? defaultThreshold : thresholdRecord.tipCount);
    }
  );
}

//  save threshold (in Duffs)
function saveThreshold(newThreshold, cb) {
  Tipper.findOneAndUpdate(
    { name: 'threshold' },
    { $set: { tipCount: newThreshold } },
    { upsert: true },
    err => {
      cb(err);
    }
  );
}

module.exports = {
  init,
  getRainBalance,
  getAmountOfEligibleRainUsers,
  getListOfRainEligibleUsers,
  incTipCountInDb,
  checkThreshold,
  getThreshold,
  saveThreshold
};
