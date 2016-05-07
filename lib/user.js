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

    // TODO: refactoring DRY: self.replyInChannel, set in tipbot.js so it doesn't need to be created in each function here
    // TODO: refactoring DRY: self.privateReply, set in tipbot.js, so it doesn't need to be create here
};

// send via Blockchain
function sendAmount(self, toAddress, value, reply) {
    // send  users Account to Address
    self.wallet.sendFrom(self.id, toAddress, parseFloat(blocktrail.toBTC(value)),
        function (err, tx_id) {
            if (err) {
                debug("ERROR sending via blockchain : " + err);
                reply["text"] = "An error prevents withdrawing.";
                self.tipbot.slack.say(reply);
                return;
            }
            var url = self.blockchainUrl + tx_id;
            reply["text"] = self.text["Withdrawal_1"] + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + " to "
                + toAddress
                + self.text["WithdrawalTransaction"] + url;
            self.tipbot.slack.say(reply);

        });
}

User.prototype.updateFromMember = function (member) {
    var self = this;
    self.name = member.name;
    self.is_admin = member.is_admin;
    self.handle = self.getSlackHandle();
};

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

User.prototype.tellDepositeAddress = function (channelID) {
    var self = this;
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };
    var depositAddress;
    // get all addresses in de the wallet for this user
    // should be 1 if users has already an account, if he hasn't give hem one now
    self.wallet.getAddressesByAccount(self.id, function (err, addresses) {
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
        reply["text"] = self.handle + " you can deposit to: " + depositAddress;
        slack.say(reply);
    });
};

User.prototype.withdraw = function (channelID, value, toAddress, walletPass) {
    // value is in satochi !
    var self = this;
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };
    // prevent multiple transactions, only continue if not already locked
    if (self.locked === true) {
        self.tipbot.getDirectMessageChannelID({ id: channelID }, self.id, function (err, DMchannelSendingUser) {
            if (err === null) {
                var privateReply = {
                    "channel": DMchannelSendingUser.id,
                    "text: ": self.handle + self.text["Locked"]
                };
                slack.say(privateReply);
                return;
            }
        });
    }
    // lock now to prevent new transactions
    self.locked = true;

    self.getBalance(self.id, self.REQUIRED_CONFIRMATIONS, function (err, balance) {
        if (err) {
            reply["text"] = err;
            slack.say(reply);
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
                        debug("ERROR could not unlock wallet");
                        self.locked = false;
                        return;
                    }
                    // wallet is now unlocked for 10 seconds, move amount
                    sendAmount(self, toAddress, value, reply);
                });
            } else {
                // no wallet unlocking needed
                sendAmount(self, toAddress, value, reply);
            }
        } else {
            // not enough balance
            reply["text"] = "Sorry " + self.handle + self.text["InsufficientBalance"];
            slack.say(reply);
        }
        //  this transaction is done, clear lock to allow new transactions
        self.locked = false;
    });
};

User.prototype.send = function (channelID, sendToUser, value, cb) {
    var self = this;
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };
    // prevent multiple transactions, only continue if not already locked
    if (self.locked === true) {
        self.tipbot.getDirectMessageChannelID({ id: channelID }, self.id, function (err, DMchannelSendingUser) {
            if (err === null) {
                var privateReply = {
                    "channel": DMchannelSendingUser.id,
                    "text: ": self.handle + self.text["Locked"]
                };
                slack.say(privateReply);
                return;
            }
        });
    }
    // lock now to prevent new transactions
    self.locked = true;

    // check balance before sending amount to prevent negative saldo
    self.wallet.getBalance(self.id, self.REQUIRED_CONFIRMATIONS, function (err, balance) {
        balance = blocktrail.toSatoshi(balance);
        if (err) {
            debug("ERROR checking balance before sending tip: " + err);
            reply["text"] = "ERROR checking balance before sending tip.";
            slack.say(reply);
            self.locked = false; //  this transaction is done, clear lock to allow new transactions
            return;
        }
        if (balance < value) {
            reply["text"] = self.text["InsufficientBalance_1"] + self.handle + self.text["InsufficientBalance_2"];
            slack.say(reply);
            self.locked = false; //  this transaction is done, clear lock to allow new transactions
            return;
        }
        /* disable sending for rain simulation
                // use a in wallet transfer
                self.wallet.move(self.id, sendToUser.id, parseFloat(blocktrail.toBTC(value)), function (err, result) {
                    if (err) {
                        debug("ERROR: moving between account (" + self.id + ") to acount (" + sendToUser.id + ")" + err);
                        reply["text"] = self.text["SendOops_1"] + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendOops_2"] + sendToUser.name + "";
                        slack.say(reply);
                        self.locked = false;
                        return;
                    }
                    if (result === true) {
                        // Tip is delivered, report in channel where Tip command was issued
                        debug("Sending Tip: Moved " + blocktrail.toBTC(value) + " Dash from " + self.handle + " to " + sendToUser.handle);
                        reply["text"] = self.text["SendPublicMessage_1"] + self.handle + self.text["SendPublicMessage_2"] + sendToUser.handle;
                        slack.say(reply);
        
                        // send new balance to sending user in a DM
                        self.tipbot.getDirectMessageChannelID({id:channelID}, self.id, function (err, DMchannelSendingUser) {
                            if (err === null) {
                                var sendingUserMessage = { "channel": DMchannelSendingUser };
                                self.getBalanceLine(function (err, response) {
                                    sendingUserMessage["text"] = self.handle + self.text["SendPrivateMssSendingUser"] + response;
                                    slack.say(sendingUserMessage);
                                });
                            }
                        });
        
                        // sent DM to recieving user to inform of the Tip
                        self.tipbot.getDirectMessageChannelID({id:channelID}, sendToUser.id, function (err, DMchannelRecievingUser) {
                            if (err === null) {
                                var recievingUserMessage = { "channel": DMchannelRecievingUser };
                                // todo: add message that was used to send
                                recievingUserMessage["text"] = self.text["SendPrivateMssRecievingUser_1"] + sendToUser.handle + self.text["SendPrivateMssRecievingUser_2"] + + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendPrivateMssRecievingUser_3"] + self.handle + " !";
                                slack.say(recievingUserMessage);
                            }
                        });
                    } else {
                        // result == false
                        reply["text"] = self.text["SendOops_1"] + blocktrail.toBTC(value) + " " + self.text["BaseCurrency"] + self.text["SendOops_2"] + sendToUser.name + "";
                        slack.say(reply);
                    }
                    //  this transaction is done, clear lock to allow new transactions
                    self.locked = false;
                });
        */
        // debug for rain simulation
        setTimeout(function () {
            // reply["text"] = "--- send " + value +  " from " + self.handle + " to " + sendToUser.getSlackHandle();
            //           debug(reply["text"]);
            // only show public message when threre is no callback (not sending async rain)
            if (!cb) reply["text"] = self.text["SendPublicMessage_1"] + self.handle + self.text["SendPublicMessage_2"] + sendToUser.handle;
            slack.say(reply);
            
            self.locked = false;
            if (cb) cb(); // callback for async
        }, 250); // similated time of move
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
