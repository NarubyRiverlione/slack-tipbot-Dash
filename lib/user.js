"use strict";
var dashd = require("bitcoin");
var debug = require("debug")("tipbot:user");
var blocktrail = require("blocktrail-sdk");
//var _ = require("lodash");
//var async = require("async");
//var pbkdf2 = require("pbkdf2-compat").pbkdf2Sync;

var User = function(tipbot, userId, userName, isAdmin) {
    var self = this;

    self.tipbot = tipbot;
    self.id = userId;
    self.name = userName;
    self.is_admin = isAdmin || false;
    self.handle = self.getSlackHandle();
    
    self.wallet = new dashd.Client({
        host: "localhost",
        port: 9998,
        user: "1",
        pass: "2",
        timeout: 30000
    });
    self.tx_fee = blocktrail.toSatoshi(0.0001);  // fee in satochi
    self.blockchainUrl = "https://chainz.cryptoid.info/dash/tx.dws?";
};

User.prototype.updateFromMember = function(member) {
    var self = this;
    self.name = member.name;
    self.is_admin = member.is_admin;
    self.handle = self.getSlackHandle();
};

User.prototype.tellBalance = function(channel) {
    var self = this;
    self.getBalanceLine(function(err, line) {
        channel.send(line);
    });
};

User.prototype.getBalanceLine = function(cb) {
    var self = this;
    debug("Get balance for " + self.handle);
    self.wallet.getBalance(self.id, 6, function(err, balance, resHeaders) {
        if (err) {
            debug("ERROR", err);
            return;
        }
        cb(null, self.handle + " balance: " + balance + " Dash");
    });
};

User.prototype.tellDepositeAddress = function(channel) {
    var self = this;

   // self.getWallet(function(wallet) {
   // get all addresses in de the wallet for this user 
   // should be 1 if users has already an account, if he hasn't give hem one now   
    self.wallet.getAddressesByAccount(self.id, function (err, addresses,resHeaders){
        if (addresses !== undefined && addresses.length > 0) {
        // found an address for this userID in the wallet
            var address = addresses[0]; // get first address 
            debug("Existing address for " + self.handle + "= " + address);
            channel.send(self.handle + " you can deposite to; " + address);
        } else {
        // didn't find an address for this user in the wallet, create an account now
            self.wallet.getNewAddress(self.id, function(err, address,resHeaders) {
                debug("New address for " + self.handle + "= " + address);
                channel.send(self.handle + " you can deposite to; " + address);
            });
        }
    });
};

User.prototype.withdraw = function(channel, value, toAddress) {
    // value is in satochi !
    var self = this;
    self.wallet.getBalance(self.id, 6, function(err, balance, resHeaders) {
        if (err) {
            debug(err);
            channel.send(err.message);
            return;
        }
        balance = blocktrail.toSatoshi(balance);
        if (balance >= value + self.tx_fee) {
        // enough balance 
            if (value == balance) {
          // withdraw everything (minus the fee)  
                value -= self.tx_fee; 
            }

            self.wallet.sendToAddress(toAddress, parseFloat(blocktrail.toBTC(value)), 
            "withdraw from Slack Tipbot ",
            self.handle,
            function(err,tx_id,resHeaders){     
                if (err) {
                    debug(err);
                    channel.send(err.message);
                    return;
                }

                var url = self.blockchainUrl + tx_id;
                channel.send("Withdrawl of " + blocktrail.toBTC(value) + " Dash  to " 
                + toAddress 
                + " transaction; " + url);
            });
        } else {
        // not enough balance
            channel.send("Sorry " + self.handle + " you do not have enough balance to do this ...");
        }
    });
};

User.prototype.send = function(channel, sendToUser, value) {
    var self = this;
    self.wallet.getBalance(self.id, 6, function(err, balance, resHeaders) {
        balance = blocktrail.toSatoshi(balance);
        if (err) {
            channel.send(err);
   //} else if (balance == value) {
   //  channel.send('Sorry ' + self.handle + ' you can not send your full balance, need to account for the fee ...');
        } else if (balance <= value) {
            channel.send("Sorry " + self.handle + " you do not have enough balance to do this ...");
        }
        
   // check if reciever has an address in the wallet (maybe he has got an account yet, if so create one now)
        self.wallet.getAddressesByAccount(sendToUser.id, function (err, addresses,resHeaders){
            if (addresses == undefined && addresses.length == 0) {
       // didn't find an address for this user in the wallet, create an account now
                self.wallet.getNewAddress(sendToUser.id, function(err, address,resHeaders) {
                    if (err) {
                        debug(err);
                    }
                    debug("New account for " + self.handle + "= " + address);
                });
            }
        });
   
    // use a in wallet transfer now that where sure recievers has an account in the wallet
        // self.wallet.move(self.id, sendToUser.id, parseFloat(blocktrail.toBTC(value)), function(err, result, resHeaders){
        //     if (err) {
        //         debug(err);
        //     }
        //     if (result === true) {
        //         debug("Sent " + blocktrail.toBTC(value) + " Dash from " + self.handle + " to " + sendToUser.handle);           
        //         channel.send("Sent " + blocktrail.toBTC(value) + " Dash from " + self.name + " to " + sendToUser.name);
        //     } else {
        //         channel.send("Oops could not tip " + blocktrail.toBTC(value) + " Dash to " + sendToUser.name + "");
        //     }
        // });
    });         
};

User.prototype.getSlackHandle = function() {
    var self = this;
    return "<@" + self.id + "|" + self.name + ">";
};

User.fromMember = function(tipbot, member) {
    var user = new User(tipbot, member.id, member.name, member.is_admin);
    return user;
};

module.exports = User;
