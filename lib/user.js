"use strict";
var debug = require("debug")("tipbot:user");
var blocktrail = require("blocktrail-sdk");
var texts = require("../text/dash.js");

var User = function (tipbot, userId, userName, isAdmin) {
    var self = this;

    self.text = new texts().userTxt;

    self.tipbot = tipbot;
    self.id = userId;
    self.name = userName;
    self.is_admin = isAdmin || false;
    self.handle = self.getSlackHandle();

    self.wallet = tipbot.wallet;            // RPC connection to wallet
    self.tx_fee = blocktrail.toSatoshi(0.0001);  // TX fee, used in withdrawing, in satochi
    self.blockchainUrl = "https://chainz.cryptoid.info/dash/tx.dws?";

    self.REQUIRED_CONFIRMATIONS = 6;

    self.locked = false; // to prevent multiple transactions
<<<<<<< HEAD
=======


>>>>>>> feature/Rain
};

// send via Blockchain
function sendAmount(self, toAddress, value, cb) {
    // send  users Account to Address
    self.wallet.sendFrom(self.id, toAddress, parseFloat(blocktrail.toBTC(value)),
        function (err, tx_id) {
            if (err) {
                debug("ERROR sending via blockchain : " + err);
                var error = "An error prevents withdrawing.";
                cb(error, null);
                return;
            }
            var url = self.blockchainUrl + tx_id;
            var line = self.text["Withdrawal_1"] + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + " to "
                + toAddress
                + self.text["WithdrawalTransaction"] + url;
            cb(null, line);

        });
}

User.prototype.updateFromMember = function (member) {
    var self = this;
    self.name = member.name;
    self.is_admin = member.is_admin;
    self.handle = self.getSlackHandle();
};

/*
User.prototype.tellBalance = function (channelID) {
    var self = this;
    var slack = self.tipbot.slack;
    self.getBalanceLine(function (err, line) {
        if (channelID !== undefined) {
            var reply = { "channel": channelID };
            reply["text"] = line;
            slack.say(reply);

        } else {
            debug("ERROR forgot channel");
        }
    });
};
*/
User.prototype.getBalanceLine = function (cb) {
    var self = this;
    var balanceText = "";

    self.getBalance(self.id, self.REQUIRED_CONFIRMATIONS, function (err, balance) {
        if (err) return;
        balanceText = self.handle + self.text["BalanceIs"] + balance + " " + self.text["BaseCurrency"];
        // check for High Balance
        if (blocktrail.toSatoshi(balance) >= self.tipbot.HighBalanceWarningMark) {
            // warn user
            balanceText += "\n *" + self.text["BalanceWarningHigh"] + "*";
        }
        // check if there is an unconfirmed balance
        self.getBalance(self.id, 1, function (err, unconfirmedBalance) {
            if (err) return;
            if (unconfirmedBalance !== balance) {
                // add unconfirmed balance information to the text
                balanceText += "\n" + self.text["UnconfirmedBalance_1"] + self.REQUIRED_CONFIRMATIONS + self.text["UnconfirmedBalance_2"] + unconfirmedBalance + " " + self.text["BaseCurrency"];
            }
            cb(null, balanceText);
        });
    });
};

// reusable getBalance function
User.prototype.getBalance = function (userID, reqConfirmantions, cb) {
    var self = this;
    debug("Get balance with " + reqConfirmantions + " confirmations for " + userID);
    self.wallet.getBalance(userID, reqConfirmantions, function (err, balance) {
        if (err) {
            var errorTx = "ERROR getting balance with " + reqConfirmantions + " confirmations: " + err;
            debug(errorTx);
            cb(errorTx, null);
        } else {
            cb(null, balance);
        }
    });
};

User.prototype.tellDepositeAddress = function (cb) {
    var self = this;

    var depositAddress;
    // get all addresses in de the wallet for this user
    // should be 1 if users has already an account, if he hasn't give hem one now
    self.wallet.getAddressesByAccount(self.id, function (err, addresses) {
        if (err) {
            cb(err, null);
        }
        if (addresses !== undefined && addresses.length > 0) {
            // found an address for this userID in the wallet
            depositAddress = addresses[0]; // get first address
            debug("Existing address for " + self.handle + "= " + depositAddress);
        } else {
            // didn't find an address for this user in the wallet, create an account now
            self.wallet.getNewAddress(self.id, function (err, address) {
                depositAddress = address;
                debug("New address for " + self.handle + "= " + depositAddress);
            });
        }
        var line = self.handle + " you can deposit to: " + depositAddress;
        cb(null, line);
    });
};

