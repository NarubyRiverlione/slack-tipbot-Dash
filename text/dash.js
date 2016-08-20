'use strict';

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
        '\t\t_@DashBot withdraw 1 DASH to Xdice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp!_',

        // 'help_currencies':
        '*currencies*\task the bot for a list of supported currencies.\n' +
        '\t\t_@DashBot what currencies do you know?_ ',

        // 'help_price':
        '*price*\t\t\task the bot for the Dash price in a particular currency. Price info from coinmarketcap.\n ' +
        '\t\t_@DashBot price in USD!_ ',

        // 'help_pricelist':
        '*priceticker*\t\tshows all the known prices. Use * priceticker short* for a limited list.',

        // 'help_convert':
        '*convert*\t\task the bot to convert between a particular currency and Dash (or visa versa).\n' +
        '\t\t_@DashBot 0.03 DASH to GBP_ \t or \t _@DashBot 15 EURO to DASH_\n',

        // 'help_rain':
        // '*rain*\t\tcheck the available rain and threshold. \n ' +
        // '\t\tAdmins can also release the rain with the *rain now* command.\n',

        // 'help_sun':
        '*sun*\t\t\tcheck the available sunshine. \n' +
        '\t\t\tEach user that has tipped an other users will recieve a _sunray_ (read: free Dash) from the sun fund.'
    ],

    'helpAdminOnly':
    '===== *ADMIN ONLY COMMANDS* =====\n' +
    '*emergency restart*\tRestart the Slack connection of tipbot. \n' +
    '\t\t\t\t*Only use in real emergency*\n\n' +
    '*balance all*\tshow all the tip jars (must be enabled in code)\n' +
    '\n' +
    '*balance check*\tshow the balance of a specific user (must be enabled in code) \n' +
    '\t\t_@dashbot balance check @naruby_ \n' +
    '\n\n' +
    '*whisper*\tSend a message in a private channel to a users as dashbot.\n' +
    '\t\t\t\t\tUse case :moderator warning.\n' +
    '\t\t_@Dashbot whisper @narbuy stop beeing silly man._\n' +
    '\n\n' +
    '*sun threshold*\t set the threshold on where the balance of the sun account will be distributed\n' +
    '\t\t\t\tbetween all the users that tipped. Defaults to 5 Dash.\n' +
    '\t\t_@dashbot sun threshold 2.5 dash_\n' +
    '\n' +
    '*sun eligible*\tSee which users are eligible for a sunray.\n' +
    '\n' +
    '*sun reset*\t\tReset all tip counts, not needed normaly as tip counters are resetted when sun is shining.'+
    '\n' +
    '*quiz list*\t\tShow all approved questions.\n'+
    '*quiz review*\tList all questions that need to be reviewed (reward = 0).\n'+
    '*quiz delete _question number_*\tDelete a question.\n'+
    '*quiz reward _question number_*\tSet/change reward for a question (also approves the question). @dashbot will ask amount.\n'+
    '*quiz start*\t\tStart a quiz.\n'+
    '*quiz end*\t\tParticipant cannot answer anymore. Score will be displayed.\n'+
    '*quiz abort*\t\tStop a quiz without showing results.\n'+

    '*quiz add*\t\t@dashbot will ask to input a new quiz question and answer.\nEach question needs to be reviewed by a moderator.\n'+
    '\n\t\tUse _quiz list_ and _quiz review_ to get the question number for the next commands.\n'+
    '*quiz answer*\t\tParticipate in a quiz. You will get questions in a private channel.\n',

    'tx_fee': 'The transaction fee is set to ',
    'HelpRandom1': 'Here is an example of one of my commands, type "@dashbot help" for my full list. ',
    // 'HelpRandom2': 'You can get information about all my other cool tricks via the *help* command. \n Have a nice day !',
    // NEW USER
    'WarningNewUser1': 'The new user ',
    'WarningNewUser2': ' has joined ! Go and greet them, plz.',
    // USER LEFT
    'WarnUserLeft1': 'The user ',
    'WarnUserLeft2': ' has left the slack team. Think about his/her tip jar.',
    // ALL BALANCES
    'RetrievingAllBalancesDisabled': 'Retrieving all balances is disabled!',
    'RetrievingAllBalancesAdminOnly': 'Only admins can list all balances!',
    'RetrievingAllBalancesWait': 'Retrieving all balances... might take a while depending on the amount of users!',
    // CHECK BALANCE
    'CheckBalanceDisabled': 'Cheking balance of an other user is disabled!',
    'CheckBalanceAdminOnly': 'Only admins can check other balances!',
    'CheckBalanceNoUserFound': 'No user found to check. Did you use the prefix @ ?',
    // GENERAL
    'NoAmountFound': ' couldn\'t find the amount. Did you forget the decimal ?',
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

    // // RAIN
    'RainReplacedBySun': 'Really you want rain? It\'s summertime ! _sorry southtern hemisphere_ \n ' +
    'You want *sun* my dear human friend.',

    //  'RainThreshold': 'Rain threshold is: ',
    // 'RainThresholdNotSet': 'Dear Rain God, the rain threshold isn\'t set yet. \n You can do that with the *rain threshold _amount_* command.',
    // 'Rainimminent': ':cloud: :cloud: :cloud: \n _When will those clouds all disappear?_ Will it rain soon? \n  :cloud: :cloud: :cloud:',
    // 'RainTimer': ' It will rain random in the next *',
    // 'RainTimerUnit': ' minute(s)* ',
    // 'RainTimerNotSet': 'Dear Rain God, the rain timer not set yet.  \n You can do that with the *rain timer _minutes_* command.',
    // 'RainAvailibleAmount': 'Available rain : ',
    // 'RainPerUserNow': 'If you let it rain *now* ',
    // 'RainDropSizeWithThreshold': 'If you wait for the rain *threshold* of ',
    // 'RainPerUser1': ' raindrops of ',
    // 'RainPerUser2': ' dash would fall',
    // 'RainClouds': ':rain_cloud: :rain_cloud: :rain_cloud:',
    // 'RainNow': '*And the Dash Rain Gods said _LET IT RAIN DASH_* \n' +
    //         '_Each current online user will get a raindrop of_  ',
    // 'RainCannotFindRainAccount1': 'Could not find the Rain user : '*',
    // 'RainCannotFindRainAccount2': '*' \n Ask the Slack Admin(s) if the Rain feature is correctly setup.',
    // 'RainCannotFindRainBalance': 'Could not find the Rain balance for ',
    // 'RainReqDonation1': 'If you feel generous tip the  _@',
    // 'RainReqDonation2': '_ user.\nThe complete balance of this Rain user will be redistributed via raindrops.',
    // 'RainEmpty': 'Not a cloud in the sky, not rain available to fall down.',
    // 'RainRecieved': ':droplet: \n You got splashed with a Dash raindrop of ',

    // SUN
    'SunThreshold1': 'Sun threshold is: ',
    'SunThreshold2': 'Sun will shine and distribute sunrays when sun balance is more then the set threshold.',
    'SunThresholdNotSet': 'Dear Dash God, the Sun threshold isn\'t set yet. \n' +
    ' You can do that with the *sun threshold _amount_* command.',
    // 'SunTimer': 'Sunshine will be checked every *',
    // 'SunTimerUnit': ' minute(s)*',
    // 'SunTimerNotSet': 'Dear Dash God, the sun timer is not set yet.  \n' +
    // ' You can do that with the *sun timer _minutes_* command.',
    'SunAvailibleAmount': 'Available sunrays: ',
    'SunExplain': 'Each user that has tipped an other user will recieve a _sunray_ from the sun fund.',
    'SunAmountEligibleUsers': ' users are at the moment eligible for a sunray.',
    'SunRay': ':sunny: :sunny: :sunny:',
    'SunCannotFindSunAccount1': 'Could not find the Sun user : \'*',
    'SunCannotFindSunAccount2': '*\' \n Ask the Slack Admin(s) if the Sun feature is correctly setup.',
    'SunCannotFindSunBalance': 'Could not find the Sun balance for ',
    'SunReqDonation1': 'If you feel generous tip  _@',
    'SunReqDonation2': 'The complete balance of _@',
    'SunReqDonation3': '_ will be redistributed as _sunrays_ (aka free dash).',
    'SunEmpty': ':sun_behind_cloud:  no sunrays available to cast. :disappointed:',
    'SunRecieved': 'As reward of tipping your fellow Dash user(s) you received a sunray of ',
    'SunEligibleUsersList': '*These users have tipped* \n',
    'SunErrorResettingCounter': 'Error cannot reset counts. Inform the admin.',
    'SunCountIsReset': 'All tip count records are removed.',

    //QUIZ
    'QuizAddQuestion': 'Enter your new question.',
    'QuizAddAnOtherQuestion': 'Will you add an other question (yes/no) ?',
    'QuizAddAnser': 'Enter the anser to your question.',
    'QuizConfirmNewQA': 'Is this the correct question and answer (yes/no) ?',
    'QuizSavedToDb': 'Ok, I\'ve saved your new question, a moderator will review it and set an appropriate bounty.',
    'QuizAbortedSaving': 'Ok, I will ignore that question.',
    'QuizListQuestions': '*I know about this questions:* \n',
    'QuizDeleteQuestion': 'To delete a question: *quiz delete _question number_*',
    'QuizChangeReward':'To change the reward of a question: *quiz reward _question number_*',
    'QuizNoQAnumber': 'I didn\'t find the question number',
    'QuizDeleteNOK':'I couldn\'t delete question ',
    'QuizDeleteOk' :'Question is removed',
    'QuizAnswerCorrect': 'Super ! You got that correct.',
    'QuizAnswerWrong': 'Bummer, that was close but still wrong.',

    'QuizNoQuestionsYet': 'There aren\'t any question yet. Why don\'t you add one now?',
    'QuizReview_1' : 'This question don\'t have a reward set:\n',
    'QuizReview_2':'Use *quiz reward _question number_* to set a reward.',
    'QuizRewardQuestion' : 'To approve a question set a reward with  *@dashbot quiz reward _question number_*.',
    'QuizUnreviewed':'*This are the question that need to be reviewed*:\n',
    'QuizSetReward' :'What should the reward be for this question ?',
    'QuizSetRewardNoAmountFound':'Cannot find the reward amount !',
    'QuizSetRewardOk' :'Reward set, thanks for reviewing this question.',
    'QuizErrorStarting' :'Sorry cannot start a quiz because: ',
    'QuizStarted1' : 'A quiz has started !',
    'QuizStarted2' : 'Go to the ',
    'QuizStarted3' : ' channel to participate.',
    'QuizEnded' : 'The quiz has ended. \nScoreboard :\n',
    'QuizShowCorrectAnswers' : 'These where the questions and correct answers: \n',
    'QuizAborted' : 'The quis has been aborted.',
    'QuizDone' :'You answered all the questions in this quiz.\n Wait until the quiz is stopped to see your score.',
    'QuizAskQuestion' :'Question ',
    'QuizThanks' : 'Thanks for participating !',
    // OOPS
    'Oops': 'Use the *help* command to see the valid options.',
    'NoCommandFound': [
        'Remember it\'s never the machine it\'s always the operator. Check your syntax and try again.',
        'Of course, this error isn\'t your fault. Maybe you should consider buying a new keyboard.',
        'Ker chunk, ker chunk,,,blaaahhhh.  Ran out of gas.  Try again.',
        'What was that?  Can you hear me now?  Nope.  Try again.',
        'Wa wa wa wa wak wak.   Game over Pac Man.   Try again.',
        'You\'ve lost the battle but you can win the war. Try again!',
        'What language is that?  That makes no sense to me.',
        'Stop collaborate and listen, ice is back with a brand new invention....but not with that syntax.',
        'Syntax Error.   That\'s all I am going to say about that.',
        'Gibberish is not accepted.  English please.',
        'You talking to me? Try again.'
    ],

    'ERRORreadingDb': 'ERROR reading db:'
};

const userTxt = {
    // GENERAL
    'Locked': ' , sorry you\re already doing a transaction. \n Wait a moment before starting a new one.',

    // GET BALANCES
    'BaseCurrency': 'Dash',
    'BalanceIs': ' your tip jar contains: ',
    'UnconfirmedBalance1': 'you have an unconfirmed balance (less than ',
    'UnconfirmedBalance2': ' confirmations) of ',
    'BalanceWarningHigh': 'This tip jar is filling up. Please consider withdrawing some Dash.',
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

};


module.exports = { tipbotTxt, userTxt };
