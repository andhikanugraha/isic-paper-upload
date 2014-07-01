// isic-paper-upload

// Modules
var path = require('path');
var config = require('config');
var moment = require('moment-timezone');
var formidable = require('formidable');
var sha1 = require('sha1');
var fse = require('fs-extra');
var express = require('express');
var morgan = require('morgan');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var methodOverride = require('method-override');
var serveStatic = require('serve-static');
var errorHandler = require('errorhandler');
var csurf = require('csurf');
var hbs = require('hbs');
var lessMiddleware = require('less-middleware');

// User data
var users = require('./users');

// User functions
function checkUserAuth(paperId, email, password) {
  var user = findUser(email, paperId);
  if (!user) {
    return false;
  }

  var salt = user.salt;
  var saltedPassword = '' + salt + password;
  var saltedPasswordHash = sha1(saltedPassword);

  return user.passwordHash === saltedPasswordHash;
}

function filenameSafe(text) {
  return text.replace(/[^a-zA-Z0-9 \-]/g, '');
}

function getSubmissionDirName(user) {
  if (!user) {
    return undefined;
  }

  return filenameSafe(user.name) + ' - ' +
         filenameSafe(user.paperId) + ' - ' +
         filenameSafe(user.paperTitle);
}

// Shared functions
function validateFile(file) {
  if (file.size > config.maxFileSize) {
    return false;
  }

  var lastDot = file.name.lastIndexOf('.');
  var extension = file.name.substring(lastDot + 1);
  if (config.allowedExtensions.indexOf(extension) === -1) {
    return false;
  }

  return true;
}

function findUser(email, paperId) {
  var foundUser;
  users.forEach(function(user) {
    if (foundUser) {
      return;
    }

    if (user.email.toLowerCase() === email.toLowerCase() &&
        parseInt(user.paperId) === parseInt(paperId)) {
      foundUser = user;
    }
  });

  return foundUser;
}

// Config initialisation
if (!config.port) {
  config.port = process.env.PORT || 3000;
}
if (config.redis) {
  var redis = require('redis');
  var RedisStore = require('connect-redis')(session);
  var redisClient;
  if (config.redis.host && config.redis.port) {
    redisClient = redis.createClient(config.redis.port, config.redis.host);
  }
  else {
    redisClient = redis.createClient();
  }
  var redisSessionStore = new RedisStore({ client: redisClient });
}

// Express initialisation
var app = express();
module.exports = app;

// View engine setup
app.set('views', __dirname + '/views');
app.set('view engine', 'hbs');
app.set('view options', {layout: 'layouts/main'});

// Middleware setup
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  store: config.redis ? redisSessionStore : undefined,
  secret: config.secret,
  proxy: true,
  resave: true,
  saveUninitialized: true
}));

app.use(csurf());
app.use(function handleInvalidCsrf(err, req, res, next) {
  if (err) {
    res.redirect('/?error=csrf');
  }
});

app.use(methodOverride());
app.use('/css', lessMiddleware(
  __dirname + '/less',
  { dest: __dirname + '/public/css' },
  {},
  { compress: (app.get('env') != 'development') }
));
app.use(serveStatic(__dirname + '/public'));

// Custom middleware
function requireAuth(req, res, next) {
  if (!req.session.email || !req.session.paperId) {
    res.redirect('/?error=unauth');
  }
  else {
    req.user = findUser(req.session.email, req.session.paperId);
    next();
  }
}

// Actions
app.get('/favicon.ico', function(req, res, next) {
  res.redirect('http://static.wixstatic.com/ficons/' +
               '89355b_8adb1bc8d31a9b11a84eec6107dc1b89_fi.ico');
});

app.get('/', function login(req, res, next) {
  // Display login form
  req.session.email = undefined;

  if (req.query.error) {
    res.statusCode = 403; // Forbidden
  }

  res.render('login', {
    csrf: req.csrfToken(),
    noauth: req.query.error === 'noauth',
    invalidAuth: req.query.error === 'invalid_auth',
    invalidCsrf: req.query.error === 'csrf',
    lastEmail: req.session.lastEmail
  });
});

app.post('/', function handleLogin(req, res, next) {
  // Display upload interface
  var paperId = parseInt(req.body.paperId);
  var email = req.body.email.toLowerCase();
  var password = req.body.password;

  req.session.lastPaperId = req.body.paperId;
  req.session.lastEmail = req.body.email;

  if (checkUserAuth(paperId, email, password)) {
    req.session.paperId = paperId;
    req.session.email = email;
    req.session.lastEmail = undefined;
    return res.redirect('/upload');
  }

  res.redirect('/?error=invalid_auth');
});

