'use strict';
let debug = require('debug')('tipbot:quiz');
//let helpTexts = require('../text/txt_dash.js').tipbotTxt;

let mongoose = require('mongoose');
let Quiz = mongoose.model('Quiz');

let _ = require('lodash');
//let blocktrail = require('blocktrail-sdk');
let async = require('async');
//require('waitjs');

let amountQuizQuestions = 2;
let quizQuestions = null;
let participants = {}; // username:[answers] ,length [answers] =//
let score = {}; // username : points
let isRunning = false;

// Quiz.ensureIndexes(err=> {
//   if (err) {debug(err);}
// });


Quiz.on('index', function (err) {
    /* If error is truthy, index build failed */
    if (err) {
        debug('******** ERROR: indexing Quiz: ' + err);
    } else {
        debug('******** Quiz is indexed');
    }
});

function amountOfApprovedQuestions(cb) {
    Quiz.find({ reward: { $gt: 0 } }).count().exec((err, amount) => { cb(err, amount); });
}

function getApprovedQuestions(cb) {
    Quiz.find({ reward: { $gt: 0 } })
        .sort('qaNumber')
        .exec((err, allQuestions) => { cb(err, allQuestions); });
}

function getUnreviewedQuestions(cb) {
    Quiz.find({ reward: 0 })
        .sort('qaNumber')
        .exec((err, allQuestions) => { cb(err, allQuestions); });
}

function saveNew(q, a, cb) {
    let newQA = new Quiz({ question: q, answer: a, reward: 0 });
    newQA.save(err => { cb(err); });
}

function deleteQuestion(questionNumber, cb) {
    Quiz.findOneAndRemove(
        { qaNumber: parseInt(questionNumber) },
        (err) => {
            cb(err);
        });
}

function setReward(questionNumber, r, cb) {
    Quiz.findOneAndUpdate(
        { qaNumber: parseInt(questionNumber) },
        { $set: { reward: r } },
        (err) => { cb(err); }
    );
}

function getQuestion(questionNumber, cb) {
    Quiz.findOne(
        { qaNumber: questionNumber },
        (err, result) => {
            cb(err, result);
        });
}

function pickRandomQuestion(cb) {
    Quiz.aggregate(
        [
            { $match:  { reward: { $gt: 0 } } },
            { $sample: { size:1}  }
        ],
        (err, data) => { cb(err, data); }
    );
}

function isUniqueQuestionInQuiz(q) {
    let unique = true;
    //TODO: map / filters?
    quizQuestions.forEach(question => {
        if (question.qaNumber === q.qaNumber) {
            unique = false;
        }
    });
    return unique;
}

function addQuestionToQuiz(questionNR) {
    pickRandomQuestion((err, pickedQuestion) => {
        if (err) { throw new Error(err); }
        pickedQuestion = pickedQuestion[0];
        debug('picked ' + pickedQuestion.qaNumber);
        // check if the question is already picked before
        if (isUniqueQuestionInQuiz(pickedQuestion) === false) {
            debug('Picked a question ' + pickedQuestion.qaNumber + ' that is already selected for the quiz.');
            addQuestionToQuiz(questionNR);
        } else {
            // save picked question
            quizQuestions[questionNR] = pickedQuestion;
            debug('Added picked question ' + quizQuestions[questionNR].qaNumber);
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

    // check if there are approved question to pick from
    amountOfApprovedQuestions((err, amount) => {
        if (err) { cb(err, null); return; }
        if (amount === 0) {
            cb('Cannot start a quiz because there are no (approved) questions.\n' +
                'Check with the _quiz list_ command.', null);
            return;
        }
    });

    // pick x amountQuizQuestions
    // findMaxId((err, maxQuestionID) => {
    // if (err) { cb(err); return; }
    // create array of async tasks that each pick a unique question
    for (let questionNR = 0; questionNR < amountQuizQuestions; questionNR++) {
        arrayOfTasks.push(
            (asyncCB) => {
                addQuestionToQuiz(questionNR);
                asyncCB();
            });
    }

    async.series(
        arrayOfTasks, // series as tasks must run after each other to make questions uni
        (err) => {
            if (err) { cb(err); }
            else {
                isRunning = true;
                cb(null, 'Done!');
            }
        });
    // });
}

function scoreAnswer(answer, quizQuestion) {
    return quizQuestions[quizQuestion].answer.toLowerCase === answer.toLowerCase ? quizQuestions[quizQuestion].reward : 0;
}

function calcScore(cb) {
    _.forEach(participants, (answers, userName) => {
        score[userName] = 0;
        _.forEach(answers, (answer, index) => {
            debug(userName + ' score before' + score[userName] + ' check Q '+ index)
            score[userName] += scoreAnswer(answer, index);
            debug(userName + ' score after' + score[userName]+ ' check Q '+ index)
        });
    });
    cb(score);
}
// deletes quiz
function abort() {
    quizQuestions = null;
    participants = {};
    isRunning = false;
    score = {};
}

// ends quiz = no more answers allowed
function end(cb) {
    isRunning = false;
    calcScore(scores => { cb(scores); });
    abort();
}

function askQuestion(userName, cb) {
    if (!isRunning) {
        debug('Quiz isn\'t running at the moment', null);
        return;
    }
    let answers = participants[userName];
    if (answers === undefined) {
        // first question for this user, create empty answer array for this user
        participants[userName] = []; //
    }
    let currentQuestion = participants[userName].length;

    if (currentQuestion >= amountQuizQuestions) {
        // already done
        cb('You alread answered all question in this quiz.', null);
        return;
    }
    // get next question for this user
    let questionSentence = 'Answer this: ' + quizQuestions[currentQuestion].question +
        'DEBUG:' +
        ' \n for a reward of ' + quizQuestions[currentQuestion].reward +
        ' \n Correct answer: ' + quizQuestions[currentQuestion].answer;
    cb(null, questionSentence);
}

function recordAnswer(userName, answer, cb) {
    if (!isRunning) {
        cb('Quiz isn\'t running at the moment', null);
        return;
    }
    let answers = participants[userName];
    if (answers === undefined) { throw new Error('Unknow participant: ' + userName); }
    // save answer
    answers.push(answer);
    // check if this was last question in quiz
    let done = (answers.length === amountQuizQuestions);
    cb(null, done);
}

function showCorrectAnswers(cb) {
    if (quizQuestions === null) {
        cb('No quiz question are picked.', null);
        return;
    }
    let sentence = '';
    _.forEach(quizQuestions, (Qa) => {
        sentence += 'Q: ' + Qa.question + '\n';
        sentence += 'A: ' + Qa.answer + '\n\n';
    });
    cb(null, sentence);
}

module.exports = {
    getApprovedQuestions,
    saveNew,
    deleteQuestion,
    getUnreviewedQuestions,
    setReward,
    getQuestion,
    start,
    end,
    abort,
    askQuestion,
    recordAnswer,
    calcScore,
    showCorrectAnswers
};