User.prototype.withdraw = function (value, toAddress, walletPass, cb) {
    // value is in satochi !
    var self = this;
<<<<<<< HEAD
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };
    // prevent multiple transactions, only continue if not already locked
    if (self.locked === true) {
        reply["text"] = this.handle + self.text["Locked"];
        slack.say(reply);
        return;
    }
    // lock now and new transactions
    this.locked = true;
=======

    // prevent multiple transactions, only continue if not already locked
    if (self.locked === true) {
        var error = self.handle + self.text["Locked"];
        cb(error, null);
        return;
    }

    // lock now to prevent new transactions
    self.locked = true;
>>>>>>> feature/Rain

    self.getBalance(self.id, self.REQUIRED_CONFIRMATIONS, function (err, balance) {
        if (err) {
            cb(err, null);
            return;
        }
        balance = blocktrail.toSatoshi(balance);
        if (balance >= value + self.tx_fee) {
            // enough balance
            if (value == balance) {
                // withdraw everything (minus the fee)
                value -= self.tx_fee;
            }
            // unlock wallet if needed
            if (walletPass) {
                self.wallet.walletPassphrase(walletPass, 10, function (err) {
                    if (err) {
<<<<<<< HEAD
                        debug("ERROR could not unlock wallet");
                        self.locked = false;
=======
                        var error = "ERROR could not unlock the wallet";
                        debug(error + " : " + err);
                        self.locked = false;
                        cb(error, null);
>>>>>>> feature/Rain
                        return;
                    }
                    // wallet is now unlocked for 10 seconds, move amount
                    sendAmount(self, toAddress, value, cb);
                });
            } else {
<<<<<<< HEAD
                // no wallet unlocking needed
                sendAmount(self, toAddress, value, reply);
=======
                // no wallet unlocking needed, no need to wait for the  walletPassphrase callback
                sendAmount(self, toAddress, value, cb);
>>>>>>> feature/Rain
            }
        } else {
            // not enough balance
            var error = "Sorry " + self.handle + self.text["InsufficientBalance"];
            cb(error, null);
        }
<<<<<<< HEAD
        //  this transaciont is done, clear prevent new transactions
=======
        //  this transaction is done, clear lock to allow new transactions
>>>>>>> feature/Rain
        self.locked = false;
    });
};

User.prototype.send = function (sendToUser, value, cb) {
    var self = this;
<<<<<<< HEAD
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };
    // prevent multiple transactions, only continue if not already locked
    if (self.locked === true) {
        reply["text"] = this.handle + self.text["Locked"];
        slack.say(reply);
        return;
    }
    // lock now and new transactions
=======
    var error = "";
    // prevent multiple transactions, only continue if not already locked
    if (self.locked === true) {
        error = self.handle + self.text["Locked"];
        cb(error, null);
        return;

    }
    // lock now to prevent new transactions
