'use strict';
let debug = require('debug')('tipbot:sun');
let helpTexts = require('../text/txt_dash.js').tipbotTxt;
let dash = require('./dash');
let mongoose = require('mongoose');
let Tipper = mongoose.model('Tipper');

let _ = require('lodash');

let async = require('async');
require('waitjs');



let init = function (sunUserName, users) {
    let sunUser = null;
    // get tipbot user that hold the sun/rain balance
    let findSunUser = _.filter(users,
        function (match) {
            return match.name.match(sunUserName, 'i');
        });
    if (findSunUser === undefined || findSunUser.length !== 1) {
        debug('ERROR Init: ' + helpTexts.SunCannotFindSunAccount1 +
            sunUserName +
            helpTexts.SunCannotFindSunAccount2);
    } else {
        sunUser = findSunUser[0];
        debug('Init: Tipbot user \'' + sunUserName + '\' found : ' + sunUser.handle);
    }
    return sunUser;
};

// get the balance of the Sun Account
let getSunBalance = function (sunUser, cb) {
    if (sunUser === undefined || sunUser === null) {
        debug('ERROR Sun: ' + helpTexts.SunCannotFindSunAccount1);
        cb('UnknowSunUser', null);
    }
    // get balance of Sun User
    sunUser.getBalance(sunUser.id, 6, function (err, sunBalance) {
        if (err) { cb(err, null); }
        // return balance
        cb(null, sunBalance);
    });
};

let getAmountOfEligibleSunUsers = function (cb) {
    Tipper.count(
        { gotSunshine: false },
        function (err, amountOfTippers) {
            cb(err, amountOfTippers);
        });
};

// get size of sunray in  SATHOSHI = sun balance / eligible users
function getSunRaySize(sunBalance, cb) {
    getAmountOfEligibleSunUsers(
        function (err, amountOfTippers) {
            if (err) {
                debug('ERROR Sun, cannot cast sunray as amount of eligible users in unknow.');
                cb(err, null);
            }
            let sunraySize = dash.toDuff(sunBalance)  / amountOfTippers ;
            sunraySize -= 1; // 1 duff to prevent rouding errors so the last sunray is still enough
            debug('SUN: ' + amountOfTippers + ' will recieve ' + dash.toDash(sunraySize));
            cb(null, sunraySize);
        });
}

// get list of all users that have tipped before and didn't recieved a sunray yet
let getListOfSunEligibleUsers = function (cb) {
    Tipper.find(
        { gotSunshine: false },
        function (err, allTippers) {
            if (err) { cb(err, null); }
            cb(null, allTippers);
        });
};

// increment tip count in database for user on the record that hasn't recieverd a sunray yet
let incTipCountInDb = function (user) {
    // check if Tipper already exists in Db
    if (!user) {
        debug('ERROR saving tip to db: no user');
    } else {
        Tipper.findOneAndUpdate(
            // filter
            {
                id: user.id, gotSunshine: false
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
            function () {
                debug('Tip count for ' + user.name + ' incremented in database');
                // if (cb) { cb(data); }
            }
        );
    }
};

// mark all tipper records of a user as recieved a sunray, don't delete them so we have a history
function setTipperAsRecievedSun(tipperId, cb) {
    Tipper.update(
        { id: tipperId },
        { $set: { gotSunshine: true } },
        { multi: true },    // set all users tip record as used for sun, not only the first found
        function (err) {
            cb(err);
        });
}

// it's sunny day, look at all thoese sunrays !
function shineNow(sunUser, sunBalance, cb) {
    if (sunUser === undefined || sunUser === null) {
        cb('ERROR sun: cannot let is sun as sun User is unknown !');
        return;
    }
    if (sunBalance === undefined) {
        cb('ERROR sun:cannot make the sun shining as sunray size is unknown !');
        return;
    }
    if (sunBalance <= 2e-80) {
        // no sun available, don\'t continue
        cb(helpTexts.sunEmpty);
        return;
    }
    // get sunray size
    getSunRaySize(sunBalance, function (err, sunraySize) {
        if (err) { cb(err, null); return; }
        //get list of users that have tipped
        getListOfSunEligibleUsers(function (err, usersList) {
            async.forEachSeries(usersList,
                function (oneUser, asyncCB) {
                    debug('Cast a sunray of ' + dash.toDash(sunraySize) + ' dash on ' + oneUser.name + ' (' + oneUser.id + ')');
                    sunUser.send(oneUser, sunraySize, function (err) {
                        if (err) { cb(err); return; }
                        else {// mark this tipper records as recieved a sunray, don't delete them so we have a history
                            setTipperAsRecievedSun(oneUser.id, function (err) {
                                if (err) { asyncCB(err); return; }
                                debug(oneUser.name + ' just recieved a sunray !');
                                asyncCB();
                            });
                        }
                    });
                },
                function (err) {
                    cb(err, usersList, sunraySize);
                });
        });
    });
}

// check sun balance and trigger a sunshine when higher then the threshold
let checkThreshold = function (threshold, sunUser, cb) {
    if (threshold !== undefined) {
        getSunBalance(sunUser,
            function (err, sunBalance) {
                if (dash.toDuff(sunBalance) >= threshold) {
                    debug('Sun balance ' + sunBalance + ' > threshold ' + threshold + ' : cast sun now !!');
                    shineNow(sunUser, sunBalance, function (err, reviecedUsers, sunraySize) {
                        cb(err, reviecedUsers, sunraySize);
                    });
                }
            });
    }
};

module.exports = {
    init,
    getSunBalance,
    getAmountOfEligibleSunUsers,
    getListOfSunEligibleUsers,
    incTipCountInDb,
    checkThreshold
};
