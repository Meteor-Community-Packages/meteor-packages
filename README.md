# Meteor Package Server Sync

A client for [Meteor Package Server API](https://github.com/meteor/meteor/wiki/Meteor-Package-Server-API).

Creates and syncs all data about packages to local MongoDB collections and keeps them in sync.

- [Meteor Package Server Sync](#meteor-package-server-sync)
  - [Code Quality](#code-quality)
  - [Installation](#installation)
  - [Usage](#usage)

## Code Quality

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

This project has been setup with eslint, prettier and editorconfig configurations to ensure clean, consistent, error free code.

## Installation

```sh
meteor add peerlibrary:meteor-packages
```

## Usage

On the server-side, you initialize it like this:

```javascript
import { Meteor } from "meteor/meteor";
import { PackageServer } from "meteor/peerlibrary:meteor-packages";

Meteor.startup(function() {
  PackageServer.startSyncing();
});
```

Initial syncing might take quite some time.

Then you can access collections:

- `PackageServer.Packages`
- `PackageServer.Versions`
- `PackageServer.Builds`
- `PackageServer.ReleaseTracks`
- `PackageServer.ReleaseVersions`
- `PackageServer.LatestPackages`

`LatestPackages` collection is the same as `Versions`, only that it contains only the latest versions of packages.

Schema of documents is the same as [described in the documentation](https://github.com/meteor/meteor/wiki/Meteor-Package-Server-API)
with one exception: in `Versions` collection, `dependencies` field is represented as an array of objects where package
name is stored as `packageName` key. This is to support package names with `.` in the name without any problems.
