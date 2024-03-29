import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { DDP } from 'meteor/ddp';
import { Random } from 'meteor/random';
import { PackageVersion } from 'meteor/package-version-parser';
import { fetch } from 'meteor/fetch';

import Fiber from 'fibers';

import { PackageServer } from './package-server';

let loggingEnabled;
let syncOptions;

const SYNC_TOKEN_ID = 'syncToken';
const STATS_SYNC_ID = 'statsSync';
const FULL_SYNC_ID = 'fullSync';
const LATEST_PACKAGES_ID = 'latestPackages';
const URL = 'https://packages.meteor.com';

PackageServer.Packages._ensureIndex({
  name: 1,
});
PackageServer.Stats._ensureIndex({
  name: 1,
});
PackageServer.Versions._ensureIndex({
  packageName: 1,
});
PackageServer.Versions._ensureIndex({
  'dependencies.packageName': 1,
});
PackageServer.Versions._ensureIndex({
  published: 1,
});
PackageServer.Versions._ensureIndex({
  lastUpdated: 1,
});
PackageServer.Versions._ensureIndex({
  'publishedBy.username': 1,
});

PackageServer.LatestPackages._ensureIndex({
  packageName: 1,
});
PackageServer.LatestPackages._ensureIndex({
  'dependencies.packageName': 1,
});
PackageServer.LatestPackages._ensureIndex({
  published: 1,
});
PackageServer.LatestPackages._ensureIndex({
  lastUpdated: 1,
});
PackageServer.LatestPackages._ensureIndex({
  'publishedBy.username': 1,
});

PackageServer.rawStats = PackageServer.Stats.rawCollection();
PackageServer.rawPackages = PackageServer.Packages.rawCollection();
PackageServer.rawLatestPackages = PackageServer.LatestPackages.rawCollection();
PackageServer.rawVersions = PackageServer.Versions.rawCollection();

const callbacks = [];

const runCallbacks = () => {
  Meteor.startup(() => {
    let cb;
    while ((cb = callbacks.shift())) {
      cb();
    }
  });
};

const shouldBypassCollection2 = (collection) => {
  return collection._c2 ? { bypassCollection2: true } : undefined;
};

// Version documents provided from Meteor API can contain dots in object keys which
// is not allowed by MongoDB, so we transform document to a version without them.
const transformVersionDocument = (document) => {
  if (document.dependencies) {
    document.dependencies = (() => {
      const result = [];
      for (let packageName in document.dependencies) {
        const dependency = document.dependencies[packageName];
        result.push(Object.assign(dependency, { packageName }));
      }
      return result;
    })();
  }

  return document;
};

const isTokenNewer = (previousToken, nextToken) => {
  return Object.keys(nextToken).some((key) => {
    return nextToken[key] !== previousToken[key];
  });
};

let busy = false;

