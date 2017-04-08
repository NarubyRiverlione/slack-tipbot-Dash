'use strict'

const tipbotTxt = {
  // HELPTEXT
  'helpText': [
    //'title':
    '*DashBot commands* \n',

    //'help_balance':
    '*balance*\t\task the bot for your current balance\n' +
    '\t\t_@DashBot what is my balance_',

    //'help_send':
    '*send*\t\t\t\ttell the bot to send coins to someone; \n' +
    '\t\t_@DashBot send 0.1 DASH to @someone_ \n' +
    '\t\t_aliases: give, tip_ \n' +
    '\t\t\t\tWorks also with major fiat currencies (use *currencies* command to see the list); \n' +
    '\t\t_@DashBot give 4 USD to @someone_',

    // 'help_deposit':
    '*deposit*\t\task the bot for a deposit address; _@DashBot let me deposit!_',

    // 'help_withdraw':
    '*withdraw*\ttell the bot to withdraw an amount to an address. \n' +
    '\t\t\t\t\tYou can also use _all_ to withdraw your complete balance (minus the tx fee) \n' +
    '\t\t_@DashBot withdraw 1 DASH to XqyTXt9LM3AHdrfG8ckdTatDiwk5514a11_',

    // 'help_currencies':
    '*currencies*\task the bot for a list of supported currencies.\n' +
    '\t\t_@DashBot what currencies do you know?_ ',

    // 'help_price':
    '*price*\t\t\task the bot for the Dash price in a particular currency. Price info from coinmarketcap.\n ' +
    '\t\t_@DashBot price in USD!_ ',

    // 'help_pricelist':
    '*priceticker*\t\tshows all the known prices. Use * priceticker short* for a limited list.\n' +
    '\t\t_aliases: pricelist, prices_ \n' +

    // 'help_convert':
    '*convert*\t\task the bot to convert between a particular currency and Dash (or visa versa).\n' +
    '\t\t_@DashBot 0.03 DASH to GBP_ \t or \t _@DashBot 15 EURO to DASH_\n',
  ],

  'help_rain':
  '*rain*\t\t\tcheck the available raindrops. \n' +
  '\t\t\tEach user that has tipped another user will receive a _raindrop_ (read: free Dash) from the rain fund when the donation threshold is reached.',

  'help_autowithdraw':
  '*autowithdraw*\tCheck you autowithdraw setup. \n' +
  '\t\t\tWhen you tip jar exide the set amount then there is an automatic withdraw to the set address.\n' +
  '*autowithdraw* amount address\tSet amount and address.\n' +
  '\t\t_@DashBot autowithdraw 0.5 DASH XqyTXt9LM3AHdrfG8ckdTatDiwk5514a11',

  'helpAdminOnly':
  '===== *ADMIN ONLY COMMANDS* =====\n' +
  '*emergency restart*\tRestart the Slack connection of tipbot. \n' +
  '\t\t\t\t*Only use in real emergency*\n\n' +
  '*balance all*\tshow all the tip jars (must be enabled in code)\n' +
  '\n' +
  '*balance check*\tshow the balance of a specific user (must be enabled in code) \n' +
  '\t\t_@dashbot balance check @naruby_ \n' +
  '\n\n' +
  '*whisper*\tSend a message in a private channel to a user as dashbot.\n' +
  '\t\t\t\t\tUse case :moderator warning.\n' +
  '\t\t_@Dashbot whisper @narbuy stop being silly man._\n' +
  '\n\n' +
  '*rain threshold*\t set the threshold on where the balance of the rain account will be distributed\n' +
  '\t\t\t\tbetween all the users that tipped. Defaults to 0.5 Dash.\n' +
  '\t\t_@dashbot rain threshold 1 dash_\n' +
  '\n' +
  '*rain eligible*\tSee which users are eligible for a raindrop.\n' +
  '\n',

  // '*rain reset*\t\tReset all tip counts, not needed normally as tip counters are reset when rain is shining.' +
  // '\n',

  'tx_fee': 'The transaction fee is set to ',
  'HelpRandom1': 'Here is an example of one of my commands, type "@dashbot help" for my full list. ',
  // 'HelpRandom2': 'You can get information about all my other cool tricks via the *help* command. \n Have a nice day !',

  // NEW USER
  'WarningNewUser1': 'A new user joins Dash Nation! A warm welcome to our Slack, ',
  'WarningNewUser2': '.',

  // USER LEFT
  'WarnUserLeft1': 'The user ',
  'WarnUserLeft2': ' has left the slack team. Think about his/her tip jar.',

  // DUMMY USER CHECK
  'FoundDummyUser1': 'Be aware that the user ',
  'FoundDummyUser2': ' will not be able to use Tipbot due to the suspicious username.',

  // ALL BALANCES
  'RetrievingAllBalancesDisabled': 'Retrieving all balances is disabled!',
  'RetrievingAllBalancesAdminOnly': 'Only admins can list all balances!',
  'RetrievingAllBalancesWait': 'Retrieving all balances... might take a while depending on the amount of users!',

  // CHECK BALANCE
  'CheckBalanceDisabled': 'Checking balance of an other user is disabled!',
  'CheckBalanceAdminOnly': 'Only admins can check other balances!',
  'CheckBalanceNoUserFound': 'No user found to check. Did you use the prefix @ ?',

  // GENERAL
  'NoAmountFound': ' couldn\'t\'t find the amount. Did you forget the decimal ?',
  'NoValidAddress': ' that\'s not a valid address!',
  'MoreThen1Address': ' I can\'t do a withdraw to more than 1 address',
  'NoAddress': ' I need to know an address to withdraw to.',
  'NoAmountOrCurrency': ' I need to know much you want to withdraw and the currency.',
  'UnsupportedCurrency': ': we don\'t support that currency yet!',
  'InvalidAmount': ': that\'s an invalid amount',

  // WITHDRAW
  'WithdrawQuestion': ['You want to withdraw ', ' to ', '.\n Is this correct (yes/no) ?'],

  // SEND
  'Hello': 'Hello there ',
  'NoUserFoundForTip': ', I didn\'t catch the user you want to tip. You surely didn\'t want to tip yourself, did you ?',
  'SendMessageUsed': '\nThis message what used to send the tip : \n',

  // REQUEST
  'RequestingDisabled': 'Requesting coins is disabled!',

  // MENTIONS MULTIPLE USERS
  'ToMuchUsers': ' but you\'re mentioning too many people!',

  // CONVERT
  'NotEnoughCurrencies': ': not enough currencies!',
  'ToMuchCurrencies': ': too many currencies!',

  // PRICE
  'PriceBase': '1 Dash is ',
  'PriceInfoFrom': ' (price of coinmarketcap)',
  'LocationOfPriceList1': 'Hi, I\'ve posted the price information in the #',
  'LocationOfPriceList2': ' channel to prevent a lot of text in the other channels.',

  // CURRENCIES
  'CurrenciesTitle': 'Price info from coinmarketcap \n',
  'SupportedCurrenciesFull': 'Supported currencies: ',
  'SupportedSymbols': 'use these currency abbreviations/symbols in your message: *',
  'SupportedBase': 'And does it need saying: *DASH* is supported !',

  // RAIN
  'RainThreshold1': 'Rain threshold is: ',
  'RainThreshold2': 'Raindrops (aka free dash) will fall when rain balance is more then the set threshold.',
  'RainThresholdNotSet': 'Dear Dash God, the Rain threshold isn\'t set yet. \n' +
  ' You can do that with the *rain threshold _amount_* command.',
  // 'RainTimer': 'Rainshine will be checked every *',
  // 'RainTimerUnit': ' minute(s)*',
  // 'RainTimerNotSet': 'Dear Dash God, the rain timer is not set yet.\n' +
  // ' You can do that with the *rain timer _minutes_* command.',
  'RainAvailibleAmount': 'Available raindrops: ',
  'RainExplain': 'Each user that has tipped an other user will receive a _raindrop_ from the rain fund.',
  'RainAmountEligibleUsers': ' users are at the moment eligible for a raindrop.',
  'RainRay': ':rain_cloud: :umbrella_with_rain_drops:  :rain_cloud:',
  'RainCannotFindRainAccount1': 'Could not find the Rain user : \'*',
  'RainCannotFindRainAccount2': '*\' \n Ask the Slack Admin(s) if the Rain feature is correctly setup.',
  'RainCannotFindRainBalance': 'Could not find the Rain balance for ',
  'RainReqDonation1': 'If you feel generous: tip _@',
  'RainReqDonation2': 'The complete balance of _@',
  'RainReqDonation3': '_ will be redistributed as _raindrops_ (aka free dash).',
  'RainEmpty': ':sun_behind_cloud:no raindrops available to cast. :disappointed:',
  'RainRecieved': 'As reward of tipping your fellow Dash user(s) you received a raindrop of ',
  'RainEligibleUsersList': '*These users have tipped* \n',
  'RainErrorResettingCounter': 'Error cannot reset counts. Inform the admin.',
  'RainCountIsReset': 'All tip count records are removed.',


  // OOPS
  'Oops': 'Use the *help* command to see the valid options.',
  'NoCommandFound': [
    'Remember it\'s never the machine it\'s always the operator. Check your syntax and try again.',
    'Of course, this error isn\'t your fault. Maybe you should consider buying a new keyboard.',
    'Ker chunk, ker chunk,,,blaaahhhh.Ran out of gas.Try again.',
    'What was that?Can you hear me now?Nope.Try again.',
    'Wa wa wa wa wak wak. Game over Pac Man. Try again.',
    'You\'ve lost the battle but you can win the war. Try again!',
    'What language is that?That makes no sense to me.',
    'Stop collaborate and listen, ice is back with a brand new invention....but not with that syntax.',
    'Syntax Error. That\'s all I am going to say about that.',
    'Gibberish is not accepted.English please.',
    'You talking to me? Try again.'
  ],

  'ERRORreadingDb': 'ERROR reading db:'
}


