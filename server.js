import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { DDP } from 'meteor/ddp';
import { Random } from 'meteor/random';
import { PackageVersion } from 'meteor/package-version-parser';
import { fetch } from 'meteor/fetch';

import { PackageServer } from './package-server';

let loggingEnabled;
let syncOptions;

const SYNC_TOKEN_ID = 'syncToken';
const STATS_SYNC_ID = 'statsSync';
const FULL_SYNC_ID = 'fullSync';
const LATEST_PACKAGES_ID = 'latestPackages';
const URL = 'https://packages.meteor.com';

// Initialize indexes asynchronously
const initIndexes = async () => {
  await PackageServer.Packages.createIndexAsync({ name: 1 });
  await PackageServer.Stats.createIndexAsync({ name: 1 });
  await PackageServer.Versions.createIndexAsync({ packageName: 1 });
  await PackageServer.Versions.createIndexAsync({ 'dependencies.packageName': 1 });
  await PackageServer.Versions.createIndexAsync({ published: 1 });
  await PackageServer.Versions.createIndexAsync({ lastUpdated: 1 });
  await PackageServer.Versions.createIndexAsync({ 'publishedBy.username': 1 });
  await PackageServer.LatestPackages.createIndexAsync({ packageName: 1 });
  await PackageServer.LatestPackages.createIndexAsync({ 'dependencies.packageName': 1 });
  await PackageServer.LatestPackages.createIndexAsync({ published: 1 });
  await PackageServer.LatestPackages.createIndexAsync({ lastUpdated: 1 });
  await PackageServer.LatestPackages.createIndexAsync({ 'publishedBy.username': 1 });
};

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

