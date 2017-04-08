'use strict'

module.exports = class User {
  constructor(member) {
    this.id = member.id
    this.name = member.name
    this.is_admin = member.is_admin || false
    this.handle = getSlackHandle(this)

    this.locked = false  // to prevent multiple transactions
  }
}

function getSlackHandle(user) {
  return '<@' + user.id + '|' + user.name + '>'
}