const syncPackages = () => {
  if (!busy) {
    busy = true;
    const connection = getServerConnection();
    let { syncToken } = PackageServer.SyncState.findOne(SYNC_TOKEN_ID);

    while (true) {
      var error, insertedId, numberAffected;

      const result = connection.call('syncNewPackageData', syncToken);
      if (!isTokenNewer(syncToken, result.syncToken)) {
        busy = false;
        break;
      }

      syncToken = result.syncToken;

      loggingEnabled && console.log('Running packages sync for:', syncToken);

      if (isSyncCompleted() && result.resetData) {
        PackageServer.Packages.remove({});
        PackageServer.Versions.remove({});
        PackageServer.Builds.remove({});
        PackageServer.ReleaseTracks.remove({});
        PackageServer.ReleaseVersions.remove({});
        PackageServer.LatestPackages.remove({});
        PackageServer.Stats.remove({});
        PackageServer.SyncState.remove({});
      }

      let newPackages = 0;
      let updatedPackages = 0;

      const packageRecords = (result.collections && result.collections.packages) || [];
      const bypassPackagesC2 = shouldBypassCollection2(PackageServer.Packages);

      packageRecords.forEach(packageRecord => {
        try {
          ({ numberAffected, insertedId } = PackageServer.Packages.upsert(packageRecord._id, { $set: packageRecord }, bypassPackagesC2));
          if (insertedId && insertedId === packageRecord._id) {
            newPackages++;
            updatedPackages += numberAffected - 1;
          } else {
            updatedPackages += numberAffected;
          }
        } catch (error1) {
          error = error1;
          console.log(error, packageRecord);
        }
      });

      let newVersions = 0;
      let updatedVersions = 0;

      const versions = (result.collections && result.collections.versions) || [];
      const bypassVersionsC2 = shouldBypassCollection2(PackageServer.Versions);

      versions.forEach(version => {
        try {
          version = transformVersionDocument(version);
          ({ numberAffected, insertedId } = PackageServer.Versions.upsert(version._id, version, bypassVersionsC2));
          if (insertedId) {
            newVersions++;
            updatedVersions += numberAffected - 1;
          } else {
            updatedVersions += numberAffected;
          }
        } catch (error2) {
          error = error2;
          console.log(error, version);
        }
      });

      let newBuilds = 0;
      let updatedBuilds = 0;

      const builds = (result.collections && result.collections.builds) || [];
      const bypassBuildsC2 = shouldBypassCollection2(PackageServer.Builds);

      syncOptions.builds && builds.forEach(build => {
        try {
          ({ numberAffected, insertedId } = PackageServer.Builds.upsert(build._id, build, bypassBuildsC2));
          if (insertedId) {
            newBuilds++;
            updatedBuilds += numberAffected - 1;
          } else {
            updatedBuilds += numberAffected;
          }
        } catch (error3) {
          error = error3;
          console.log(error, build);
        }
      });

      let newReleaseTracks = 0;
      let updatedReleaseTracks = 0;

      const releaseTracks = (result.collections && result.collections.releaseTracks) || [];
      const bypassReleaseTracksC2 = shouldBypassCollection2(PackageServer.ReleaseTracks);

      syncOptions.releases && releaseTracks.forEach(releaseTrack => {
        try {
          ({ numberAffected, insertedId } = PackageServer.ReleaseTracks.upsert(releaseTrack._id, releaseTrack, bypassReleaseTracksC2));
          if (insertedId) {
            newReleaseTracks++;
            updatedReleaseTracks += numberAffected - 1;
          } else {
            updatedReleaseTracks += numberAffected;
          }
        } catch (error4) {
          error = error4;
          console.log(error, releaseTrack);
        }
      });

      let newReleaseVersions = 0;
      let updatedReleaseVersions = 0;

      const releaseVersions = (result.collections && result.collections.releaseVersions) || [];
      const bypassReleaseVersionsC2 = shouldBypassCollection2(PackageServer.ReleaseVersions);

      syncOptions.releases && releaseVersions.forEach(releaseVersion => {
        try {
          ({ numberAffected, insertedId } = PackageServer.ReleaseVersions.upsert(releaseVersion._id, releaseVersion, bypassReleaseVersionsC2));
          if (insertedId) {
            newReleaseVersions++;
            updatedReleaseVersions += numberAffected - 1;
          } else {
            updatedReleaseVersions += numberAffected;
          }
        } catch (error5) {
          error = error5;
          console.log(error, releaseVersion);
        }
      });

      if (loggingEnabled) {
        if (newPackages || updatedPackages) {
          console.log(
            `PackageServer.Packages - all: ${PackageServer.Packages.find().count()}, new: ${newPackages}, updated: ${updatedPackages}`
          );
        }
        if (newVersions || updatedVersions) {
          console.log(
            `PackageServer.Versions - all: ${PackageServer.Versions.find().count()}, new: ${newVersions}, updated: ${updatedVersions}`
          );
        }
        if (newBuilds || updatedBuilds) {
          console.log(
            `PackageServer.Builds - all: ${PackageServer.Builds.find().count()}, new: ${newBuilds}, updated: ${updatedBuilds}`
          );
        }
        if (newReleaseTracks || updatedReleaseTracks) {
          console.log(
            `PackageServer.ReleaseTracks - all: ${PackageServer.ReleaseTracks.find().count()}, new: ${newReleaseTracks}, updated: ${updatedReleaseTracks}`
          );
        }
        if (newReleaseVersions || updatedReleaseVersions) {
          console.log(
            `PackageServer.ReleaseVersions - all: ${PackageServer.ReleaseVersions.find().count()}, new: ${newReleaseVersions}, updated: ${updatedReleaseVersions}`
          );
        }
      }

      // We store the new token only after all data in the result has been processed. PackageServer assures
      // that if this run has been prematurely terminated, we restart again correctly next time.
      PackageServer.SyncState.update(
        { _id: SYNC_TOKEN_ID },
        {
          $set: {
            syncToken: result.syncToken,
          },
        }
      );

      if (result.upToDate) {
        loggingEnabled && console.log('Finished Syncing Packages');
        if (!isSyncCompleted()) {
          setSyncCompleted();
          deriveLatestPackagesFromVersions();
          syncStats();
        }
        break;
      }
    }

    setTimeout(() => { busy = false; }, 1000);
  }
};

