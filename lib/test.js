
"use strict";
var CoinInfo = require("./CoinInfo");
var debug = require("debug")("tipbot:test");

var self = this;

self.OPTIONS = { PRICETICKER_BOUNDARY: 0.5 };

// Setup priceTicker
self.priceTicker = new CoinInfo("dash");
self.priceTicker.localCoin = "usd";
self.priceTicker.buyTitle = "BUY";
self.priceTicker.sellTitle = "SELL";
self.priceTicker.supplyTitle = "availible";
self.priceTicker.TitleBrokenLowBoundary = "--- Price dropped below the boundary. The new boundary is ";
self.priceTicker.TitleBrokenHighBoundary = "+++ Price rose above the boundary. The new boundary is ";
self.priceTicker.priceDigits = 4;
self.priceTicker.diffDigits = 2;
self.priceTicker.boundaryDigits = 1;
self.priceTicker.boundaryAlert = self.OPTIONS.PRICETICKER_BOUNDARY;
self.priceTicker.continuesOutput = false;   // only when boundary is broken or continues
// when showing new price info ?
if (self.priceTicker.continuesOutput) {
    debug("PriceTicker: Show " + self.priceTicker.name + " every " + this.OPTIONS.PRICETICKER_TIMER + " minutes");
} else {
    debug("PriceTicker: Only show show the priceticker when a boundary is broken" +
        "(" + self.priceTicker.boundaryAlert + self.priceTicker.localCoin + ")");
}
var newPrice = 10.0;

self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });

newPrice = 10.4;
self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });


newPrice = 10.6;
self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });

newPrice = 10.4;
self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });

newPrice = 10.9;
self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });

newPrice = 11.6;
self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });

newPrice = 9.0;
self.priceTicker.setNewPrices(newPrice,
    function () {
        var priceTickerMessage = self.priceTicker.getMessage();
        debug(priceTickerMessage);

    });
/*
var _ = require("lodash");
var debug = require("debug")("tipbot:test");
var async = require("async");

var dashd = require("bitcoin");
var parseArgs = require("minimist");
var argv = parseArgs(process.argv.slice(2));

var SLACK_TOKEN = argv["slack-token"] || process.env.TIPBOT_SLACK_TOKEN,
    RPC_USER = argv["rpc-user"] || process.env.TIPBOT_RPC_USER,
    RPC_PASSWORD = argv["rpc-password"] || process.env.TIPBOT_RPC_PASSWORD,
    RPC_PORT = argv["rpc-port"] || process.env.TIPBOT_RPC_PORT || 9998,
    AUTO_RECONNECT = true,
    OPTIONS = {
        ALL_BALANCES: true,
        DEMAND: true
    };


var wallet = new dashd.Client({
    host: "localhost",
    port: RPC_PORT,
    user: RPC_USER,
    pass: RPC_PASSWORD,
    timeout: 30000
});
*/
/*
var message ="@dashbot warn @naruby"; // don't say such things";

var personalMessage = message.replace(/\bwarn\b/i, "");
personalMessage = personalMessage.replace(/@(\S+)\s?/g,"");
console.log(personalMessage.length > 1 ? personalMessage : "Nothing");
*/

/*
var onlineUsers = {
    "1": "azerty",
    "2": "qsdfg",
    "3": "wxcvbn"
};
var tasks = [];
_.each(onlineUsers, function (oneUserValue, oneUserKey) {
    debug(oneUserKey + " = " + oneUserValue);
    tasks.push(function (cb) {
        debug("+ for tasks: " + oneUserValue);
        cb();
    });
});

debug("Execute all tasks synchrone")
_.each(tasks, function (task) {
    task(function () {
        debug("-- task done!");
    });
});

debug("Execute ASYNC");
async.series(tasks,
    function (err) {
        debug("--- all async tasks are done");
    });

debug("ASYNC direct onlineUsers");
async.forEach(_.keys(onlineUsers), function (oneUser, cb) {
     debug(oneUser);
     cb();
}, function (err) {
    debug("--- all async tasks are done");
});


*/

// wallet.getInfo( function (err, resp, resHeaders) {
//     if (err) {
//         console.log("ERROR getting info: ", err);

//     } else {
//         console.log(resp);
//     }
// });

// var id = "eeee";

// wallet.getBalance(id, 6, function (err, balance, resHeaders) {
//     if (err) {
//         console.log("ERROR getting confirmed balance: ", err);

//     } else {
//         console.log("Balance for " + id + " = ".balance);
//     }
// });