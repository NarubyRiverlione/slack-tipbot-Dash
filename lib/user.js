'use strict';
var dashd = require('bitcoin');

var _ = require('lodash');
var debug = require('debug')('tipbot:user');
var async = require('async');
var blocktrail = require('blocktrail-sdk');
var pbkdf2 = require('pbkdf2-compat').pbkdf2Sync;

var User = function(tipbot, userId, userName, isAdmin) {
    var self = this;

    self.tipbot = tipbot;
    self.id = userId;
    self.name = userName;
    self.is_admin = isAdmin || false;
    self.handle = self.getSlackHandle();
    
    self.wallet = new dashd.Client({
        host: 'localhost',
         port: 9998,
         user: '1',
         pass: '2',
        timeout: 30000
    });
    self.tx_fee = blocktrail.toSatoshi(0.0001)  // fee in satochi
    self.blockchainUrl = 'https://chainz.cryptoid.info/dash/tx.dws?';

};

User.prototype.updateFromMember = function(member) {
    var self = this;

    self.name = member.name;
    self.is_admin = member.is_admin;
    self.handle = self.getSlackHandle();
};

// User.prototype.getWallet = function(cb, retry) {
//     var self = this;

//     if (typeof retry === "undefined") {
//         retry = false;
//     }

//     if (!self.wallet) {
//         var walletIdentifier = "SLACK-" + self.id,
//             walletPassphrase = pbkdf2("SLACK-" + self.id, self.tipbot.SECRET, 2048, 64, 'sha512').toString('hex');

//         self.tipbot.client.initWallet(walletIdentifier, walletPassphrase, function(err, wallet) {
//             if (err && err.statusCode == 404) {
//                 self.tipbot.client.createNewWallet(walletIdentifier, walletPassphrase, function(err, wallet) {
//                     self.wallet = wallet;

//                     cb(self.wallet, true);
//                 });
//             } else if (err) {
//                 debug('ERROR', err);

//                 if (!retry) {
//                     setTimeout(function() {
//                         self.getWallet(cb, true);
//                     }, 3000);
//                 } else {
//                     cb();
//                 }
//             } else {
//                 self.wallet = wallet;

//                 cb(self.wallet);
//             }
//         });
//     } else {
//         cb(self.wallet);
//     }
// };

User.prototype.tellBalance = function(channel) {
    var self = this;

    self.getBalanceLine(function(err, line) {
        channel.send(line);
    });
};

User.prototype.getBalanceLine = function(cb) {
    var self = this;

      debug('Get balance for ' + self.handle);
        self.wallet.getBalance(self.id, 6, function(err, balance, resHeaders) {
            if (err) {
                return debug('ERROR', err);
            }

            cb(null, self.handle + " balance: " + balance + " Dash");
            //+ " BTC | unconfirmed; " + blocktrail.toBTC(unconfirmed) + " BTC");
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
         debug('Existing address for ' + self.handle + '= ' + address);
         channel.send(self.handle + " you can deposite to; " + address);
    } else {
        // didn't find an address for this user in the wallet, create an account now
        self.wallet.getNewAddress(self.id, function(err, address,resHeaders) {
         debug('New address for ' + self.handle + '= ' + address);
         channel.send(self.handle + " you can deposite to; " + address);
        });
    }
  });
  //  });
};

User.prototype.withdraw = function(channel, value, toAddress) {
    // value is in satochi !
    var self = this;

   self.wallet.getBalance(self.id, 6, function(err, balance, resHeaders) {
     if (err) {
        debug(err);
        channel.send(err.message);
      } else if (blocktrail.toSatoshi(balance) >= value + self.tx_fee) {
        // enough balance 
        if (value == balance) {
          // withdraw everything (minus the fee)  
          value -= self.tx_fee; 
        }
       // var pay = {};
       // pay[toAddress] = value;
       // wallet.pay(pay, function(err, txHash) {
       self.wallet.sendToAddress(toAddress, parseFloat(blocktrail.toBTC(value)), 
        'withdraw from Slack Tipbot ',
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
     } 
     // not enough balance
     else {
         channel.send("Sorry " + self.handle + " you do not have enough balance to do this ...");
      }
    });
};

User.prototype.send = function(channel, user, value) {
    var self = this;

    // do self and user in parallel to speed things up a bit
    async.parallel({
        self: function(cb) {
            self.getWallet(function(wallet) {
                wallet.getBalance(function(err, confirmed, unconfirmed) {
                    if (err) {
                        cb(err);
                    } else if (confirmed == value) {
                        cb(new Error("Sorry " + self.handle + " you can't send your full balance, need to account for the fee ..."));
                    } else if (confirmed >= value) {
                        cb(null, true);
                    } else if (confirmed + unconfirmed >= value) {
                        cb(new Error("Sorry " + self.handle + " you have to wait for your previous transactions to be confirmed before you can do this ..."));
                    } else {
                        cb(new Error("Sorry " + self.handle + " you do not have enough balance to do this ..."));
                    }
                });
            });
        },
        user: function(cb) {
            user.getWallet(function(wallet) {
                wallet.getNewAddress(function(err, address) {
                    cb(err, address);
                });
            });
        }
    }, function(err, results) {
        if (err) {
            console.log(err);
            channel.send(err.message);
            return;
        }

        self.getWallet(function(wallet) {
            var send = {};
            send[results.user] = value;

            wallet.pay(send, function(err, txHash) {
                if (err) {
                    console.log(err);
                    channel.send(err.message);
                    return;
                }

                var url = self.tipbot.explorerBaseUrl + "/tx/" + txHash;
                channel.send("Sent " + blocktrail.toBTC(value) + " BTC from " + self.handle + " to " + user.handle + " transaction; " + url);
            });
        });
    })
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
