// isic-paper-upload

// Modules
var config = require('config');
var formidable = require('formidable');
var dropbox = require('dropbox');
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
    passwordHash: ''
  }
};

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

// Actions
app.get('/', function handleGet(req, res, next) {
  // Display login form
  res.render('login', { csrf: req.csrfToken() });
});
app.post('/', function handlePost(req, res, next) {
  // Display upload interface
  var loginErr = false;
  var alreadyUploaded = false;

  if (loginErr) {
    res.render('login', { csrf: req.csrfToken() });
  }
  else {
    if (alreadyUploaded) {
      res.render('upload');
    }
    else {
      res.render('index');
    }
  }
});
app.post('/upload', function handleUpload(req, res, next) {
  // Display post-upload interface
  var uploadErr = false;

  if (uploadErr) {
    res.render('index', { error: uploadErr });
  }
  else {
    res.render('upload', { justUploaded: true });
  }
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