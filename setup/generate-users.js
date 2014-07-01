// isic-paper-upload
// User generator

// Generate user credentials, each with a generated password and salt,
// for a given CSV of selected participants.

var stream = require('stream');
var config = require('config');
var _ = require('lodash');
var async = require('async');
var csv = require('csv');
var csvParse = require('csv-parse');
var csvStringify = require('csv-stringify');
var sha1 = require('sha1');
var randomstring = require('randomstring');
var fse = require('fs-extra');
var minimist = require('minimist');
var marked = require('marked');
var handlebars = require('handlebars');
var nodemailer = require('nodemailer');

var EMAIL_SUBJECT = 'ISIC 2014: Upload conference paper';
var DESTINATION_COLS = [
  'name',
  'email',
  'paperTitle',
  'password',
  'salt',
  'passwordHash'
];

function generateUsers(sourceCsv, destinationCsv, destinationJson, callback) {
  parseCsv(sourceCsv, function(err, users) {
    if (err) {
      return callback(err);
    }

    async.parallel([
      writeCsv.bind(undefined, users, destinationCsv),
      writeJson.bind(undefined, users, destinationJson)
    ], function(err) {
      if (err) {
        return callback(err);
      }

      return callback(null, users);
    });
  });
}

function parseCsv(sourceCsv, callback) {
  var users = [];

  var input = fse.createReadStream(sourceCsv);
  var parser = csvParse({ columns: true });

  var row;
  parser.on('readable', function() {
    row = parser.read();
    while (row) {
      var password = randomstring.generate(10);
      var salt = randomstring.generate(30);
      var passwordHash = sha1(salt + password);

      var user = {
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        name: row.name,
        paperTitle: row.paperTitle,
        paperId: row.paperId || 0,
        password: password,
        salt: salt,
        passwordHash: passwordHash
      };

      users.push(user);
      row = parser.read();
    }
  });

  parser.on('error', function(err) {
    callback(err);
  });

  parser.on('finish', function() {
    callback(null, users);
  });

  input.pipe(parser);
}

function writeCsv(users, destinationCsv, callback) {
  var output = fse.createWriteStream(destinationCsv);
  var stringifier = csvStringify({ columns: DESTINATION_COLS });

  stringifier.on('finish', callback);

  stringifier.pipe(output);

  output.write(DESTINATION_COLS.join(',') + '\n');
  _.forEach(users, function(user) {
    stringifier.write(user);
  });
  stringifier.end();
}

function writeJson(users, destinationJson, callback) {
  var jsonToWrite = [];
  _.forEach(users, function(user) {
    jsonToWrite.push({
      email: user.email,
      name: user.name,
      paperId: user.paperId,
      paperTitle: user.paperTitle,
      passwordHash: user.passwordHash,
      salt: user.salt
    });
  });
  fse.outputFile(destinationJson,
    JSON.stringify(jsonToWrite, undefined, 2),
    callback);
}

function emailUsers(users, callback) {
  if (!config.nodemailer) {
    return false;
  }

  var transport = nodemailer.createTransport(
    config.nodemailer.transport,
    config.nodemailer.transportOptions
  );

  var i = 0;
  var mailQueue = async.queue(function(task, callback) {
    console.log('Sending email #' + (++i));
    transport.sendMail(task, callback);
  }, config.nodemailer.transportOptions.maxConnections || 1);
  mailQueue.drain = function(err) {
    if (err) {
      return callback(err);
    }
    console.log('All emails sent! Closing transport...');
    transport.close();
    mailQueue = undefined;
    callback();
  };

  var templateSource = '' + fse.readFileSync(__dirname + '/emailTemplate.hbs');
  var template = handlebars.compile(templateSource);

  _.forEach(users, function(user) {
    emailUser(user, template, function(task) {
      mailQueue.push(task, function(err) {
        if (err) {
          return console.error('Message could not be sent: %j', err);
        }

        console.log('Message sent to ' + user.email);
      });
    });
  });
}

function emailUser(user, template, sendMail) {
  var from = config.nodemailer.from;
  var subject = EMAIL_SUBJECT;
  var to = user.email;
  var text = template(_.extend({
    url: config.url,
    deadline: '1 August 2014'
  }, user));
  var html = marked(text);

  console.log('Processing email for ' + user.name);
  sendMail({
    from: from,
    to: to,
    subject: subject,
    text: text,
    html: html
  });
}

function main() {
  var argv = require('minimist')(process.argv.slice(2));
  if (_.isEmpty(config)) {
    return console.error('No config detected. Please run from parent dir.');
  }
  if (argv.email && _.isEmpty(config.nodemailer)) {
    return console.error('--email parameter was specified' +
            'but no configuration for nodemailer was detected.');
  }

  console.log('Generating user credentials...');
  generateUsers(
    argv._[0] || __dirname + '/participants.csv',
    argv._[1] || __dirname + '/credentials.csv',
    argv._[2] || __dirname + '/users.json',
    function(err, users) {
      console.log('User credentials generated.');
      if (argv.email) {
        console.log('Emailing users...');
        emailUsers(users, function(err) {
          if (err) {
            return console.error(err);
          }

          return console.log('Emailed participants!');
        });
      }
    });
}

main();