// isic-paper-upload

// Dropbox OAuth handling tool

// Modules
var util = require('util');
var config = require('config');
var dropbox = require('dropbox');

// Dropbox initialisation
var dropboxClient = new dropbox.Client({
  key: config.dropbox.key,
  secret: config.dropbox.secret
});

// Initialise OAuth driver server
console.log('Initialising OAuth callback server...');
dropboxClient.authDriver(new dropbox.AuthDriver.NodeServer());

// Authenticate Dropbox and fetch token
console.log('Authenticating... (a new browser window will open)');
dropboxClient.authenticate(function(err, client) {
  if (!err) {
    console.log('Authentication success.');
    var credentials = client.credentials();
    console.log('Your OAuth token is: %s', credentials.token);
    process.exit();
  }
  else {
    console.log('Authentication failed.');
    console.log(err);
    process.exit(1);
  }
});