'use strict';
let mongoose = require('mongoose');
let debug = require('debug')('tipbot:test');

let texts = require('../text/txt_dash.js').tipbotTxt;
let _ = require('lodash');

const DB = 'mongodb://localhost/tipdb-dev';
let reply = {};

// open mongoose connection
mongoose.connect(DB);
let db = mongoose.connection;
db.on('error', function () {
    debug('******** ERROR: unable to connect to database at ' + DB);
});



// database connection open =  conncect to slack
db.once('open', function () {
    require('../model/tipper'); // load mongoose Tipper model
    require('../model/quiz'); // load mongoose Quiz model
    debug('********* Database connected ********');

    let quiz = require('./quiz');
    start(quiz);

    let userName = 'Naruby';
    let questionLoop = setInterval(
        () => {
            askQuestion(quiz, userName);

            let answer = '10 months';
            debug('answerd: ' + answer);

            recordAnswer(quiz, answer, userName,
                (err, done) => {
                    if (err) { debug(err); }
                    if (done) {
                        clearInterval(questionLoop);
                        debug('Done answering.');
                        score(quiz);
                    }
                });
        },
        1000);
});


function start(quiz) {
    quiz.start(function (err, result) {
        if (err) {
            debug('ERROR starting quiz: ' + err);
            reply.text = texts.QuizErrorStarting + err;
            debug(reply.text);
            return;
        }
        reply.text = result + '\n' + texts.QuizStarted1;
        //TODO decide of a dedicated quiz channel is needed (private & payed enterance ?)
        //                    reply.text += QuizStarted2 + self.OPTIONS.QuizChannel.name + QuizStarted3;
        debug(reply.text);
        return;
    });
}

function askQuestion(quiz, userName) {
    quiz.askQuestion(userName, (done, question) => {
        debug(question);
    });
}

function recordAnswer(quiz, answer, username, cb) {
    quiz.recordAnswer(username, answer, (err, done) => cb(err, done));
}

function score(quiz) {
    quiz.calcScore((results) => {
        _.forEach(results, (score, username) => {
            debug(username +' scored ' + score);
        });
    });
}

