'use strict';
// Quiz model

var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var QuizShema = new Schema({
    question: String,
    answer: String,
    reward: {type: Number, default: 0},
    qNumber: Number
 //   approved: {type:Boolean, default:false}
});

QuizShema.virtual('date')
    .get(function () {
        return this._id.getTimestamp();
    });

mongoose.model('Quiz', QuizShema);

