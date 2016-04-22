"use strict";
var debug = require("debug")("tipbot:user");
var blocktrail = require("blocktrail-sdk");

var User = function (tipbot, userId, userName, isAdmin) {
    var self = this;

    self.tipbot = tipbot;
    self.id = userId;
    self.name = userName;
    self.is_admin = isAdmin || false;
    self.handle = self.getSlackHandle();

    self.wallet = tipbot.wallet;            // RPC connection to wallet
    self.tx_fee = blocktrail.toSatoshi(0.0001);  // fee in satochi
    self.blockchainUrl = "https://chainz.cryptoid.info/dash/tx.dws?";
};

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
    debug("Get balance for " + self.handle);
    self.wallet.getBalance(self.id, 6, function (err, balance, resHeaders) {
        if (err) {
            debug("ERROR getting confirmed balance: ", err);
            return;
        }
        self.wallet.getBalance(self.id, 1, function (err, unconfirmedBalance, resHeaders) {
            if (err) {
                debug("ERROR getting unconfirmed balance: ", err);
                return;
            }
            if (unconfirmedBalance === balance) {
                cb(null, self.handle + " balance: " + balance + " Dash");
            } else {
                cb(null, self.handle + " balance: " + balance + " Dash ( + " + unconfirmedBalance + " unconfirmed) ");
            }
        });
    });
};

User.prototype.tellDepositeAddress = function (channelID) {
    var self = this;
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };

    // get all addresses in de the wallet for this user 
    // should be 1 if users has already an account, if he hasn't give hem one now   
    self.wallet.getAddressesByAccount(self.id, function (err, addresses, resHeaders) {
        if (addresses !== undefined && addresses.length > 0) {
            // found an address for this userID in the wallet
            var address = addresses[0]; // get first address 
            debug("Existing address for " + self.handle + "= " + address);
            reply["text"] = self.handle + " you can deposite to; " + address;
            slack.say(reply);
        } else {
            // didn't find an address for this user in the wallet, create an account now
            self.wallet.getNewAddress(self.id, function (err, address, resHeaders) {
                debug("New address for " + self.handle + "= " + address);
                reply["text"] = self.handle + " you can deposite to; " + address;
                slack.say(reply);
            });
        }
    });
};

User.prototype.withdraw = function (channelID, value, toAddress) {
    // value is in satochi !
    var self = this;
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };


    self.wallet.getBalance(self.id, 6, function (err, balance, resHeaders) {
        if (err) {
            debug(err);
            reply["text"] = err.message;
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

            // send  users Account to Address
            self.wallet.sendFrom(self.id, toAddress, parseFloat(blocktrail.toBTC(value)),
                function (err, tx_id, resHeaders) {
                    if (err) {
                        debug(err);
                        reply["text"] = err.message;
                        slack.say(reply);
                        return;
                    }

                    var url = self.blockchainUrl + tx_id;
                    reply["text"] = "Withdrawl of " + blocktrail.toBTC(value) + " Dash  to "
                        + toAddress
                        + " transaction; " + url;
                    slack.say(reply);

                });
        } else {
            // not enough balance

            reply["text"] = "Sorry " + self.handle + " you do not have enough balance to do this ...";
            slack.say(reply);
        }
    });
};

User.prototype.send = function (channelID, sendToUser, value) {
    var self = this;
    var slack = self.tipbot.slack;
    var reply = { "channel": channelID };

    self.wallet.getBalance(self.id, 6, function (err, balance, resHeaders) {
        balance = blocktrail.toSatoshi(balance);
        if (err) {
            debug("ERROR checking balance before sending tip: " + err);
            reply["text"] = "ERROR checking balance before sending tip: " + err;
            slack.say(reply);
            return;
        }
        if (balance <= value) {
            reply["text"] = "Sorry " + self.handle + " you do not have enough balance to do this ...";
            slack.say(reply);
            return;
        }

        // check if reciever has an address in the wallet (maybe he has got an account yet, if so create one now)
        self.wallet.getAddressesByAccount(sendToUser.id, function (err, addresses, resHeaders) {
            if (addresses === undefined || addresses.length === 0) {
                // didn't find an address for this user in the wallet, create an account now
                self
                    .wallet.getNewAddress(sendToUser.id, function (err, address, resHeaders) {
                        if (err) {
                            debug("ERROR getting a new address for account (" + sendToUser.id + ") :" + err);
                            return;
                        }
                        debug("Sending Tip: New account for " + self.handle + "= " + address);
                    });
            }
        });

        // use a in wallet transfer now that where sure recievers has an account in the wallet
        self.wallet.move(self.id, sendToUser.id, parseFloat(blocktrail.toBTC(value)), function (err, result, resHeaders) {
            if (err) {
                debug("ERROR: moving between account (" + self.id + ") to acount (" + sendToUser.id + ")" + err);
                return;
            }
            if (result === true) {
                // Tip is delivered, report in channel where Tip command was issued
                debug("Sending Tip: Moved " + blocktrail.toBTC(value) + " Dash from " + self.handle + " to " + sendToUser.handle);
                reply["text"] = "Sent " + blocktrail.toBTC(value) + " Dash from " + self.name + " to " + sendToUser.name;
                slack.say(reply);
                
                // sent new balance to sending user in a DM
                self.tipbot.getDirectMessageChannelID(self.id, function (err, DMchannelSendingUser) {
                    if (err === null) self.tellBalance(DMchannelSendingUser);
                });
                
                // sent DM to recieving user to inform of the Tip
                self.tipbot.getDirectMessageChannelID(sendToUser.id, function (err, DMchannelRecievingUser) {
                    if (err === null) {
                        var recievingUserMessage = {"channel" : DMchannelRecievingUser};
                        recievingUserMessage["text"] = "Hi there! You just recieved " + blocktrail.toBTC(value) + " Dash from " + self.name + " !";
                    }
                });
                

            } else {
                reply["text"] = "Oops could not tip " + blocktrail.toBTC(value) + " Dash to " + sendToUser.name + "";
                slack.say(reply);
            }
        });
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
