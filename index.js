// isic-paper-upload

// Modules
var config = require('config');
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
var users = {
  'someone@localhost': {
    name: 'John Doe',
    paperTitle: 'An analysis of lorem ipsum',
    passwordHash: '59b3e8d637cf97edbe2384cf59cb7453dfe30789', // password
    salt: 'salt'
  }
};

// User functions
function checkUserAuth(email, password) {
  var user = users[email];
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

function getSubmissionDirName(email) {
  var user = users[email];
  if (!user) {
    return undefined;
  }

  return filenameSafe(user.name) + ' - ' + filenameSafe(user.paperTitle);
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

// Formidable initialisation
var form = new formidable.IncomingForm();

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
app.use(bodyParser());
app.use(cookieParser());
app.use(session({
  store: config.redis ? redisSessionStore : undefined,
  secret: config.secret,
  proxy: true
}));
app.use(csurf());
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
  if (!req.session.email) {
    res.redirect('/?error=unauth');
  }
  else {
    req.user = users[req.session.email];
    req.user.email = req.session.email;
    next();
  }
}

// Actions
app.get('/', function login(req, res, next) {
  // Display login form
  req.session.email = undefined;

  res.render('login', {
    csrf: req.csrfToken(),
    noauth: req.query.error === 'noauth'
  });
});

app.post('/', function handleLogin(req, res, next) {
  // Display upload interface
  var email = req.body.email.toLowerCase();
  var password = req.body.password;

  if (checkUserAuth(email, password)) {
    req.session.email = email;
    res.redirect('/upload');
  }
  else {
    res.render('login', {
      error: 'invalid_auth',
      csrf: req.csrfToken()
    });
  }
});

app.get('/upload', requireAuth, function index(req, res, next) {
  var userDirName = getSubmissionDirName(req.user.email);
  res.render('index', {
    user: req.user,
    csrf: req.csrfToken(),
    safeCsrf: encodeURIComponent(req.csrfToken())
  });
});

app.post('/upload', requireAuth, function handleUpload(req, res, next) {
  function uploadError(err) {
    console.log(err);
    var params = {
      user: req.user,
      csrf: req.csrfToken(),
      safeCsrf: encodeURIComponent(req.csrfToken())
    };

    if (err === 'no_file') {
      params.noFile = true;
    }
    else if (err === 'invalid') {
      params.invalid = true;
    }
    else {
      params.error = err;
    }

    res.render('index', params);
  }

  form.parse(req, function(err, fields, files) {
    var file = files.file;
    if (!file) {
      return uploadError('no_file');
    }

    if (!validateFile(file)) {
      return uploadError('invalid');
    }

    // Create a new file name using the author's name and paper title
    var lastDot = file.name.lastIndexOf('.');
    var newDirName = getSubmissionDirName(req.user.email);
    var newFileName = newDirName + file.name.substring(lastDot);

    fse.copy(file.path, config.uploadDir + '/' + newDirName + '/' + newFileName,
      function(err) {
        if (err) {
          return uploadError(err);
        }

        return res.render('upload', { justUploaded: true });
      });
  });
});

// Error handler
if (app.get('env') == 'development') {
  app.use(errorHandler({
    dumpExceptions: true,
    showStack: true
  }));
}
else {
  app.use(function handleError(req, res, next, err) {
    res.send('Oops!');
  });
}

app.listen(config.port, function() {
  console.log('Express listening to port ' + config.port);
});