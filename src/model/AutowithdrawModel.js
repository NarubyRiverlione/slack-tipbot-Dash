'use strict'
// Auto-withdraw model

let mongoose = require('mongoose'),
  Schema = mongoose.Schema

let AutowithdrawShema = new Schema({
  userID: String,
  address: String,
  amount: Number,
  id: String
})

AutowithdrawShema.virtual('date')
  .get(function () {
    return this._id.getTimestamp()
  })


mongoose.model('Autowithdraw', AutowithdrawShema)

