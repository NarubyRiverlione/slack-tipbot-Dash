
"use strict";
/*eslint no-console:"off"*/

var CURRENCIES = ["USD", "EUR", "euro","€","$","dollar", "GBP"];
var BLACKLIST_CURRENCIES = ["DASH"];

    // var CURRENCY_REGEX = new RegExp("(Satoshis?|DASH|" + CURRENCIES.join("|") + ")", "ig");
    // var AMOUNT_REGEX = new RegExp("(\\d*\\.\\d*)","i");
    
    // var message = "<@U0Z0F5N59> withdraw 123.456 XttzcgJHKKRc5oWE1HEwErTo4YJ8Umg6Jr";
    
    // var amount = message.match(AMOUNT_REGEX); // only the number, no currency
    //     // check if currency was provide
    //     var providedCurrency = message.match(CURRENCY_REGEX) ;
    //     if (providedCurrency=== null | providedCurrency[0].length === 0) {
    //         // not provided, set dash as default currency
    //         amount[2] =  "DASH";
    //     } else {
    //         // set provided currency
    //         amount[2] =  message.match(CURRENCY_REGEX)[0];
    //     }
        
    //     console.log (amount);
       
       
var request = require("request");
var fs = require("fs");
       
var filename = "rates.cache.1460196840.json";
var rates;
       
fs.exists(filename, function(exists) {
    if (exists) {
        fs.readFile(filename, "utf8", function(err, data) {
            if (err) {console.log(err);} 
            else {
                test(null, JSON.parse(data));
            }
        });
    } else {
        request.get("http://coinmarketcap-nexuist.rhcloud.com/api/dash/price", function(err, response, body) {
            fs.writeFile(filename, body, function(err) {
                if (err) {console.log(err);}          
                else {
                    test(null, JSON.parse(body));
                }
            });
        });
    }
});

function test(err, rates) {    
console.log(rates);   
//console.log(rates.usd);
    var currency = "usd";
    console.log("rate for " + currency + " = " +  rates[currency]);
    getPriceRates(err,rates);
}

function getPriceRates(err,rates) {
    CURRENCIES = [];

    //rates.forEach(function(rate) 
    for (var rate in rates) {
        if (BLACKLIST_CURRENCIES.indexOf(rate) === -1) {
            CURRENCIES.push(rate);
        }
    }
    console.log(CURRENCIES);
}
