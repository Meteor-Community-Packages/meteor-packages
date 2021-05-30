/* global Package */
Package.describe({
  name: 'peerlibrary:meteor-packages',
  summary: 'Client for Meteor Package Server API',
  version: '2.1.2',
  git: 'https://github.com/Meteor-Community-Packages/meteor-packages.git',
});

Package.onUse(function (api) {
  api.versionsFrom('1.8');
  api.use(['ecmascript', 'fetch', 'random', 'mongo', 'ddp', 'underscore', 'package-version-parser']);
  api.use('matb33:collection-hooks@0.8.0 || 1.0.0');
  api.mainModule('client.js', 'client');
  api.mainModule('server.js', 'server');
});