let syncCompleted = false;
const isSyncCompleted = () => {
  return syncCompleted || !!PackageServer.SyncState.findOne(FULL_SYNC_ID);
};

const setSyncCompleted = () => {
  syncCompleted = true;
  const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
  PackageServer.SyncState.upsert({ _id: FULL_SYNC_ID }, { complete: true }, bypassC2);
};

const syncStats = async () => {
  if (!syncOptions.stats) return;

  const { current, latest } = PackageServer.SyncState.findOne({ _id: STATS_SYNC_ID });

  if (current < latest) {
    // We update current using it's setDate method.
    // eslint complains for lack of explicit update so we disable it for the next line
    while (current <= latest) { // eslint-disable-line
      let statsBatch = PackageServer.rawStats.initializeOrderedBulkOp();
      let packagesBatch = PackageServer.rawPackages.initializeOrderedBulkOp();
      const dateString = `${current.getFullYear()}-${(current.getMonth() + 1).toString().padStart(2, 0)}-${current.getDate().toString().padStart(2, 0)}`;
      loggingEnabled && console.log('Syncing Stats For ', dateString);
      const statsUrl = `${URL}/stats/v1/${dateString}`;
      const response = await fetch(statsUrl);

      if (response.status === 200) {
        const text = await response.text();
        const content = text.trim();
        let stats = content.length ? content.split('\n') : [];

        // stats is an array of strings because someone at MDG forgot JSON exists.
        // Therefor we need to loop and parse each string
        if (stats.length) {
          stats.forEach(statDoc => {
            let doc = JSON.parse(statDoc);
            const { name, totalAdds, directAdds } = doc;
            doc._id = Random.id();
            doc.date = current;
            statsBatch.insert(doc);
            packagesBatch.find({ name }).update({ $inc: { totalAdds, directAdds } });
          });
          await statsBatch.execute();
          await packagesBatch.execute();
        }
      }

      // update the last date of packages stats that we have processed
      PackageServer.SyncState.update(
        { _id: STATS_SYNC_ID },
        { $set: { current } },
      );

      // update the current date to the next day so we eventually break out
      current.setDate(current.getDate() + 1);
    }
  }
  loggingEnabled && console.log('Full Sync Finished');
};

const fieldsToModifier = (fields) => {
  const modifier = {};

  for (let name in fields) {
    const value = fields[name];
    if (value === undefined) {
      if (!modifier.$unset) {
        modifier.$unset = {};
      }
      modifier.$unset[name] = '';
    } else {
      if (!modifier.$set) {
        modifier.$set = {};
      }
      modifier.$set[name] = value;
    }
  }

  return modifier;
};

let packagesFound = false;

const latestPackagesCompleted = () => {
  return packagesFound || PackageServer.SyncState.findOne(LATEST_PACKAGES_ID);
};

const setLatestPackagesCompleted = () => {
  const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
  PackageServer.SyncState.upsert({ _id: LATEST_PACKAGES_ID }, { complete: true }, bypassC2);
  runCallbacks();
};

const deriveLatestPackagesFromVersions = async () => {
  loggingEnabled && console.log('Deriving Latest Packages');
  const packageNames = await PackageServer.rawVersions.distinct('packageName');
  const bulk = PackageServer.rawLatestPackages.initializeUnorderedBulkOp();

  packageNames.forEach((packageName, index) => {
    const latestVersion = determineLatestPackageVersion(packageName);
    bulk.insert(latestVersion);
  });

  try {
    await bulk.execute();
  } catch (error) {
    console.log(error);
  }

  setLatestPackagesCompleted();
  loggingEnabled && console.log('Deriving Latest Packages Done');
};

const determineLatestPackageVersion = (packageName) => {
  let newestPackage;
  PackageServer.Versions.find({ packageName }).forEach(document => {
    if (!newestPackage || PackageVersion.lessThan(newestPackage.version, document.version)) {
      newestPackage = document;
    }
  });
  return newestPackage;
};