const syncPackages = async () => {
  if (!busy) {
    busy = true;
    const connection = getServerConnection();
    const syncStateDoc = await PackageServer.SyncState.findOneAsync(SYNC_TOKEN_ID);
    let syncToken = syncStateDoc?.syncToken;

    while (true) {
      var error, insertedId, numberAffected;

      const result = await connection.callAsync('syncNewPackageData', syncToken);
      if (!isTokenNewer(syncToken, result.syncToken)) {
        busy = false;
        break;
      }

      syncToken = result.syncToken;

      loggingEnabled && console.log('Running packages sync for:', syncToken);

      if (await isSyncCompletedAsync() && result.resetData) {
        await PackageServer.Packages.removeAsync({});
        await PackageServer.Versions.removeAsync({});
        await PackageServer.Builds.removeAsync({});
        await PackageServer.ReleaseTracks.removeAsync({});
        await PackageServer.ReleaseVersions.removeAsync({});
        await PackageServer.LatestPackages.removeAsync({});
        await PackageServer.Stats.removeAsync({});
        await PackageServer.SyncState.removeAsync({});
      }

      let newPackages = 0;
      let updatedPackages = 0;

      const packageRecords = (result.collections && result.collections.packages) || [];
      const bypassPackagesC2 = shouldBypassCollection2(PackageServer.Packages);

      for (const packageRecord of packageRecords) {
        try {
          ({ numberAffected, insertedId } = await PackageServer.Packages.upsertAsync(packageRecord._id, { $set: packageRecord }, bypassPackagesC2));
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
      }

      let newVersions = 0;
      let updatedVersions = 0;

      const versions = (result.collections && result.collections.versions) || [];
      const bypassVersionsC2 = shouldBypassCollection2(PackageServer.Versions);

      for (let version of versions) {
        try {
          version = transformVersionDocument(version);
          ({ numberAffected, insertedId } = await PackageServer.Versions.upsertAsync(version._id, version, bypassVersionsC2));
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
      }

      let newBuilds = 0;
      let updatedBuilds = 0;

      const builds = (result.collections && result.collections.builds) || [];
      const bypassBuildsC2 = shouldBypassCollection2(PackageServer.Builds);

      if (syncOptions.builds) {
        for (const build of builds) {
          try {
            ({ numberAffected, insertedId } = await PackageServer.Builds.upsertAsync(build._id, build, bypassBuildsC2));
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
        }
      }

      let newReleaseTracks = 0;
      let updatedReleaseTracks = 0;

      const releaseTracks = (result.collections && result.collections.releaseTracks) || [];
      const bypassReleaseTracksC2 = shouldBypassCollection2(PackageServer.ReleaseTracks);

      if (syncOptions.releases) {
        for (const releaseTrack of releaseTracks) {
          try {
            ({ numberAffected, insertedId } = await PackageServer.ReleaseTracks.upsertAsync(releaseTrack._id, releaseTrack, bypassReleaseTracksC2));
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
        }
      }

      let newReleaseVersions = 0;
      let updatedReleaseVersions = 0;

      const releaseVersions = (result.collections && result.collections.releaseVersions) || [];
      const bypassReleaseVersionsC2 = shouldBypassCollection2(PackageServer.ReleaseVersions);

      if (syncOptions.releases) {
        for (const releaseVersion of releaseVersions) {
          try {
            ({ numberAffected, insertedId } = await PackageServer.ReleaseVersions.upsertAsync(releaseVersion._id, releaseVersion, bypassReleaseVersionsC2));
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
        }
      }

      if (loggingEnabled) {
        if (newPackages || updatedPackages) {
          const packagesCount = await PackageServer.Packages.find().countAsync();
          console.log(
            `PackageServer.Packages - all: ${packagesCount}, new: ${newPackages}, updated: ${updatedPackages}`
          );
        }
        if (newVersions || updatedVersions) {
          const versionsCount = await PackageServer.Versions.find().countAsync();
          console.log(
            `PackageServer.Versions - all: ${versionsCount}, new: ${newVersions}, updated: ${updatedVersions}`
          );
        }
        if (newBuilds || updatedBuilds) {
          const buildsCount = await PackageServer.Builds.find().countAsync();
          console.log(
            `PackageServer.Builds - all: ${buildsCount}, new: ${newBuilds}, updated: ${updatedBuilds}`
          );
        }
        if (newReleaseTracks || updatedReleaseTracks) {
          const releaseTracksCount = await PackageServer.ReleaseTracks.find().countAsync();
          console.log(
            `PackageServer.ReleaseTracks - all: ${releaseTracksCount}, new: ${newReleaseTracks}, updated: ${updatedReleaseTracks}`
          );
        }
        if (newReleaseVersions || updatedReleaseVersions) {
          const releaseVersionsCount = await PackageServer.ReleaseVersions.find().countAsync();
          console.log(
            `PackageServer.ReleaseVersions - all: ${releaseVersionsCount}, new: ${newReleaseVersions}, updated: ${updatedReleaseVersions}`
          );
        }
      }

      // We store the new token only after all data in the result has been processed. PackageServer assures
      // that if this run has been prematurely terminated, we restart again correctly next time.
      await PackageServer.SyncState.updateAsync(
        { _id: SYNC_TOKEN_ID },
        {
          $set: {
            syncToken: result.syncToken,
          },
        }
      );

      if (result.upToDate) {
        loggingEnabled && console.log('Finished Syncing Packages');
        if (!(await isSyncCompletedAsync())) {
          await setSyncCompletedAsync();
          await deriveLatestPackagesFromVersions();
          await syncStats();
        }
        break;
      }
    }

    setTimeout(() => { busy = false; }, 1000);
  }
};

let syncCompleted = false;
const isSyncCompletedAsync = async () => {
  return syncCompleted || !!(await PackageServer.SyncState.findOneAsync(FULL_SYNC_ID));
};

const setSyncCompletedAsync = async () => {
  syncCompleted = true;
  const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
  await PackageServer.SyncState.upsertAsync({ _id: FULL_SYNC_ID }, { complete: true }, bypassC2);
};

const syncStats = async () => {
  if (!syncOptions.stats) return;

  const syncStateDoc = await PackageServer.SyncState.findOneAsync({ _id: STATS_SYNC_ID });
  if (!syncStateDoc) return;

  const { current, latest } = syncStateDoc;

  if (current < latest) {
    // We update current using it's setDate method.
    // eslint complains for lack of explicit update so we disable it for the next line
    while (current <= latest) { // eslint-disable-line
      const dateString = `${current.getFullYear()}-${(current.getMonth() + 1).toString().padStart(2, 0)}-${current.getDate().toString().padStart(2, 0)}`;
      loggingEnabled && console.log('Syncing Stats For ', dateString);
      const statsUrl = `${URL}/stats/v1/${dateString}`;
      const response = await fetch(statsUrl);

      if (response.status === 200) {
        const text = await response.text();
        const content = text.trim();
        let stats = content.length ? content.split('\n') : [];

        // stats is an array of strings because someone at MDG forgot JSON exists.
        // Therefore we need to loop and parse each string
        if (stats.length) {
          const statsOperations = [];
          const packagesOperations = [];

          stats.forEach(statDoc => {
            let doc = JSON.parse(statDoc);
            const { name, totalAdds, directAdds } = doc;
            doc._id = Random.id();
            doc.date = current;
            statsOperations.push({ insertOne: { document: doc } });
            packagesOperations.push({
              updateOne: {
                filter: { name },
                update: { $inc: { totalAdds, directAdds } },
              },
            });
          });

          if (statsOperations.length) {
            await PackageServer.rawStats.bulkWrite(statsOperations, { ordered: true });
          }
          if (packagesOperations.length) {
            await PackageServer.rawPackages.bulkWrite(packagesOperations, { ordered: false });
          }
        }
      }

      // update the last date of packages stats that we have processed
      await PackageServer.SyncState.updateAsync(
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

const latestPackagesCompletedAsync = async () => {
  return packagesFound || !!(await PackageServer.SyncState.findOneAsync(LATEST_PACKAGES_ID));
};

const setLatestPackagesCompleted = async () => {
  const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
  await PackageServer.SyncState.upsertAsync({ _id: LATEST_PACKAGES_ID }, { complete: true }, bypassC2);
  runCallbacks();
};

const deriveLatestPackagesFromVersions = async () => {
  loggingEnabled && console.log('Deriving Latest Packages');
  const packageNames = await PackageServer.rawVersions.distinct('packageName');

  const operations = [];
  for (const packageName of packageNames) {
    const latestVersion = await determineLatestPackageVersionAsync(packageName);
    if (latestVersion) {
      operations.push({ insertOne: { document: latestVersion } });
    }
  }

  if (operations.length) {
    try {
      await PackageServer.rawLatestPackages.bulkWrite(operations, { ordered: false });
    } catch (error) {
      console.log(error);
    }
  }

  await setLatestPackagesCompleted();
  loggingEnabled && console.log('Deriving Latest Packages Done');
};

const determineLatestPackageVersionAsync = async (packageName) => {
  let newestPackage;
  const cursor = PackageServer.Versions.find({ packageName });
  await cursor.forEachAsync(document => {
    if (!newestPackage || PackageVersion.lessThan(newestPackage.version, document.version)) {
      newestPackage = document;
    }
  });
  return newestPackage;
};

const setLatestPackageFromVersionAsync = async (packageName) => {
  const existingDocument = await PackageServer.LatestPackages.findOneAsync({ packageName }, { sort: { published: -1 } });
  const newestPackage = await determineLatestPackageVersionAsync(packageName);
  const bypassC2 = shouldBypassCollection2(PackageServer.LatestPackages);

  if (!existingDocument) {
    loggingEnabled && console.log(`Latest Package for ${packageName} set to ${newestPackage?.version}`);
    if (newestPackage) {
      await PackageServer.LatestPackages.insertAsync(newestPackage, bypassC2);
    }
  } else if (newestPackage && existingDocument._id !== newestPackage._id) {
    loggingEnabled && console.log(`Latest Package for ${packageName} changed from ${existingDocument.version} to ${newestPackage.version}`);
    await PackageServer.LatestPackages.removeAsync({ packageName });
    await PackageServer.LatestPackages.insertAsync(newestPackage, bypassC2);
  }
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

  connection.subscribe('defaults', async () => {
    const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
    const defaultsDoc = await Defaults.findOneAsync();
    await PackageServer.SyncState.upsertAsync(
      { _id: SYNC_TOKEN_ID },
      {
        $setOnInsert: {
          syncToken: defaultsDoc?.syncToken,
        },
      },
      bypassC2
    );

    connection.subscribe('changes', () => {
      return Changes.find({}).observe({
        added: async (document) => {
          await syncPackages();
        },
        changed: async (document, oldDocument) => {
          await syncPackages();
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
      added: async (document) => {
        const { earliest, latest } = document;
        const bypassC2 = shouldBypassCollection2(PackageServer.SyncState);
        await PackageServer.SyncState.upsertAsync(
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
        if (await isSyncCompletedAsync()) {
          await syncStats();
        }
      },

      changed: async (document) => {
        const { latest } = document;
        await PackageServer.SyncState.updateAsync(
          { _id: STATS_SYNC_ID },
          { $set: { latest: new Date(latest.replace('-', '/')) } }
        );
        await syncStats();
      },
    });
  });
};

// Set up observer for Versions collection to keep LatestPackages in sync
// This replaces the matb33:collection-hooks dependency
const setupVersionsObserver = () => {
  PackageServer.Versions.find().observe({
    added: async (doc) => {
      await setLatestPackageFromVersionAsync(doc.packageName);
    },
    changed: async (newDoc, oldDoc) => {
      const { _id, ...fields } = newDoc;
      const modifier = fieldsToModifier(fields);
      if (Object.keys(modifier).length > 0) {
        await PackageServer.LatestPackages.updateAsync(newDoc._id, modifier);
      }
    },
    removed: async (doc) => {
      const { _id } = doc;
      const oldPackage = await PackageServer.LatestPackages.findOneAsync(_id);

      if (oldPackage) {
        await PackageServer.LatestPackages.removeAsync(_id);
        const newPackage = await determineLatestPackageVersionAsync(oldPackage.packageName);

        if (newPackage) {
          const bypassC2 = shouldBypassCollection2(PackageServer.LatestPackages);
          await PackageServer.LatestPackages.insertAsync(newPackage, bypassC2);
        }
      }
    },
  });
};

PackageServer.runIfSyncFinished = (callback) => {
  typeof callback === 'function' && callbacks.push(callback);
};

PackageServer.startSyncing = function ({ logging = false, sync: { builds = true, releases = true, stats = true } = {} } = {}) {
  loggingEnabled = logging;
  syncOptions = { builds, releases, stats };

  Meteor.startup(async () => {
    // Initialize indexes
    await initIndexes();

    // Start subscriptions
    stats && subscribeToStats();
    subscribeToPackages();

    if (await latestPackagesCompletedAsync()) {
      runCallbacks();
    }
  });
};

// Register the observer setup to run after sync is finished
PackageServer.runIfSyncFinished(() => {
  setupVersionsObserver();
});

export { PackageServer, fieldsToModifier };
