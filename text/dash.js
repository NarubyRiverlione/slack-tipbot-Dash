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
        "*withdraw*\ttell the bot to withdraw to a address; \n" +
        "\t\t_@DashBot withdraw 1 DASH to 1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp!_ \n",

        "help_demand":
        "*receive*\t\ttell the bot to request coins from to someone; _@DashBot receive 0.1 DASH from @someone_ \n" +
        " \t\t_aliases: demand, ask, deserve, get, give me, owes me_ \n" +
        "\n",

        "help_currencies":
        "*currencies*\task the bot for a list of supported currencies.\n" +
        "\t\t_@DashBot what currencies do you know?_ \n",

        "help_price":
        "*price*\t\t\task the bot for the Dash price in a particular currency. Price info from coinmarketcap.\n " +
        "\t\t_@DashBot price in USD!_ \n",

        "help_pricelist":
        "*priceticker*\t\t\tshows all the know prices. Use * priceticker short* for a limited list.  \n",

        "help_convert":
        "*convert*\t\task the bot to convert between a particular currency and Dash (or visa versa);  \n" +
        "\t\t_@DashBot 0.03 DASH to GBP_ \t or \t _@DashBot 15 EURO to DASH_\n",

        "help_rain":
        "*rain*\t\tcheck the available rain and threshold. \n " +
        "\t\tAdmins can also release the rain with the *rain now* command.\n",

        "tx_fee": "The transaction fee is set to ",

        //      "\t\tAdmins can via the _rain threshold_ command set the threshold. \n" +
        //       "\t\tWhen the balance of the rain account reaches this threshold, \n " +
        //       "\t\traindrops will fall on each online users.",
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
        // RAIN
        // "RainAdminOnly": "Only Admins can make it rain because they are the Rain Gods.",
        "RainThreshold": "Rain threshold is: ",
        "RainThresholdNotSet": "Dear Rain God, the rain threshold isn't set yet. \n You can do that with the *rain threshold _amount_* command.",
        "Rainimminent": ":cloud: :cloud: :cloud: \n _When will those clouds all disappear?_ Will it rain soon? \n  :cloud: :cloud: :cloud:",
        "RainTimer": " It will rain random in the next *",
        "RainTimerUnit": " minute(s)* ",
        "RainTimerNotSet": "Dear Rain God, the rain timer not set yet.  \n You can do that with the *rain timer _minutes_* command.",
        "RainAvailibleAmount": "Available rain : ",
        "RainPerUserNow": "If you let it rain *now* ",
        "RainDropSizeWithThreshold": "If you wait for the rain *threshold* of ",
        "RainPerUser_1": " raindrops of ",
        "RainPerUser_2": " dash would fall",
        "RainClouds": ":rain_cloud: :rain_cloud: :rain_cloud:",
        "RainNow": "*And the Dash Rain Gods said _LET IT RAIN DASH_* \n" +
        "_Each current online user will get a raindrop of_  ",
        "RainCannotFindRainAccount_1": "Could not find the Rain user : '*",
        "RainCannotFindRainAccount_2": "*' \n Ask the Slack Admin(s) if the Rain feature is correctly setup.",
        "RainCannotFindRainBalance": "Could not find the Rain balance for ",
        "RainReqDonation_1": "If you feel generous tip the  _@",
        "RainReqDonation_2": "_ user.\nThe complete balance of this Rain user will be redistributed via raindrops.",
        "RainEmpty": "Not a cloud in the sky, not rain available to fall down.",
        "RainRecieved": ":droplet: \n You got splashed with a Dash raindrop of ",
        // WARN
        "NoUserFoundWarn": ", you need to provided a user to warn.",
        "WarnNoPrivateChannel": "Could not reach the user: ",
        "WarnText": ", please refrain from using insults and profane language in #dash_chat .\n" +
        "You are welcome to continue your conversation in the #arena, where anything goes.",
        "InformOtherAdmins1": "The user ",
        "InformOtherAdmins2": " was issued a moderator warning.",
        // OOPS
        "Oops": " but I did not understand that.\nUse the *help* command to see the valid options."
    };

    this.userTxt = {
        // GENERAL
        "Locked": " , sorry your already doing a transaction. \n Wait a moment before starting a new one.",

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
