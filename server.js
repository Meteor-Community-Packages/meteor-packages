import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { DDP } from 'meteor/ddp';
import { Random } from 'meteor/random';
import { PackageVersion } from 'meteor/package-version-parser';
import { HTTP } from 'meteor/http';

import Fiber from 'fibers';

import { PackageServer } from './package-server';

let loggingEnabled;
let syncOptions;

PackageServer.SYNC_TOKEN_ID = 'syncToken';
PackageServer.LAST_UPDATED_ID = 'lastUpdated';
PackageServer.STATS_SYNC_ID = 'statsSync';
PackageServer.FULL_SYNC_ID = 'fullSync';
PackageServer.URL = 'https://packages.meteor.com';

PackageServer.connection = null;

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

const statsRaw = PackageServer.Stats.rawCollection();
const packagesRaw = PackageServer.Packages.rawCollection();
const latestPackagesRaw = PackageServer.LatestPackages.rawCollection();
const versionsRaw = PackageServer.Versions.rawCollection();

// Version documents provided from Meteor API can contain dots in object keys which
// is not allowed by MongoDB, so we transform document to a version without them.
PackageServer.transformVersionDocument = function (document) {
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

PackageServer.syncPackages = function () {
  const connection = this.getServerConnection();

  while (true) {
    var error, insertedId, numberAffected;
    const { syncToken } = this.SyncState.findOne(this.SYNC_TOKEN_ID);

    loggingEnabled && console.log('Running packages sync for:', syncToken);

    const result = connection.call('syncNewPackageData', syncToken);

    if (result.resetData) {
      this.Packages.remove({});
      this.Versions.remove({});
      this.Builds.remove({});
      this.ReleaseTracks.remove({});
      this.ReleaseVersions.remove({});
      this.LatestPackages.remove({});
      this.Stats.remove({});
      this.SyncState.remove({ _id: this.STATS_SYNC_ID });
      this.SyncState.update(
        { _id: this.LAST_UPDATED_ID },
        {
          $set: {
            lastUpdated: null,
          },
        }
      );
    }

    let newPackages = 0;
    let updatedPackages = 0;

    const packageRecords = (result.collections && result.collections.packages) || [];

    packageRecords.forEach(packageRecord => {
      try {
        ({ numberAffected, insertedId } = this.Packages.upsert(packageRecord._id, { $set: packageRecord }));
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

    versions.forEach(version => {
      try {
        version = this.transformVersionDocument(version);
        ({ numberAffected, insertedId } = this.Versions.upsert(version._id, version));
        if (insertedId) {
          assert.strictEqual(insertedId, version._id);
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

    syncOptions.builds && builds.forEach(build => {
      try {
        ({ numberAffected, insertedId } = this.Builds.upsert(build._id, build));
        if (insertedId) {
          assert.strictEqual(insertedId, build._id);
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

    syncOptions.releases && releaseTracks.forEach(releaseTrack => {
      try {
        ({ numberAffected, insertedId } = this.ReleaseTracks.upsert(releaseTrack._id, releaseTrack));
        if (insertedId) {
          assert.strictEqual(insertedId, releaseTrack._id);
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

    syncOptions.releases && releaseVersions.forEach(releaseVersion => {
      try {
        ({ numberAffected, insertedId } = this.ReleaseVersions.upsert(releaseVersion._id, releaseVersion));
        if (insertedId) {
          assert.strictEqual(insertedId, releaseVersion._id);
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
          `PackageServer.Packages - all: ${this.Packages.find().count()}, new: ${newPackages}, updated: ${updatedPackages}`
        );
      }
      if (newVersions || updatedVersions) {
        console.log(
          `PackageServer.Versions - all: ${this.Versions.find().count()}, new: ${newVersions}, updated: ${updatedVersions}`
        );
      }
      if (newBuilds || updatedBuilds) {
        console.log(
          `PackageServer.Builds - all: ${this.Builds.find().count()}, new: ${newBuilds}, updated: ${updatedBuilds}`
        );
      }
      if (newReleaseTracks || updatedReleaseTracks) {
        console.log(
          `PackageServer.ReleaseTracks - all: ${this.ReleaseTracks.find().count()}, new: ${newReleaseTracks}, updated: ${updatedReleaseTracks}`
        );
      }
      if (newReleaseVersions || updatedReleaseVersions) {
        console.log(
          `PackageServer.ReleaseVersions - all: ${this.ReleaseVersions.find().count()}, new: ${newReleaseVersions}, updated: ${updatedReleaseVersions}`
        );
      }
    }

    // We store the new token only after all data in the result has been processed. This assures
    // that if this run has been prematurely terminated, we restart again correctly next time.
    this.SyncState.update(
      { _id: this.SYNC_TOKEN_ID },
      {
        $set: {
          syncToken: result.syncToken,
        },
      }
    );

    if (result.upToDate) {
      if (!this.isSyncCompleted()) {
        this.setSyncCompleted();
        this.deriveLatestPackagesFromVersions();
        this.syncStats();
      }
      return;
    }
  }
};

let syncCompleted = false;
PackageServer.isSyncCompleted = function () {
  return syncCompleted || this.SyncState.findOne(this.FULL_SYNC_ID);
};

PackageServer.setSyncCompleted = function () {
  this.SyncState.upsert({ _id: this.FULL_SYNC_ID }, { complete: true });
};

PackageServer.syncStats = async function () {
  const defaultDate = new Date();
  const { current = defaultDate, latest = defaultDate } = this.SyncState.findOne({ _id: this.STATS_SYNC_ID }) || {};

  if (current < latest) {
    // We update current using it's setDate method.
    // eslint complains for lack of explicit update so we disable it for the next line
    while (current <= latest) { // eslint-disable-line
      loggingEnabled && console.log('Syncing Stats For ', current.toLocaleString());
      let statsBatch = PackageServer.rawStats.initializeOrderedBulkOp();
      let packagesBatch = PackageServer.rawPackages.initializeOrderedBulkOp();
      try {
        const dateString = `${current.getFullYear()}-${(current.getMonth() + 1).toString().padStart(2, 0)}-${current.getDate().toString().padStart(2, 0)}`;
        const statsUrl = `${this.URL}/stats/v1/${dateString}`;
        const response = HTTP.get(statsUrl);
        const content = response.content.trim();
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
      } catch (error) {
        if (!(error.response && error.response.statusCode === 404)) {
          console.log(Object.keys(error));
        }
        /*
            We just ignore the error if it's a 404 from the package server. Must be due to not having stats for a certain day?
          */
      }

      // update the last date of packages stats that we have processed
      this.SyncState.update(
        { _id: this.STATS_SYNC_ID },
        { $set: { current } },
      );

      // update the current date to the next day so we eventually break out
      current.setDate(current.getDate() + 1);
    }
  }
};

PackageServer.fieldsToModifier = function (fields) {
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

PackageServer.deriveLatestPackagesFromVersions = async function () {
  const packageNames = await versionsRaw.distinct('packageName');
  const bulk = latestPackagesRaw.initializeUnorderedBulkOp();

  packageNames.forEach((packageName, index) => {
    const latestVersion = this.determineLatestPackageVersion(packageName);
    bulk.insert(latestVersion);
  });

  await bulk.execute();

  this.SyncState.update(
    { _id: this.LAST_UPDATED_ID },
    {
      $set: {
        lastUpdated: new Date().valueOf(),
      },
    }
  );
};

PackageServer.determineLatestPackageVersion = function (packageName) {
  let newestPackage;
  this.Versions.find({ packageName }).forEach(document => {
    if (!newestPackage || PackageVersion.lessThan(newestPackage.version, document.version)) {
      newestPackage = document;
    }
  });
  return newestPackage;
};

PackageServer.replaceLatestPackageIfNewer = function (document) {
  loggingEnabled && console.log('replacing:', document.packageName);
  const { packageName } = document;
  const existingDocument = this.LatestPackages.findOne({ packageName });

  if (existingDocument && PackageVersion.lessThan(existingDocument.version, document.version)) {
    this.LatestPackages.remove(existingDocument);
  }
  this.LatestPackages.insert(document);
};

PackageServer.latestPackagesObserve = function () {
  loggingEnabled && console.log('Starting latest packages observe');

  // We try to create the initial document.
  this.SyncState.upsert(
    {
      _id: this.LAST_UPDATED_ID,
    },
    {
      $setOnInsert: {
        lastUpdated: null,
      },
    }
  );

  let newestLastUpdated = null;

  // Update sync state after 30 seconds of no updates. This assures that if there was a series of observe
  // callbacks called, we really processed them all. Otherwise we might set state but program might
  // terminate before we had a chance to process all observe callbacks. Which will mean that those
  // packages from pending observe callbacks will not be processed the next time the program runs.
  const updateSyncState = newLastUpdated => {
    // We allow that in a series of observe callbacks the order of last updated timestamps is
    // not monotonic. In the case that last updated timestamps are not monotonic between
    // series of observe callbacks, we will have to (and do) restart the observe.
    if (!newestLastUpdated || newestLastUpdated < newLastUpdated) {
      newestLastUpdated = newLastUpdated;
    }

    const lastUpdated = newestLastUpdated;
    newestLastUpdated = null;

      this.SyncState.update(
        { _id: this.LAST_UPDATED_ID },
        {
          $set: {
            lastUpdated,
        },
      }
    );
  };

  let observeHandle = null;
  let { lastUpdated: currentLastUpdated } = this.SyncState.findOne(this.LAST_UPDATED_ID);

  const startObserve = () => {
    if (this.isSyncCompleted()) {
      let query = {};
      if (observeHandle != null) {
        observeHandle.stop();
    }
    observeHandle = null;

    if (currentLastUpdated) {
      query.lasUpdated = {
        $gte: new Date(currentLastUpdated),
        };
      }

      observeHandle = this.Versions.find(query).observeChanges({
        added: (id, fields) => {
          this.replaceLatestPackageIfNewer({ _id: id, ...fields });
          updateSyncState(fields.lastUpdated.valueOf());
        },

      changed: (id, fields) => {
        // Will possibly not update anything, if the change is for an older package.
        this.LatestPackages.update(id, this.fieldsToModifier(fields));

        if ('lastUpdated' in fields) {
          updateSyncState(fields.lastUpdated.valueOf());
        }
      },

        removed: id => {
          const oldPackage = this.LatestPackages.findOne(id);

          if (oldPackage) {
            this.LatestPackages.remove(id);
            const newPackage = this.determineLatestPackageVersion(oldPackage.packageName);

            if (newPackage) {
              this.latestPackages.insert(newPackage);
            }
          }
        },
      });
    }
  };

  const lastUpdatedNewer = () => {
    // We do not do anything, versions observe will handle that.
    // But we have to start the observe the first time if it is not yet running.
    if (!observeHandle) {
      startObserve();
    }
  };

  const lastUpdatedOlder = () => {
    // We have to restart the versions observe.
    startObserve();
  };

  const updateLastUpdated = newLastUpdated => {
    if (!currentLastUpdated) {
      currentLastUpdated = newLastUpdated;
      if (currentLastUpdated) {
        lastUpdatedNewer();
      } else {
        // Not currentLastUpdated nor newLastUpdated were true, we have not
        // yet started the observe at all. Let's start it now.
        startObserve();
      }
    } else if (!newLastUpdated) {
      currentLastUpdated = null;
      if (currentLastUpdated) {
        lastUpdatedOlder();
      }
    } else if (currentLastUpdated > newLastUpdated) {
      currentLastUpdated = newLastUpdated;
      lastUpdatedOlder();
    } else if (currentLastUpdated < newLastUpdated) {
      currentLastUpdated = newLastUpdated;
      lastUpdatedNewer();
    }
  };

  this.SyncState.find(this.LAST_UPDATED_ID).observe({
    added: document => {
      updateLastUpdated((document.lastUpdated && document.lastUpdated.valueOf()) || null);
    },

    changed: (document, oldDocument) => {
      updateLastUpdated((document.lastUpdated && document.lastUpdated.valueOf()) || null);
    },

    removed: oldDocument => {
      updateLastUpdated(null);
    },
  });

  loggingEnabled && console.log('Latest packages observe initialized');
};

PackageServer.getServerConnection = function () {
  if (!PackageServer.connection) {
    PackageServer.connection = DDP.connect(this.URL);
  }
  return PackageServer.connection;
};

PackageServer.subscribeToPackages = function () {
  loggingEnabled && console.log('Starting all packages subscription');

  const connection = this.getServerConnection();

  const Defaults = new Mongo.Collection('defaults', connection);
  const Changes = new Mongo.Collection('changes', connection);

  connection.subscribe('defaults', () => {
    this.SyncState.upsert(
      { _id: this.SYNC_TOKEN_ID },
      {
        $setOnInsert: {
          syncToken: Defaults.findOne().syncToken,
        },
      }
    );

    connection.subscribe('changes', () => {
      return Changes.find({}).observe({
        added: document => {
          return this.syncPackages();
        },
        changed: (document, oldDocument) => {
          return this.syncPackages();
        },
      });
    });

    loggingEnabled && console.log('All packages subscription initialized');
  });
};

PackageServer.subscribeToStats = function () {
  loggingEnabled && console.log('Starting Stats Subscription');

  const connection = this.getServerConnection();
  const Stats = new Mongo.Collection('stats', connection);

  connection.subscribe('stats', () => {
    Stats.find({}).observe({
      added: document => {
        const { earliest, latest } = document;
        this.SyncState.upsert(
          { _id: this.STATS_SYNC_ID },
          {
            $set: {
              latest: new Date(latest.replace('-', '/')),
            },
            $setOnInsert: {
              current: new Date(earliest.replace('-', '/')),
            },
          },
        );
        if (this.isSyncCompleted()) {
          this.syncStats();
        }
      },

      changed: document => {
        const { latest } = document;
        this.SyncState.update(
          { _id: this.STATS_SYNC_ID },
          { $set: { latest: new Date(latest.replace('-', '/')) } }
        );
        this.syncStats();
      },
    });
  });
};

PackageServer.startSyncing = function ({ logging = false, sync: { builds = true, releases = true, stats = true } = {} } = {}) {
  loggingEnabled = logging;
  syncOptions = { builds, releases };

  new Fiber(async () => {
    this.subscribeToPackages();
    this.latestPackagesObserve();
    stats && await this.subscribeToStats();
  }).run();
};

export { PackageServer };