app.get('/upload', requireAuth, function index(req, res, next) {
  var userDirName = getSubmissionDirName(req.user);

  var params = {
    user: req.user,
    csrf: req.csrfToken(),
    safeCsrf: encodeURIComponent(req.csrfToken())
  };

  var error = req.query.error;

  if (error === 'confirmed') {
    res.statusCode = 403; // Forbidden
    params.confirmed = true;
  }
  else if (error === 'no_file') {
    res.statusCode = 415; // Unsupported Media Type
    params.noFile = true;
  }
  else if (error === 'invalid') {
    res.statusCode = 415; // Unsupported Media Type
    params.invalid = true;
  }
  else if (error === 'incomplete') {
    params.incomplete = true;
  }
  else if (error) {
    params.error = error;
  }

  var message = req.query.message;
  if (message === 'uploaded') {
    params.justUploaded = true;
  }
  else if (message === 'confirmed') {
    params.justConfirmed = true;
  }
  else if (message) {
    params.message = message;
  }

  var dirName = getSubmissionDirName(req.user);
  var alreadyUploaded = fse.existsSync(config.uploadDir + '/' + dirName);  

  if (alreadyUploaded) {
    params.alreadyUploaded = true;

    var stats = fse.statSync(config.uploadDir + '/' + dirName);
    var lastSubmission =
      moment(stats.mtime).tz('Europe/London')
                         .format('D MMMM YYYY, HH:mm:ss [UTC]Z');
    params.lastSubmission = lastSubmission;

    if (fse.existsSync(config.uploadDir + '/' + dirName + '/confirmed.txt')) {
      params.alreadyConfirmed = true;
    }
  }
  else {
    params.alreadyUploaded = false;
  }

  var isoDate = moment().tz('Europe/London').format('YYYY-MM-DD[T]HH:mm:ss');
  params.isoDate = isoDate;

  var nowDate = moment().tz('Europe/London')
                  .format('D MMMM YYYY, HH:mm:ss [UTC]Z');
  params.currentDateTime = nowDate;

  var deadlineDate = moment(config.deadline).tz('Europe/London')
                       .format('D MMMM YYYY, HH:mm:ss [UTC]Z');
  params.deadlineDate = deadlineDate;

  if (moment().isAfter(config.deadline)) {
    params.overdue = true;
  }

  res.render('index', params);
});

app.post('/upload', requireAuth, function handleUpload(req, res, next) {
  function render(err) {
    if (err) {
      return res.redirect('/upload?error=' + err);
    }

    res.redirect('/upload?message=uploaded');
  }

  var newDirName = getSubmissionDirName(req.user);
  if (fse.existsSync(config.uploadDir + '/' + newDirName + '/confirmed.txt')) {
    return render('confirmed');
  }

  var form = new formidable.IncomingForm();
  form.parse(req, function(err, fields, files) {
    if (!fields.agree) {
      return render('incomplete');
    }

    var file = files.file;
    if (!file) {
      return render('no_file');
    }

    if (!validateFile(file)) {
      return render('invalid');
    }

    // Create a new file name using the author's name and paper title
    var lastDot = file.name.lastIndexOf('.');
    var newFileName = newDirName + file.name.substring(lastDot);

    try {
      config.allowedExtensions.forEach(function(ext) {
        fse.removeSync(config.uploadDir + '/' + newDirName + '/' +
                       newDirName + '.' + ext);
      });
    }
    catch (e) {

    }

    fse.copy(file.path, config.uploadDir + '/' + newDirName + '/' + newFileName,
      function(err) {
        if (err) {
          return render(err);
        }

        render();
      });
  });
});

app.get('/review', requireAuth, function review(req, res, next) {
  var newDirName = getSubmissionDirName(req.user);
  var foundFilename;
  try {
    config.allowedExtensions.forEach(function(ext) {
      var filename = config.uploadDir + '/' + newDirName + '/' +
                     newDirName + '.' + ext;
      if (fse.existsSync(filename)) {
        foundFilename = filename;
      }
    });
  }
  catch (e) {

  }

  var basename = path.basename(foundFilename);
  res.setHeader('Content-disposition',
                'attachment; filename="' + basename + '"');

  res.sendfile(path.resolve(foundFilename));
});

app.post('/confirm', requireAuth, function confirm(req, res, next) {
  var newDirName = getSubmissionDirName(req.user);
  var filename = config.uploadDir + '/' + newDirName + '/confirmed.txt';
  var nowDate = moment().tz('Europe/London')
                        .format('D MMMM YYYY, HH:mm:ss [UTC]Z');
  var body = req.user.name + ' confirmed her/his submission on ' +
             nowDate + '.';
  fse.outputFile(filename, body, function(err) {
    if (err) {
      return res.redirect('/upload?error=confirm_fail');
    }

    return res.redirect('/upload?message=confirmed');
  });
});

app.use(function(req, res, next) {
  res.statusCode = 404;
  res.render('error',
             { error: 'The page you are looking for cannot be found.' });
});

// Error handling
if (app.get('env') == 'development') {
  app.use(errorHandler({
    dumpExceptions: true,
    showStack: true
  }));
}
else {
  app.use(function handleError(err, req, res, next) {
    res.statusCode = err.status || 500;
    res.render('error', { error: err.toString() });
  });
}

app.listen(config.port, function() {
  console.log('Express listening to port ' + config.port);
});