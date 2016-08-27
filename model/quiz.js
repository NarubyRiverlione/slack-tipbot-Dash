'use strict';
// Quiz model

let mongoose = require('mongoose'),
    autoInc = require('mongoose-auto-increment'),
    Schema = mongoose.Schema;


let QuizShema = new Schema({
    question: String,
    answer: String,
    reward: {type: Number, default: 0, index:true},
    qaNumber: Number

});

QuizShema.plugin(autoInc.plugin, {
    model: 'Quiz',
    field: 'qaNumber',
    startAt: 10,
});

QuizShema.virtual('date')
    .get(function () {
        return this._id.getTimestamp();
    });


mongoose.model('Quiz', QuizShema);