const setLatestPackageFromVersion = (packageName) => {
  const existingDocument = PackageServer.LatestPackages.findOne({ packageName }, { sort: { published: -1 } });
  const newestPackage = determineLatestPackageVersion(packageName);
  const bypassC2 = shouldBypassCollection2(PackageServer.LatestPackages);

  if (!existingDocument) {
    loggingEnabled && console.log(`Latest Package for ${packageName} set to ${newestPackage.version}`);
    PackageServer.LatestPackages.insert(newestPackage, bypassC2);
  } else if (newestPackage && existingDocument._id !== newestPackage._id) {
    loggingEnabled && console.log(`Latest Package for ${packageName} changed from ${existingDocument.version} to ${newestPackage.version}`);
    PackageServer.LatestPackages.remove({ packageName });
    PackageServer.LatestPackages.insert(newestPackage, bypassC2);
  };
};

let connection = null;
const getServerConnection = () => {
  if (!connection) {
    connection = DDP.connect(URL);
  }
  return connection;
};

const subscribeToPackages = () => {
  loggingEnabled && console.log('Starting all packages subscription');

  const connection = getServerConnection();

  const Defaults = new Mongo.Collection('defaults', connection);
  const Changes = new Mongo.Collection('changes', connection);

  connection.subscribe('defaults', () => {
    const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
    PackageServer.SyncState.upsert(
      { _id: SYNC_TOKEN_ID },
      {
        $setOnInsert: {
          syncToken: Defaults.findOne().syncToken,
        },
      },
      bypassC2
    );

    connection.subscribe('changes', () => {
      return Changes.find({}).observe({
        added: document => {
          return syncPackages();
        },
        changed: (document, oldDocument) => {
          return syncPackages();
        },
      });
    });

    loggingEnabled && console.log('All packages subscription initialized');
  });
};

const subscribeToStats = () => {
  loggingEnabled && console.log('Starting Stats Subscription');

  const connection = getServerConnection();
  const Stats = new Mongo.Collection('stats', connection);

  connection.subscribe('stats', () => {
    Stats.find({}).observe({
      added: document => {
        const { earliest, latest } = document;
        const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
        PackageServer.SyncState.upsert(
          { _id: STATS_SYNC_ID },
          {
            $set: {
              latest: new Date(latest.replace('-', '/')),
            },
            $setOnInsert: {
              current: new Date(earliest.replace('-', '/')),
            },
          },
          bypassC2
        );
        if (isSyncCompleted()) {
          syncStats();
        }
      },

      changed: document => {
        const { latest } = document;
        PackageServer.SyncState.update(
          { _id: STATS_SYNC_ID },
          { $set: { latest: new Date(latest.replace('-', '/')) } }
        );
        syncStats();
      },
    });
  });
};

PackageServer.runIfSyncFinished = (callback) => {
  typeof callback === 'function' && callbacks.push(callback);
};

PackageServer.startSyncing = function ({ logging = false, sync: { builds = true, releases = true, stats = true } = {} } = {}) {
  loggingEnabled = logging;
  syncOptions = { builds, releases, stats };

  new Fiber(async () => {
    stats && subscribeToStats();
    subscribeToPackages();

    if (latestPackagesCompleted()) {
      runCallbacks();
    }
  }).run();
};

PackageServer.runIfSyncFinished(() => {
  PackageServer.Versions.after.insert(function (userId, doc) {
    setLatestPackageFromVersion(doc.packageName);
  });

  PackageServer.Versions.after.update(function (userId, doc) {
    const { id, ...fields } = doc;
    const modifier = fieldsToModifier(fields);
    PackageServer.LatestPackages.update(doc._id, modifier);
  }, { fetchPrevious: false });

  PackageServer.Versions.after.remove(function (userId, doc) {
    const { _id } = doc;
    const oldPackage = PackageServer.LatestPackages.findOne(_id);

    if (oldPackage) {
      PackageServer.LatestPackages.remove(_id);
      const newPackage = determineLatestPackageVersion(oldPackage.packageName);

      if (newPackage) {
        const bypassC2 = shouldBypassCollection2(PackageServer.LatestPackages);
        PackageServer.LatestPackages.insert(newPackage, bypassC2);
      }
    }
  });
});

export { PackageServer, fieldsToModifier };
