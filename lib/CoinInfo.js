"use strict";
var debug = require("debug")("tipbot:CoinInfo");
//var moment = require("moment");

// init = constructor
function CoinInfo(name) {
    this.price = 0.0;
    //this.sellPrice = 0.0;
    this.priceDigits = 0;

    //this.buyDiff = 0.0;
    //this.sellDiff = 0.0;
    this.diffDigits = 0;

    this.LowBoundary = 0.0;
    this.HighBoundary = 0.0;
    this.boundaryDigits = 0.0;

    this.boundaryAlert = 0.0;
    // to show boundary information at start set to true
    this.LowBoundaryAlert = true;
    this.HighBoundaryAlert = true;

    this.TitleBrokenHighBoundary = "";
    this.TitleBrokenLowBoundary = "";

    this.supply = 0;

    this.name = name;

    this.localCoin = "";
    this.buyTitle = "";
    this.sellTitle = "";
    this.supplyTitle = "";

    this.continuesOutput = true;

}

/*
// set new buy price
CoinInfo.prototype.setBuyPrice = function (newBuy, outputCallback) {
    var checkLow = roundDown(newBuy, this.boundaryDigits) - this.boundaryAlert;

    if (this.buyPrice !== 0) {
        this.buyDiff = newBuy - this.buyPrice;
        if (checkLow < this.LowBoundary) this.LowBoundaryAlert = true;
    } else {
        // first time a price is recieved, output is as a new boundary
        this.LowBoundaryAlert = true;
    }

    this.LowBoundary = checkLow;
    this.buyPrice = newBuy;
    // output only if continues wanted or if there is a boundary alert
    if (outputCallback !== undefined && (this.continuesOutput === true || this.LowBoundaryAlert === true)) {
        outputCallback();
    }
};
*/
/*
// set new Sell price
CoinInfo.prototype.setSellPrice = function (newSell, outputCallback) {
    var checkHigh = roundDown(newSell, this.boundaryDigits) + this.boundaryAlert;

    if (this.sellPrice !== 0.0) {
        this.sellDiff = newSell - this.sellPrice;
        if (checkHigh > this.HighBoundary) {
            this.HighBoundaryAlert = true;
        }
    } else {
        // first time a price is recieved, output is as a new boundary
        this.HighBoundaryAlert = true;
    }

    this.HighBoundary = checkHigh;
    this.sellPrice = newSell;
    // output only if continues wanted or if there is a boundary alert
    if (outputCallback !== undefined && (this.continuesOutput === true || this.HighBoundaryAlert === true)) {
        outputCallback();
    }
};
*/

// set new prices and call the difference from last prices
CoinInfo.prototype.setNewPrices = function (newPrice, outputCallback) {
//    this.setBuyPrice(newBuy, outputCallback);
 //   this.setSellPrice(newSell, outputCallback);
    
    
    var checkLow = roundDown(newPrice, this.boundaryDigits) - this.boundaryAlert;
    var checkHigh = roundDown(newPrice, this.boundaryDigits) + this.boundaryAlert;

    if (this.price !== 0.0) {
        this.buyDiff = newPrice - this.buyPrice;
        if (checkLow < this.LowBoundary) {
            this.LowBoundaryAlert = true;       // raise low alert
            this.LowBoundary = checkLow;   // set new low boundary
        }
        if (checkHigh > this.HighBoundary) {
            this.HighBoundaryAlert = true;      // raise high alert
            this.HighBoundary = checkHigh; // set new high boundary
        }
    } else {
        // first time a price is recieved, set boundaries and raise alert to show them
        this.LowBoundary = newPrice - this.boundaryAlert;
        this.HighBoundary = newPrice + this.boundaryAlert;
        
        this.LowBoundaryAlert = true;
        this.HighBoundaryAlert = true;
    }
    // set new price
    this.price = newPrice;
    
    // output only if continues wanted or if there is a boundary alert
    if (outputCallback !== undefined && (this.continuesOutput === true || this.LowBoundaryAlert === true)) {
        outputCallback();
    }
 
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
    if (coin.LowBoundaryAlert && coin.LowBoundary !== 0) {
        message += showPrice(coin.TitleBrokenLowBoundary, coin.localCoin, coin.LowBoundary, coin.boundaryDigits);
        coin.LowBoundaryAlert = false;
    }

    if (coin.HighBoundaryAlert && coin.HighBoundary !== 0) {
        message += showPrice(coin.TitleBrokenHighBoundary, coin.localCoin, coin.HighBoundary, coin.boundaryDigits);
        coin.HighBoundaryAlert = false;
    }

    // only show if both prices are know
    if (coin.buyPrice !== 0 && coin.sellPrice !== 0) {
        message += "\n";
        // show time
        //        message += moment().format("HH:mm") + " ";

        // show current buy price and price difference
        message += showPrice("current price ", coin.localCoin, coin.price, coin.priceDigits, coin.boundaryDigits);
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
