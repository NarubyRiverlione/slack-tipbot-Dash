#Dash TipBot For Slack
Easily transfer money between team members on your Slack channel.

## Features
 - With a single message, send and receive Dash
 - A tip has no transaction fee. There are no extra cost added to your tip.


## How to Run a TipBot
### Setup
 - Add a bot integration to Slack [here](https://my.slack.com/services/new/bot)
    - Make sure you copy the Slack API token

### Install
 - `git clone https://github.com/narubyriverlione/slack-tipbot`
 - `cd slack-tipbot`
 - `npm install`
 - create cache directory for the price rates: `mkdir tmp/rates`

### Run
Change the `YOUR_SLACK_TOKEN`, `YOUR_RPC_USER` and `YOUR_RPC_PASSWORD` in the below snippet to the API key.
```sh
 node bot.js --slack-token="YOUR_SLACK_TOKEN" --rpc-user="YOUR_RPC_USER" --rpc-password="YOUR_RPC_PASSWORD" 
```

You can also use ENV variable instead of argument:
 - `TIPBOT_SLACK_TOKEN`
 - `TIPBOT_RPC_USER`
 - `TIPBOT_RPC_PASSWORD`
 
You can also set the *RPC port* if you need to, it defaults to 9998

If your wallet is locked (and it should !) provided the *passphrase* via the `--wallet-password`argument or the `TIPBOT_WALLET_PASSWORD` enviroment variable.


You should use [forever](https://www.npmjs.com/package/forever) to run the bot persistend.
Create a json file with all the needed arguments.


### Usage
You can control / communicate with the tipbot by sending the bot a **direct message** or **mentioning** its name in a channel.
The tipbot responds to certain 'trigger words' in a sentence, so you can wrap the trigger word in a nice looking sentence and it will work.

For example, to trigger the `help` command you can could say `hey @tipbot can you help me figure out how tipping works`
and the `help` in that sentence will trigger displaying the help information.

#### Commands / Trigger words
##### `help`        - *ask the bot for help*
eg; `hey @tipbot can you show me the help info!`

##### `balance`     - *ask the bot for your current balance*
eg; `hey @tipbot can you please tell me my balance`

##### `send <value + unit> @someone` - *tell the bot to send coins to someone*
eg; `@tipbot please send .001 Dash to @bob` will send 0.001 Dash to @bob.

This command has a few aliases which you can use; `give` and `sent`. 
You can also use fiat currencies, they will be converted to the Dash value.
eg; `@tipbot can you give @bob 1 euro` or `@tipbot I'd like you to send @bob 0.5 usd`

##### `deposit`     - *ask the bot for a deposit address*
eg; `@tipbot I'd like to deposit to my tip jar`

##### `withdraw`    -  *tell the bot you want to withdraw to an address*
after you've requested the withdraw the bot will confirm with you if it's OK, replying with `yes`, `ok` or `sure` will make the transaction happen.
eg; `@tipbot I want to withdraw 0.5 Dash to 1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp`

##### `currencies` - ask the bot for a list of supported currencies. 
eg; `_@tipbot what currencies do you know?`

##### `price`      - ask the bot for the Dash price in a particular currency. 
eg; `_@tipbot price in USD!` 

##### `convert`    - ask the bot to convert between a particular currency and Dash (or visa versa)
eg; `@tipbot 1 USD to EUR!_​  or; ​_@tipbot 0.03 DASH to GBP`


### Channels
By default the tipbot joins the default `#general` channel, you can invite him into other channels just like you invite normal users into channels.


When enabled by an admin you can ask dash:
- ​*receive* <value + unit> @someone​  tell the bot to request coins from someone.  `@tipbot I want to receive 0.1 Dash from @bob` will request 0.1 Dash from @bob. After you've requested coins from someone that person will be asked if that is OK, replying with `yes`, `ok` or `sure` will make the transaction happen. The `<value + unit>` can be `0.1 Dash` or `10000000 Satoshi`  This command has a few aliases which you can use; `ask`, `demand`, `deserve`, `send me`, `give me`, `gimme` and `owes me` eg; `@tipbot I demand 0.1 Dash from @bob for making such a cool bot` or `@tipbot @bob please gimme 0.1 Dash for lunch`


## Security / Privacy
The (admin of the) tipbot is in full control of the coins.
When you invite the tipbot into a channel it can see all the messages in the channel.
