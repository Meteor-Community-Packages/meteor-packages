Package.describe({
  name: 'peerlibrary:meteor-packages',
  summary: "Client for Meteor Package Server API",
  version: '0.1.0',
  git: 'https://github.com/peerlibrary/meteor-packages.git'
});

Package.onUse(function (api) {
  api.versionsFrom('METEOR@1.0.3.1');

  // Core dependencies.
  api.use([
    'coffeescript',
    'mongo',
    'ddp-client',
    'underscore',
    'package-version-parser'
  ]);

  // 3rd party dependencies.
  api.use([
    'peerlibrary:assert@0.2.5'
  ]);

  api.export('MeteorPackages');

  api.addFiles([
    'lib.coffee'
  ]);

  api.addFiles([
    'server.coffee'
  ], 'server');
});
