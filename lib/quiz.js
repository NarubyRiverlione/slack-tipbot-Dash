'use strict';
let debug = require('debug')('tipbot:sun');
//let helpTexts = require('../text/dash.js').tipbotTxt;

let mongoose = require('mongoose');
let Quiz = mongoose.model('Quiz');

let _ = require('lodash');
//let blocktrail = require('blocktrail-sdk');
//let async = require('async');
//require('waitjs');

function findMaxId(cb) {
    Quiz.findOne(
        { reward: { $gt: 0 } },
        { $sort: -Number },
        (err, result) => {
            cb(err, result.qNumber);
        });
}

function getApprovedQuestions(cb) {
    Quiz.find(
        {reward: {$gt:0}},
        (err, allQuestions) => {
            cb(err, allQuestions);
        }
    );
}

function getUnreviewedQuestions(cb) {
    Quiz.find(
        { reward: 0 },
        (err, allQuestions) => {
            cb(err, allQuestions);
        }
    );
}

function saveNew(q, a, cb) {
    let newQnumber = 0;
    findMaxId((err, maxQnumber) => {
        if (err) { debug(err); }
        else { newQnumber = maxQnumber + 1; }
        let newQA = new Quiz({
            question: q,
            answer: a,
            reward: 0,
            qNumber: newQnumber
        });
        newQA.save((err) => {
            cb(err,newQnumber);
        });
    });
}

function deleteQuestion(questionNumber, cb) {
    Quiz.findOneAndRemove(
        { qNumber: parseInt(questionNumber) },
        (err) => {
            cb(err);
        });
}

function setReward(questionNumber, r, cb) {
   //TODO: save currency
    Quiz.findOneAndUpdate(
        { qNumber: parseInt(questionNumber) },
        { $set: { reward: r } },
        (err) => { cb(err); }
    );
}


module.exports = {
    getApprovedQuestions,
    saveNew,
    deleteQuestion,
    getUnreviewedQuestions,
    setReward
};
