'use strict';
var bitcoin = require('bitcoin');

// all config options are optional
var client = new bitcoin.Client({
  host: 'localhost',
  port: 9998,
  user: '1',
  pass: '2',
  timeout: 30000
});


// list accounts
client.listAccounts(function(err, accounts, resHeaders) {
  if (err) return console.log(err);
  console.log('Accounts:', accounts);
});

// Get balance across all accounts with minimum confirmations of 6
client.getBalance('*', 6, function(err, balance, resHeaders) {
  if (err) return console.log(err);
  console.log('Total balance:', balance);
});

// Get balance for an account 
var account = 'Naruby';
client.getBalance(account, 6, function(err, balance, resHeaders) {
  if (err) return console.log(err);
  console.log('Balance for "' + account + '" = ', balance);
});


// Get address for a user
var userID = 'Naruby';
var address = '';
client.getAddressesByAccount(userID, function (err, addresses,resHeaders){
  if (addresses !== undefined && addresses.length > 0) {
    // found an address for this userID in the wallet
    address = addresses[0]; // get first address 
    console.log ('Existing address for ' + userID + '= ' + address);
  } else {
    // didn't find an address for this user in the wallet, create an account now
    client.getNewAddress(userID, function(err, address,resHeaders) {
       console.log ('New address for ' + userID + '= ' + address);
    });
  }
});
