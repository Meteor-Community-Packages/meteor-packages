Meteor Packages
===============

Package which provides a client for [Meteor Package Server API](https://github.com/meteor/meteor/wiki/Meteor-Package-Server-API).

It creates and syncs all data about packages to local MongoDB collections and keeps them in sync.

Adding this package to your Meteor application adds `MeteorPackages` into the scope.

Both client and server side.

Installation
------------

```
meteor add peerlibrary:meteor-packages
```

Usage
-----

On the server-side, you initialize it like this:

```javascript
Meteor.startup(function () {
  MeteorPackages.startSyncing();
});
```

Initial syncing might take quite some time.

Then you can access collections:

 * `MeteorPackages.Packages`
 * `MeteorPackages.Versions`
 * `MeteorPackages.Builds`
 * `MeteorPackages.ReleaseTracks`
 * `MeteorPackages.ReleaseVersions`
 * `MeteorPackages.LatestPackages`

`LatestPackages` collection is the same as `Versions`, only that it contains only the latest versions of packages.

Schema of documents is the same as [described in the documentation](https://github.com/meteor/meteor/wiki/Meteor-Package-Server-API)
with one exception: in `Versions` collection, `dependencies` field is represented as an array of objects where package
name is stored as `packageName` key. This is to support package names with `.` in the name without any problems.
