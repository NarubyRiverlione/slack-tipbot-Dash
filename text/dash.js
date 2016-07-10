"use strict";
var texts = function () {
    this.tipbotTxt = {
        // HELPTEXT   
        "helpText": "*DashBot commands* \n",

        "help_balance":
        "*balance*\t\task the bot for your current balance\n" +
        "\t\t_@DashBot what is my balance_ \n",

        "help_send":
        "*send*\t\t\t\ttell the bot to send coins to someone; \n" +
        "\t\t_@DashBot send 0.1 DASH to @someone_ \n" +
        "\t\t_aliases: give, tip_ \n" +
        "\t\tWorks also with major fiat currencies (use *currencies* command to see the list); \n" +
        "\t\t_@DashBot give 4 USD to @someone_ \n",

        "help_deposit":
        "*deposit*\t\task the bot for a deposit address; _@DashBot let me deposit!_ \n",

        "help_withdraw":
        "*withdraw*\ttell the bot to withdraw to an address; \n" +
        "\t\t_@DashBot withdraw 1 DASH to Xdice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp!_ \n",

        "help_currencies":
        "*currencies*\task the bot for a list of supported currencies.\n" +
        "\t\t_@DashBot what currencies do you know?_ \n",

        "help_price":
        "*price*\t\t\task the bot for the Dash price in a particular currency. Price info from coinmarketcap.\n " +
        "\t\t_@DashBot price in USD!_ \n",

        "help_pricelist":
        "*priceticker*\t\t\tshows all the known prices. Use * priceticker short* for a limited list.  \n",

        "help_convert":
        "*convert*\t\task the bot to convert between a particular currency and Dash (or visa versa);  \n" +
        "\t\t_@DashBot 0.03 DASH to GBP_ \t or \t _@DashBot 15 EURO to DASH_\n",

        "help_rain":
        "*rain*\t\tcheck the available rain and threshold. \n " +
        "\t\tAdmins can also release the rain with the *rain now* command.\n",

        "help_sun": "*sun*\t\tcheck the available sunshine. \n ",
       
        "tx_fee": "The transaction fee is set to ",

             // NEW USER
        "WarningNewUser_1": "The new user ",
        "WarningNewUser_2": " has joined ! Go and greet them, plz.",
        // USER LEFT
        "WarnUserLeft_1": "The user ",
        "WarnUserLeft_2": " has left the slack team. Think about his/her tip jar.",
        // ALL BALANCES
        "RetrievingAllBalancesDisabled": "Retrieving all balances is disabled!",
        "RetrievingAllBalancesAdminOnly": "Only admins can list all balances!",
        "RetrievingAllBalancesWait": "Retrieving all balances... might take a while depending on the amount of users!",
        // GENERAL
        "NoAmountFound": " couldn't find the amount. Did you forget the decimal ?",
        "NoValidAddress": " that's not a valid address!",
        "MoreThen1Address": " I can't do a withdraw to more than 1 address",
        "NoAddress": " I need to know an address to withdraw to.",
        "NoAmountOrCurrency": " I need to know much you want to withdraw and the currency.",
        "UnsupportedCurrency": ": we don't support that currency yet!",
        "InvalidAmount": ": that's an invalid amount",
        // WITHDRAW
        "WithdrawQuestion": "",
        // SEND
        "Hello": "Hello there ",
        "NoUserFoundForTip": ", I didn't catch the user you want to tip. You surely didn't want to tip yourself, did you ?",
        "SendMessageUsed": "\nThis message what used to send the tip : \n",
        // REQUEST
        "RequestingDisabled": "Requesting coins is disabled!",
        // MENTIONS MULTIPLE USERS
        "ToMuchUsers": " but you're mentioning too many people!",
        // CONVERT
        "NotEnoughCurrencies": ": not enough currencies!",
        "ToMuchCurrencies": ": too many currencies!",
    
        // PRICE
        "PriceBase": "1 Dash is ",
        "PriceInfoFrom": " (price of coinmarketcap)",
    
        // CURRENCIES
        "CurrenciesTitle": "Price info from coinmarketcap \n",
        "SupportedCurrenciesFull": "Supported currencies: ",
        "SupportedSymbols": "use these currency abbreviations/symbols in your message: *",
        "SupportedBase": "And does it need saying: *DASH* is supported !",
     
        // // RAIN
        "RainReplacedBySun" : "Really you want rain? It's summertime ! _sorry south hemisphere_ \n "+
            "You whant *sun* my dear human friend.",

        //  "RainThreshold": "Rain threshold is: ",
        // "RainThresholdNotSet": "Dear Rain God, the rain threshold isn't set yet. \n You can do that with the *rain threshold _amount_* command.",
        // "Rainimminent": ":cloud: :cloud: :cloud: \n _When will those clouds all disappear?_ Will it rain soon? \n  :cloud: :cloud: :cloud:",
        // "RainTimer": " It will rain random in the next *",
        // "RainTimerUnit": " minute(s)* ",
        // "RainTimerNotSet": "Dear Rain God, the rain timer not set yet.  \n You can do that with the *rain timer _minutes_* command.",
        // "RainAvailibleAmount": "Available rain : ",
        // "RainPerUserNow": "If you let it rain *now* ",
        // "RainDropSizeWithThreshold": "If you wait for the rain *threshold* of ",
        // "RainPerUser_1": " raindrops of ",
        // "RainPerUser_2": " dash would fall",
        // "RainClouds": ":rain_cloud: :rain_cloud: :rain_cloud:",
        // "RainNow": "*And the Dash Rain Gods said _LET IT RAIN DASH_* \n" +
        //         "_Each current online user will get a raindrop of_  ",
        // "RainCannotFindRainAccount_1": "Could not find the Rain user : '*",
        // "RainCannotFindRainAccount_2": "*' \n Ask the Slack Admin(s) if the Rain feature is correctly setup.",
        // "RainCannotFindRainBalance": "Could not find the Rain balance for ",
        // "RainReqDonation_1": "If you feel generous tip the  _@",
        // "RainReqDonation_2": "_ user.\nThe complete balance of this Rain user will be redistributed via raindrops.",
        // "RainEmpty": "Not a cloud in the sky, not rain available to fall down.",
        // "RainRecieved": ":droplet: \n You got splashed with a Dash raindrop of ",
    
        // SUN
        "SunThreshold_1" : "Sun threshold is: ",
        "SunThreshold_2": "Sun will be cast when sun balance > threshold.",
        "SunThresholdNotSet" : "Dear Dash God, the Sun threshold isn't set yet. \n"+
            " You can do that with the *sun threshold _amount_* command.",
        "SunTimer" : "Sunshine will be checked every *",
        "SunTimerUnit" : " minute(s)*",
        "SunTimerNotSet" : "Dear Dash God, the sun timer is not set yet.  \n"+
            " You can do that with the *sun timer _minutes_* command.",
        "SunAvailibleAmount" : "Available sunrays: ",
        "SunExplain" : "Each user that has tipped an other user will recieve a _sunray_ from the sun fund.",
        "SunAmountEligibleUsers" : " users are at the moment eligible for a sunray.",
        "SunRay" : ":sunny: :sunny: :sunny:",
        "SunCannotFindSunAccount_1": "Could not find the Sun user : '*",
        "SunCannotFindSunAccount_2": "*' \n Ask the Slack Admin(s) if the Sun feature is correctly setup.",
        "SunCannotFindSunBalance": "Could not find the Sun balance for ",
        "SunReqDonation_1": "If you feel generous tip  _@",
        "SunReqDonation_2": "The complete balance of _@",
        "SunReqDonation_3" :"_ will be redistributed as _sunrays_.",
        "SunEmpty": ":sun_behind_cloud:  no sunrays available to cast. :disappointed:",
        "SunRecieved": "As reward of tipping your fellow Dash user(s) you received a sunray of ",
        "SunEligibleUsersList": "*These users have tipped* \n",
        "SunErrorResettingCounter" :"Error cannot reset counts. Inform the admin.",
        "SunCountIsReset" : "All tip count records are removed.",

  // WARN
        "NoUserFoundWarn": ", you need to provide a user to warn.",
        "WarnNoPrivateChannel": "Could not reach the user: ",
        "WarnText": ", please refrain from using insults and profane language in #dash_chat .\n" +
        "You are welcome to continue your conversation in the #arena, where anything goes.",
        "InformOtherAdmins1": "The user ",
        "InformOtherAdmins2": " was issued a moderator warning.",
    
        // OOPS
        "Oops": "Use the *help* command to see the valid options.",
        "NoCommandFound": [
            "Remember it's never the machine it's always the operator. Check your syntax and try again.",
            "Of course, this error isn't your fault. Maybe you should consider buying a new keyboard.",
            "Ker chunk, ker chunk,,,blaaahhhh.  Ran out of gas.  Try again.",
            "What was that?  Can you hear me now?  Nope.  Try again.",
            "Wa wa wa wa wak wak.   Game over Pac Man.   Try again.",
            "You've lost the battle but you can win the war. Try again!",
            "What language is that?  That makes no sense to me.",
            "Stop collaborate and listen, ice is back with a brand new invention....but not with that syntax.",
            "Syntax Error.   That's all I am going to say about that.",
            "Gibberish is not accepted.  English please.",
            "You talking to me? Try again."
        ],

        "ERRORreadingDb" : "ERROR reading db:"
    };

    this.userTxt = {
        // GENERAL
        "Locked": " , sorry you're already doing a transaction. \n Wait a moment before starting a new one.",

        // GET BALANCES
        "BaseCurrency": "Dash",
        "BalanceIs": " your tip jar contains: ",
        "UnconfirmedBalance_1": "you have an unconfirmed balance (less than ",
        "UnconfirmedBalance_2": " confirmations) of ",
        "BalanceWarningHigh": "Your tip jar is filling up. Please consider withdrawing some Dash.",
        // WITHDRAW
        "Withdrawal_1": "Withdrawal of ",
        "WithdrawalTransaction": " transaction: ",
        "InsufficientBalance_1": "Sorry ",
        "InsufficientBalance_2": " insufficient balance.",
        // SEND
        "SendPublicMessage_1": ":clap: ",
        "SendPublicMessage_2": " tipped ",
        "SendPrivateMssSendingUser": " you're a great Dash Chat user :thumbsup: \nLets see how much there is left in your tip jar now: \n",
        "SendPrivateMssRecievingUser_1": "Hi there ",
        "SendPrivateMssRecievingUser_2": ", you just received ",
        "SendPrivateMssRecievingUser_3": " from ",
        "SendOops_1": "Oops could not tip ",
        "SendOops_2": " to "

    };

};

module.exports = texts;