const userTxt = {
  // GENERAL
  'Locked': ' , sorry you\re already doing a transaction. \n Wait a moment before starting a new one.',

  // GET BALANCES
  'BaseCurrency': 'Dash',
  'BalanceIs': ' your tip jar contains: ',
  'UnconfirmedBalance1': 'you have an unconfirmed balance (less than ',
  'UnconfirmedBalance2': ' confirmations) of ',
  'BalanceWarningHigh': 'This tip jar is filling up. Please consider withdrawing some Dash.',
  'NoBalance': 'You don\'t have a balance (yet). Use the _deposit_ command to fill your tip jar.',

  // WITHDRAW
  'Withdrawal1': 'Withdrawal of ',
  'WithdrawalTransaction': ' transaction: ',
  'InsufficientBalance1': 'Sorry ',
  'InsufficientBalance2': ' insufficient balance.',

  // SEND
  'SendPublicMessage1': ':clap: ',
  'SendPublicMessage2': ' tipped ',
  'SendPrivateMssSendingUser': ' you\'re a great Dash Chat user :thumbsup: \nLets see how much there is left in your tip jar now: \n',
  'SendPrivateMssRecievingUser1': 'Hi there ',
  'SendPrivateMssRecievingUser2': ', you just received ',
  'SendPrivateMssRecievingUser3': ' from ',
  'SendOops1': 'Oops could not tip ',
  'SendOops2': ' to '

}

const autoWithdrawTxt = {
  'noSetup': ' autowithdraw isn\'t setup yet for you.\n' +
  'You can do this by the command *autowithdraw* amount address',
  'setup_1': ' your threshold amount is ',
  'setup_2': ' your withdraw address is ',
  'setup_3': '\n\t *Remember to backup you wallet so you don\'t lose this address.*',
  'setup_4': '\n\t If you want to disable autowithdraw just set the amount to 0.',
  'disabled': ', your autowithdraw setup is incomplete and dues disabled.',
  'notSet': ' _no set_ ',
  'executed_1': ', an automatic withdraw has be executed:\n'

}
module.exports = { tipbotTxt, userTxt, autoWithdrawTxt }
