/* global Package Npm */
Package.describe({
  name: 'communitypackages:package-server-sync',
  summary: 'Client for Meteor Package Server API',
  version: '1.0.0',
  git: 'https://github.com/communitypackages/package-server-sync.git',
});

Npm.depends({
  assert: '1.4.1',
});

Package.onUse(function (api) {
  api.versionsFrom('1.6');
  api.use(['ecmascript', 'mongo', 'ddp', 'underscore', 'package-version-parser']);
  api.mainModule('client.js', 'client');
  api.mainModule('server.js', 'server');
});
