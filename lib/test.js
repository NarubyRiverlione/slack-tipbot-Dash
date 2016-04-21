
var dashd = require("bitcoin");
var parseArgs = require("minimist");
var argv = parseArgs(process.argv.slice(2));

var SLACK_TOKEN = argv["slack-token"] || process.env.TIPBOT_SLACK_TOKEN,
    RPC_USER = argv["rpc-user"] || process.env.TIPBOT_RPC_USER,
    RPC_PASSWORD = argv["rpc-password"] || process.env.TIPBOT_RPC_PASSWORD,
    RPC_PORT = argv["rpc-port"] || process.env.TIPBOT_RPC_PORT || 9998,
    AUTO_RECONNECT = true,
    OPTIONS = {
        ALL_BALANCES: true,
        DEMAND: true
    };


var wallet = new dashd.Client({
    host: "localhost",
    port: RPC_PORT,
    user: RPC_USER,
    pass: RPC_PASSWORD,
    timeout: 30000
});


wallet.getInfo( function (err, resp, resHeaders) {
    if (err) {
        console.log("ERROR getting info: ", err);

    } else {
        console.log(resp);
    }
});
    
var id = "eeee";

wallet.getBalance(id, 6, function (err, balance, resHeaders) {
    if (err) {
        console.log("ERROR getting confirmed balance: ", err);

    } else {
        console.log("Balance for " + id + " = ".balance);
    }
});