>>>>>>> feature/Rain
    self.locked = true;

    // check balance before sending amount to prevent negative saldo
    self.wallet.getBalance(self.id, self.REQUIRED_CONFIRMATIONS, function (err, balance) {
        balance = blocktrail.toSatoshi(balance);
        if (err) {
            debug("ERROR checking balance before sending tip: " + err);
<<<<<<< HEAD
            reply["text"] = "ERROR checking balance before sending tip.";
            slack.say(reply);
            self.locked = false;
            return;
        }
        if (balance < value) {
            reply["text"] = self.text["InsufficientBalance_1"] + self.handle + self.text["InsufficientBalance_2"];
            slack.say(reply);
            self.locked = false;
            return;
        }

        // check if reciever has an address in the wallet (maybe he has got an account yet, if so create one now)
        self.wallet.getAddressesByAccount(sendToUser.id, function (err, addresses) {
            if (addresses === undefined || addresses.length === 0) {
                // didn't find an address for this user in the wallet, create an account now
                self
                    .wallet.getNewAddress(sendToUser.id, function (err, address) {
                        if (err) {
                            debug("ERROR getting a new address for account (" + sendToUser.id + ") :" + err);
                            self.locked = false;
                            return;
                        }
                        debug("Sending Tip: New account for " + self.handle + "= " + address);
                    });
            }
        });

        // use a in wallet transfer now that where sure recievers has an account in the wallet
        self.wallet.move(self.id, sendToUser.id, parseFloat(blocktrail.toBTC(value)), function (err, result) {
            if (err) {
                debug("ERROR: moving between account (" + self.id + ") to acount (" + sendToUser.id + ")" + err);
                self.locked = false;
=======
            var error = "ERROR checking balance before sending tip.";
            self.locked = false; //  this transaction is done, clear lock to allow new transactions
            cb(error, null);
            return;
        }
        if (balance < value) {
            error = self.text["InsufficientBalance_1"] + self.handle + self.text["InsufficientBalance_2"];
            self.locked = false; //  this transaction is done, clear lock to allow new transactions
            cb(error, null);
            return;
        }

        // use a in wallet transfer
        self.wallet.move(self.id, sendToUser.id, parseFloat(blocktrail.toBTC(value)), function (err, result) {
            if (err) {
                debug("ERROR: moving between account (" + self.id + ") to acount (" + sendToUser.id + ")" + err);
                error = self.text["SendOops_1"] + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendOops_2"] + sendToUser.name + "";
                self.locked = false; //  this transaction is done, clear lock to allow new transactions
                cb(error, null);
>>>>>>> feature/Rain
                return;
            }

            if (result === true) {
                
                debug("Sending Tip: Moved " + blocktrail.toBTC(value) + " Dash from " + self.handle + " to " + sendToUser.handle);
                // prepare message in channel where Tip command was issued
                var responses = {
                    public: self.text["SendPublicMessage_1"] + self.handle + self.text["SendPublicMessage_2"] + sendToUser.handle
                };
                //  prepare message to recieving user to inform of tip
                responses["privateToReciever"] = self.text["SendPrivateMssRecievingUser_1"] + sendToUser.handle + self.text["SendPrivateMssRecievingUser_2"] + + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendPrivateMssRecievingUser_3"] + self.handle + " !";
                // prepare message to sending user to inform of new balance
                self.getBalanceLine(function (err, balanceLine) {
                    responses["privateToSender"] = self.handle + self.text["SendPrivateMssSendingUser"] + balanceLine;
                    self.locked = false; //  this transaction is done, clear lock to allow new transactions
                    // all responses are prepared, send them in tipbot.js
                    cb(null, responses);
                });
            } else {
                // result == false
                error = self.text["SendOops_1"] + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendOops_2"] + sendToUser.name + "";
                self.locked = false;  //  this transaction is done, clear lock to allow new transactions
                cb(error, null);
            }
<<<<<<< HEAD
            // lock now and new transactions
            self.locked = true;
=======
            
>>>>>>> feature/Rain
        });
        /*
        
           // debug for rain simulation           
           var responses = {               
               public: self.text["SendPublicMessage_1"] + self.handle + self.text["SendPublicMessage_2"] + sendToUser.handle
           };
           //  prepare message to recieving user to inform of tip
           responses["privateToReciever"] = self.text["SendPrivateMssRecievingUser_1"] + sendToUser.handle + self.text["SendPrivateMssRecievingUser_2"] + + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendPrivateMssRecievingUser_3"] + self.handle + " !";
           // prepare message to sending user to inform of new balance
           self.getBalanceLine(function (err, balanceLine) {
               responses["privateToSender"] = self.handle + self.text["SendPrivateMssSendingUser"] + balanceLine;
               // all responses are prepared, send them in tipbot.js
               self.locked = false;
               cb(null, responses);
           });
          */
    });

};

User.prototype.getSlackHandle = function () {
    var self = this;
    return "<@" + self.id + "|" + self.name + ">";
};

User.fromMember = function (tipbot, member) {
    var user = new User(tipbot, member.id, member.name, member.is_admin);
    return user;
};

module.exports = User;
