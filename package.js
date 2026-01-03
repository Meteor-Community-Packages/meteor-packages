/* global Package */
Package.describe({
  name: 'peerlibrary:meteor-packages',
  summary: 'Client for Meteor Package Server API',
  version: '3.1.0',
  git: 'https://github.com/Meteor-Community-Packages/meteor-packages.git',
});

Package.onUse(function (api) {
  api.versionsFrom('3.0');
  api.use(['ecmascript', 'fetch', 'random', 'mongo', 'ddp', 'package-version-parser']);
  api.mainModule('client.js', 'client');
  api.mainModule('server.js', 'server');
});

Package.onTest(function (api) {
  api.versionsFrom('3.0');
  api.use('ecmascript');
  api.use('mongo');
  api.use('random');
  api.use('fetch');
  api.use('tinytest');
  api.use('peerlibrary:meteor-packages');
  api.mainModule('server.tests.js', 'server');
});
