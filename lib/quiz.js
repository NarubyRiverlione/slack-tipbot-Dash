'use strict';
let debug = require('debug')('tipbot:quiz');
//let helpTexts = require('../text/dash.js').tipbotTxt;

let mongoose = require('mongoose');
let Quiz = mongoose.model('Quiz');

let _ = require('lodash');
//let blocktrail = require('blocktrail-sdk');
let async = require('async');
//require('waitjs');

let amountOfQuestions = 2;
let quizQuestions = null;
let participants = {}; // username:[answers] ,length [answers] =//
let score = {}; // username : points
let isRunning = false;

function findMaxId(cb) {
    Quiz.findOne({})
        .sort('-qNumber')
        .exec((err, result) => {
            if (result === null) {
                cb('Didn\`t find any questions.');
            } else {
                cb(err, result.qNumber);
            }
        });
}

function getApprovedQuestions(cb) {
    Quiz.find(
        { reward: { $gt: 0 } },
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
    findMaxId((err, maxID) => {
        if (!err) { newQnumber = maxID + 1; }

        let newQA = new Quiz({
            question: q,
            answer: a,
            reward: 0,
            qNumber: newQnumber
        });

        newQA.save((err) => {
            cb(err, newQnumber);
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

function getQuestion(questionNumber, cb) {
    Quiz.findOne(
        { qNumber: questionNumber, reward: { $gt: 0 } },
        (err, result) => {
            cb(err, result);
        });
}

function pickRandomQuestion(maxID, cb) {
    let questionNumber = Math.floor((Math.random() * maxID + 1));
    // questionNumber arn't lineair because a question can be deleted, so check if this random questionNumber exist
    getQuestion(questionNumber, (err, question) => {
        if (err) {
            debug('ERROR picking a question: ' + err);
            cb(null);
        }
        if (question === null) {
            pickRandomQuestion(maxID, cb);
        }   // no question found, recuicive try again
        else {
            cb(question);
        }
    });
}

function isUniqueQuestionInQuiz(q){
    let unique=true;
    //TODO: map / filters?
    quizQuestions.forEach(question=>{
        if(question.qNumber === q.qNumber) {
            unique = false;
        }
    });
    return unique;
}

function addQuestionToQuiz(maxQuestionID, questionNR) {
    pickRandomQuestion(maxQuestionID, (pickedQuestion) => {
  //debug('picked ' + pickedQuestion.qNumber);
        // check if the question is already picked before
        if (isUniqueQuestionInQuiz(pickedQuestion) === false) {
            debug('Picked a question ' + pickedQuestion.qNumber + ' that is already selected for the quiz.');
            addQuestionToQuiz(maxQuestionID, questionNR);
        } else {
            // save picked question
            quizQuestions[questionNR] = pickedQuestion;
            debug('Added picked question ' + quizQuestions[questionNR].qNumber);
            return;
        }
    });
}

function start(cb) {
    if (isRunning) {
        cb('Already in a quiz');
        return;
    }
    quizQuestions = [];
    let arrayOfTasks = [];

    // pick x amountOfQuestions
    findMaxId((err, maxQuestionID) => {
        if (err) { cb(err); return; }
        // create array of async tasks that each pick a unique question
        for (let questionNR = 0; questionNR < amountOfQuestions; questionNR++) {
            arrayOfTasks.push(
                (asyncCB) => {
                    addQuestionToQuiz(maxQuestionID, questionNR);
                    asyncCB();
                });
        }

        async.series(
            arrayOfTasks, // series as tasks must run after each other to make questions uni
            (err) => {
                if (err) { cb(err); }
                else {
                    isRunning=true;
                    cb(null, 'Done!'); }
            });
    });
}

function scoreAnswer(answer,qNumber) {
 return quizQuestions[qNumber].answer === answer ? quizQuestions[qNumber].reward : 0;
}

function calcScore(cb){
    _.forEach(participants,(answers,userName) => {
    score[userName] = 0;
        _.forEach(answers,(answer,index) => {
            score[userName] += scoreAnswer(answer,index);
        });
    });
    cb(score);
}
// deletes quiz
function clean() {
    quizQuestions = null;
    participants = {};
    isRunning=false;
    score={};
}
// ends quiz = no more answers allowed
function stop(cb){
    isRunning=false;
    calcScore();
    cb(score);
    clean();
}

function askQuestion(userName, cb) {
    if (!isRunning) {
        cb('Quiz isn\'t running at the moment', null);
        return;
    }
    let answers = participants[userName];
    if (answers === undefined) {
        // first question for this user, create empty answer array for this user
        participants[userName] = []; //
    }
    let currentQuestion = participants[userName].length;

    if (currentQuestion >= amountOfQuestions) {
        // already done
        cb('You alread answered all question in this quiz.', null);
        return;
    }
    // get next question for this user
    let questionSentence = 'Answer this: ' + quizQuestions[currentQuestion].question +
    ' \n for a reward of ' + quizQuestions[currentQuestion].reward;
    cb(null, questionSentence);
}

function recordAnswer(userName, answer, cb) {
    if (!isRunning) {
        cb('Quiz isn\'t running at the moment',null);
        return;
    }
    let answers = participants[userName];
    if (answers === undefined) { throw new Error('Unknow participant: ' + userName); }
    // save answer
    answers.push(answer);
    // check if this was last question in quiz
    let done = (answers.length === amountOfQuestions);
    cb(null,done);
}

module.exports = {
    getApprovedQuestions,
    saveNew,
    deleteQuestion,
    getUnreviewedQuestions,
    setReward,
    start,
    stop,
    askQuestion,
    recordAnswer,
    calcScore
};
