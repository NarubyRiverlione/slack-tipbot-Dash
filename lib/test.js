
"use strict";
    var CURRENCIES = ["USD", "EUR", "euro","€","$","dollar", "GBP"];
    var CURRENCY_REGEX = new RegExp("(Satoshis?|DASH|" + CURRENCIES.join("|") + ")", "ig");
    var AMOUNT_REGEX = new RegExp("(\\d*\\.\\d*)","i");
    
    var message = "<@U0Z0F5N59> withdraw 123.456 XttzcgJHKKRc5oWE1HEwErTo4YJ8Umg6Jr";
    
    var amount = message.match(AMOUNT_REGEX); // only the number, no currency
        // check if currency was provide
        var providedCurrency = message.match(CURRENCY_REGEX) ;
        if (providedCurrency=== null | providedCurrency[0].length === 0) {
            // not provided, set dash as default currency
            amount[2] =  "DASH";
        } else {
            // set provided currency
            amount[2] =  message.match(CURRENCY_REGEX)[0];
        }
        
        console.log (amount);
       