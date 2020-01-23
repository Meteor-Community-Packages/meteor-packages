/* global Package */
Package.describe({
  name: 'peerlibrary:meteor-packages',
  summary: 'Client for Meteor Package Server API',
  version: '1.0.0',
  git: 'https://github.com/Meteor-Community-Packages/meteor-packages.git',
});

Package.onUse(function (api) {
  api.versionsFrom('1.6');
  api.use(['ecmascript', 'http', 'random', 'mongo', 'ddp', 'underscore', 'package-version-parser']);
  api.mainModule('client.js', 'client');
  api.mainModule('server.js', 'server');
});
