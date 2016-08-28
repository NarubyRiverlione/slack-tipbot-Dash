'use strict';
let debug = require('debug')('tipbot:quiz');
let mongoose = require('mongoose');
let async = require('async');

let Quiz = mongoose.model('Quiz');

let texts = require('../text/txt_dash.js').quizTxt;

let amountQuizQuestions = 2;
let quizQuestions = null;
let scoreboard = {}; 	// username : points
let isRunning = false;
let currentQuestion = 0;
let debugMode = false;


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
            { $match: { reward: { $gt: 0 } } },
            { $sample: { size: 1 } }
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

function addQuestionToQuiz(questionNR, cb) {
    pickRandomQuestion((err, pickedQuestion) => {
        if (err) { throw new Error(err); }
        pickedQuestion = pickedQuestion[0];
        debug('picked ' + pickedQuestion.qaNumber);
        // check if the question is already picked before
        if (isUniqueQuestionInQuiz(pickedQuestion) === false) {
            debug('Picked a question ' + pickedQuestion.qaNumber + ' that is already selected for the quiz.');
            addQuestionToQuiz(questionNR, cb);
        } else {
            // save picked question
            quizQuestions[questionNR] = pickedQuestion;
            debug('Added picked question ' + quizQuestions[questionNR].qaNumber);
            cb();
        }
    });
}

function start(cb) {
    if (isRunning) {
        cb(texts.alreadyRunning);
        return;
    }
    quizQuestions = [];
    scoreboard = {};
    let arrayOfTasks = [];

    // check if there are approved question to pick from
    amountOfApprovedQuestions((err, amount) => {
        if (err) { cb(err); return; }
        if (amount === 0) {
            cb(texts.notStarted_noApprovedQ);
            return;
        }

        // pick x amountQuizQuestions
        // create array of async tasks that each pick a unique question
        for (let questionNR = 0; questionNR < amountQuizQuestions; questionNR++) {
            arrayOfTasks.push(
                (asyncCB) => {
                    addQuestionToQuiz(questionNR, asyncCB);

                });
        }

        async.series(
            arrayOfTasks, 	// series as tasks must run after each other to make questions uni
            (err) => {
                if (err) { cb(err); }
                else {
                    isRunning = true;
                    cb(null);
                }
            });
    });
}

// check if answer if correct
function scoreAnswer(answer, quizQuestion) {
    return quizQuestion.answer.toLowerCase() === answer.toLowerCase() ? quizQuestion.reward : 0;
}

// deletes quiz
function abort() {
    quizQuestions = null;
    isRunning = false;
    currentQuestion = 0;
    scoreboard = {};
}

// ends quiz = no more answers allowed
function end(cb) {
    cb(scoreboard);
    abort();
}

// post a question, check if this is the last question in the quiz
function askQuestion(cb) {
    if (!isRunning || quizQuestions.length === 0) {
        cb(texts.notRunning, null);
        return;
    }

    if (currentQuestion > amountQuizQuestions - 1) {
        // already done
        cb(texts.done, null);
        return;
    }
    // get next question
    let questionSentence =  quizQuestions[currentQuestion].question;
    if(debugMode) {
        questionSentence+= '\n\nDEBUG:' +
        ' \n for a reward of ' + quizQuestions[currentQuestion].reward +
        ' \n Correct answer: ' + quizQuestions[currentQuestion].answer;
    }
    cb(null, questionSentence);
}

function checkAnswer(answer, userName, cb) {
    if (!isRunning) {
        cb(texts.notRunning);
        return;
    }
    let score = scoreAnswer(answer, quizQuestions[currentQuestion]);
    if (score !== 0) {
        debug('CORRECT quiz answer!');
        if (scoreboard[userName] === undefined) { scoreboard[userName] = 0; }
        scoreboard[userName] += score;
        // check if this was last question in quiz
        let done = (currentQuestion === amountQuizQuestions - 1); 	// start at 0 for array index
        currentQuestion++;
        cb(null, done, true);
    } else {
        debug('WRONG quiz answer');
        cb(null, null, false);
    }
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
    checkAnswer
};
