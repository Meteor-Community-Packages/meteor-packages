# Meteor Package Server Sync

A client for [Meteor Package Server API](https://github.com/meteor/meteor/wiki/Meteor-Package-Server-API).

Creates and syncs all data about packages to local MongoDB collections and keeps them in sync.

- [Code Quality](#code-quality)
- [Installation](#installation)
- [Usage](#usage)
- [Types](#types)

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
  PackageServer.startSyncing({
    //options - the following are the defaults if not passed
    logging: false, // When true, informational log messages will be printed to the console
    sync: {
      builds: true, // Should information about package builds be stored
      releases: true, // Should information about Meteor releases and release tracks be stored
      stats: true, // Should package stats be fetched and stored
    }
  });
});
```

Initial syncing might take quite some time.

Then on the server you can register code that will only run after the initial data sync has completed with `PackageServer.runIfSyncFinished` . For example it will run directly after the sync completes, and then again subsequently at starup when `PackageServer.startSyncing()` is called. This allows you add things such as collection-hooks that shouldn't run while the initial sync is happening.

```js
import { Meteor } from "meteor/meteor";
import { PackageServer } from "meteor/peerlibrary:meteor-packages";

PackageServer.runIfSyncFinished(() => {
  PackageServer.ReleaseVersions.after.insert((userId, doc) => {
    Feed.addEvent('Meteor Release', doc.version);
  })
});
```

The following collections can be accessed on the server or client. For the client you'll of course need to publish the necessary data.

- `PackageServer.Packages`
- `PackageServer.Versions`
- `PackageServer.Builds`
- `PackageServer.ReleaseTracks`
- `PackageServer.ReleaseVersions`
- `PackageServer.LatestPackages`
- `PackageServer.Stats`

> `LatestPackages` collection is the same as `Versions`, except that it contains only the latest versions of packages.

Schema of documents is the same as [described in the documentation](https://github.com/meteor/meteor/wiki/Meteor-Package-Server-API)
with a couple exceptions.

1. `Versions` collection's `dependencies` field is represented as an array of objects where package
name is stored as `packageName` key. This is to support package names with `.` in the name without any problems.

2. `Packages` collection will contain 2 additional fields, `directAdds`, and `totalAdds` which are the direct and total install counts for the corresponding package.

3. `Stats` collection adds the date field to the document for ease of querying chronologically.

## Types

While this package isn't currently implemented in Typescript, there are type definitions provided for your convenience in the typings.d.ts file in the root of this project.
