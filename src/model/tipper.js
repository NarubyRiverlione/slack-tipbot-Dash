'use strict'
// Tipper model

var mongoose = require('mongoose'),
  Schema = mongoose.Schema

var TipperShema = new Schema({
  name: String,
  id: String,
  tipCount: Number,
  lastTipDate: Date,
  gotRainDrop: { type: Boolean, default: false }
})

TipperShema.virtual('date')
  .get(function () {
    return this._id.getTimestamp()
  })

mongoose.model('Tipper', TipperShema)

