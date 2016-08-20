'use strict';
// Quiz model

var mongoose = require('mongoose'),
    autoInc = require('mongodb-autoincrement'),
    Schema = mongoose.Schema;


var QuizShema = new Schema({
    question: String,
    answer: String,
    reward: {type: Number, default: 0, index:true},
    qaNumber: Number

});

QuizShema.plugin(autoInc.mongoosePlugin, {
    field: 'qaNumber',
    step: 1
});

QuizShema.virtual('date')
    .get(function () {
        return this._id.getTimestamp();
    });


mongoose.model('Quiz', QuizShema);

