'use strict';

let Trigger = function(tipbot, matchFn, options) {
    let self = this;

    self.tipbot = tipbot;
    self.matchFn = matchFn.bind(this);
    self.options = options;

    if (self.options.timeout) {
        setTimeout(function() {
            self.destroy();
        }, self.options.timeout);
    }
};

Trigger.prototype.match = function(channel, message, user, userMatches) {
    let self = this;

    return self.matchFn(channel, message, user, userMatches);
};

Trigger.prototype.destroy = function() {
    let self = this;

    let idx = self.tipbot.triggers.indexOf(self);
    if (idx !== -1) {
        self.tipbot.triggers.splice(idx);
    }
};

module.exports = Trigger;
