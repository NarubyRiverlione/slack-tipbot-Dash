"use strict";
var debug = require("debug")("tipbot:CoinInfo");
//var moment = require("moment");

// init = constructor
function CoinInfo(name) {
    this.buyPrice = 0.0;
    this.sellPrice = 0.0;
    this.priceDigits = 0;

    this.buyDiff = 0.0;
    this.sellDiff = 0.0;
    this.diffDigits = 0;

    this.buyBoundary = 0.0;
    this.sellBoundary = 0.0;
    this.boundaryDigits = 0.0;

    this.boundaryAlert = 0.0;
    // to show boundary information at start set to true
    this.buyBoundaryAlert = true;
    this.sellBoundaryAlert = true;

    this.TitleBrokenSellBoundary = "";
    this.TitleBrokenBuyBoundary = "";

    this.supply = 0;

    this.name = name;

    this.localCoin = "";
    this.buyTitle = "";
    this.sellTitle = "";
    this.supplyTitle = "";

    this.continuesOutput = true;

}

// set new buy price
CoinInfo.prototype.setBuyPrice = function (newBuy, outputCallback) {
    var newBuyBoundary = roundDown(newBuy, this.boundaryDigits) - this.boundaryAlert;

    if (this.buyPrice !== 0) {
        this.buyDiff = newBuy - this.buyPrice;
        if (newBuyBoundary < this.buyBoundary) this.buyBoundaryAlert = true;
    } else {
        // first time a price is recieved, output is as a new boundary
        this.buyBoundaryAlert = true;
    }

    this.buyBoundary = newBuyBoundary;
    this.buyPrice = newBuy;
    // output only if continues wanted or if there is a boundary alert
    if (outputCallback !== undefined && (this.continuesOutput === true || this.buyBoundaryAlert === true)) {
        outputCallback();
    }
};

// set new Sell price
CoinInfo.prototype.setSellPrice = function (newSell, outputCallback) {
    var newSellBoundary = roundDown(newSell, this.boundaryDigits) + this.boundaryAlert;

    if (this.sellPrice !== 0.0) {
        this.sellDiff = newSell - this.sellPrice;
        if (newSellBoundary > this.sellBoundary) {
            this.sellBoundaryAlert = true;
        }
    } else {
        // first time a price is recieved, output is as a new boundary
        this.sellBoundaryAlert = true;
    }

    this.sellBoundary = newSellBoundary;
    this.sellPrice = newSell;
    // output only if continues wanted or if there is a boundary alert
    if (outputCallback !== undefined && (this.continuesOutput === true || this.sellBoundaryAlert === true)) {
        outputCallback();
    }
};

// set new prices and call the difference from last prices
CoinInfo.prototype.setNewPrices = function (newBuy, newSell, outputCallback) {
    this.setBuyPrice(newBuy, outputCallback);
    this.setSellPrice(newSell, outputCallback);
};

// sent message to console
CoinInfo.prototype.outputToConsole = function () {
    var message = createMessage(this);
    // show new prices in console
    debug(message);
};

// get message
CoinInfo.prototype.getMessage = function () {
    return createMessage(this);
};



// ******************************************
// PRIVATE FUNCTIONS
// ******************************************

// create message with prices and diff.
function createMessage(coin) {
    var message = "";

    // // show availible supply
    // if (coin.supply != 0) message += " / " + coin.supply.toFixed(8) + " " + coin.supplyTitle;
    // // show name of coin
    // message += " " + coin.name + " ";

    // show new boundary if needed
    if (coin.buyBoundaryAlert && coin.buyBoundary !== 0) {
        message += showPrice(coin.TitleBrokenBuyBoundary, coin.localCoin, coin.buyBoundary, coin.boundaryDigits);
        coin.buyBoundaryAlert = false;
    }

    if (coin.sellBoundaryAlert && coin.sellBoundary !== 0) {
        message += showPrice(coin.TitleBrokenSellBoundary, coin.localCoin, coin.sellBoundary, coin.boundaryDigits);
        coin.sellBoundaryAlert = false;
    }

    // only show if both prices are know
    if (coin.buyPrice !== 0 && coin.sellPrice !== 0) {
        message += "\n";
        // show time
        //        message += moment().format("HH:mm") + " ";

        // show current buy price and price difference
        message += showPrice("current price ", coin.localCoin, coin.buyPrice, coin.priceDigits, coin.boundaryDigits);
        //message += showDiff(coin.buyDiff, coin.diffDigits);

        // seperator betwee buy and sell prices
       // message += "  /  ";

        // show current sell price and price difference
        //        message += showPrice(coin.sellTitle, coin.localCoin, coin.sellPrice, coin.priceDigits);
        //        message += showDiff(coin.sellDiff, coin.diffDigits);
    }

    return message;
}

// show price
function showPrice(priceTitle, localCoin, price, digits) {
    return priceTitle + " " + price.toFixed(digits)  + " " + localCoin;
}

// show difference in buy price (if there is a diff)
function showDiff(diff, digits) {
    var message = "";
    if (diff !== 0.0) {
        message += " (";
        if (diff > 0.0) message += "+";
        // show in cents
        diff *= 100;
        message += diff.toFixed(digits) + " cent)";
    }
    return message;
}

function roundDown(floating, digits) {
    return +(Math.floor(floating + "e+" + digits) + "e-" + digits);
}
/*
function roundUp(floating, digits) {
    return +(Math.ceil(floating + "e+" + digits) + "e-" + digits);
}
*/
module.exports = CoinInfo;
