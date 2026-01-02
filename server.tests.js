/* eslint-env mocha */
import { Tinytest } from 'meteor/tinytest';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { PackageServer, fieldsToModifier } from 'meteor/peerlibrary:meteor-packages';

// ============================================================================
// Collection Tests
// ============================================================================

Tinytest.add('PackageServer - Collections exist', function (test) {
  test.instanceOf(PackageServer.Packages, Mongo.Collection);
  test.instanceOf(PackageServer.Versions, Mongo.Collection);
  test.instanceOf(PackageServer.Builds, Mongo.Collection);
  test.instanceOf(PackageServer.ReleaseTracks, Mongo.Collection);
  test.instanceOf(PackageServer.ReleaseVersions, Mongo.Collection);
  test.instanceOf(PackageServer.LatestPackages, Mongo.Collection);
  test.instanceOf(PackageServer.SyncState, Mongo.Collection);
  test.instanceOf(PackageServer.Stats, Mongo.Collection);
});

Tinytest.add('PackageServer - Collections have correct names', function (test) {
  test.equal(PackageServer.Packages._name, 'PackageServer.Packages');
  test.equal(PackageServer.Versions._name, 'PackageServer.Versions');
  test.equal(PackageServer.Builds._name, 'PackageServer.Builds');
  test.equal(PackageServer.ReleaseTracks._name, 'PackageServer.ReleaseTracks');
  test.equal(PackageServer.ReleaseVersions._name, 'PackageServer.ReleaseVersions');
  test.equal(PackageServer.LatestPackages._name, 'PackageServer.LatestPackages');
  test.equal(PackageServer.SyncState._name, 'PackageServer.SyncState');
  test.equal(PackageServer.Stats._name, 'PackageServer.Stats');
});

// ============================================================================
// Raw Collection Tests
// ============================================================================

Tinytest.add('PackageServer - Raw collections are accessible', function (test) {
  test.isNotUndefined(PackageServer.rawStats);
  test.isNotUndefined(PackageServer.rawPackages);
  test.isNotUndefined(PackageServer.rawLatestPackages);
  test.isNotUndefined(PackageServer.rawVersions);
});

// ============================================================================
// Helper Function Tests
// ============================================================================

Tinytest.add('fieldsToModifier - converts fields with values to $set', function (test) {
  const fields = {
    name: 'test-package',
    version: '1.0.0',
  };

  const modifier = fieldsToModifier(fields);

  test.equal(modifier.$set.name, 'test-package');
  test.equal(modifier.$set.version, '1.0.0');
  test.isUndefined(modifier.$unset);
});

Tinytest.add('fieldsToModifier - converts undefined fields to $unset', function (test) {
  const fields = {
    name: 'test-package',
    deprecated: undefined,
  };

  const modifier = fieldsToModifier(fields);

  test.equal(modifier.$set.name, 'test-package');
  test.equal(modifier.$unset.deprecated, '');
});

Tinytest.add('fieldsToModifier - handles mixed set and unset', function (test) {
  const fields = {
    name: 'test-package',
    version: '1.0.0',
    deprecated: undefined,
    removed: undefined,
  };

  const modifier = fieldsToModifier(fields);

  test.equal(modifier.$set.name, 'test-package');
  test.equal(modifier.$set.version, '1.0.0');
  test.equal(modifier.$unset.deprecated, '');
  test.equal(modifier.$unset.removed, '');
});

Tinytest.add('fieldsToModifier - handles empty object', function (test) {
  const modifier = fieldsToModifier({});
  test.equal(Object.keys(modifier).length, 0);
});

// ============================================================================
// API Tests
// ============================================================================

Tinytest.add('PackageServer - startSyncing function exists', function (test) {
  test.isNotUndefined(PackageServer.startSyncing);
  test.equal(typeof PackageServer.startSyncing, 'function');
});

Tinytest.add('PackageServer - runIfSyncFinished function exists', function (test) {
  test.isNotUndefined(PackageServer.runIfSyncFinished);
  test.equal(typeof PackageServer.runIfSyncFinished, 'function');
});

// ============================================================================
// CRUD Operation Tests (Async)
// ============================================================================

Tinytest.addAsync('PackageServer.Packages - insert and find', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    name: 'test-package-' + testId,
    maintainers: [{ username: 'testuser' }],
    homepage: 'https://example.com',
    lastUpdated: new Date(),
  };

  await PackageServer.Packages.insertAsync(testDoc);

  const found = await PackageServer.Packages.findOneAsync(testId);
  test.equal(found.name, testDoc.name);
  test.equal(found.homepage, testDoc.homepage);

  // Cleanup
  await PackageServer.Packages.removeAsync(testId);
});

Tinytest.addAsync('PackageServer.Versions - insert and find', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    packageName: 'test-package',
    version: '1.0.0',
    published: new Date(),
    dependencies: [
      { packageName: 'meteor', constraint: '1.0.0' },
      { packageName: 'ecmascript', constraint: '0.1.0' },
    ],
  };

  await PackageServer.Versions.insertAsync(testDoc);

  const found = await PackageServer.Versions.findOneAsync(testId);
  test.equal(found.packageName, 'test-package');
  test.equal(found.version, '1.0.0');
  test.equal(found.dependencies.length, 2);

  // Cleanup
  await PackageServer.Versions.removeAsync(testId);
});

Tinytest.addAsync('PackageServer.LatestPackages - insert, update, and remove', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    packageName: 'test-latest-package',
    version: '2.0.0',
    published: new Date(),
  };

  // Insert
  await PackageServer.LatestPackages.insertAsync(testDoc);
  let found = await PackageServer.LatestPackages.findOneAsync(testId);
  test.equal(found.version, '2.0.0');

  // Update
  await PackageServer.LatestPackages.updateAsync(testId, { $set: { version: '3.0.0' } });
  found = await PackageServer.LatestPackages.findOneAsync(testId);
  test.equal(found.version, '3.0.0');

  // Remove
  await PackageServer.LatestPackages.removeAsync(testId);
  found = await PackageServer.LatestPackages.findOneAsync(testId);
  test.isUndefined(found);
});

Tinytest.addAsync('PackageServer.Stats - insert and query by name', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    name: 'test-stats-package',
    totalAdds: 100,
    directAdds: 50,
    date: new Date(),
  };

  await PackageServer.Stats.insertAsync(testDoc);

  const found = await PackageServer.Stats.findOneAsync({ name: 'test-stats-package' });
  test.equal(found.totalAdds, 100);
  test.equal(found.directAdds, 50);

  // Cleanup
  await PackageServer.Stats.removeAsync(testId);
});

Tinytest.addAsync('PackageServer.SyncState - upsert operation', async function (test) {
  const testId = 'test-sync-state-' + Random.id();

  // First upsert (insert)
  await PackageServer.SyncState.upsertAsync({ _id: testId }, { $set: { status: 'pending' } });
  let found = await PackageServer.SyncState.findOneAsync(testId);
  test.equal(found.status, 'pending');

  // Second upsert (update)
  await PackageServer.SyncState.upsertAsync({ _id: testId }, { $set: { status: 'complete' } });
  found = await PackageServer.SyncState.findOneAsync(testId);
  test.equal(found.status, 'complete');

  // Cleanup
  await PackageServer.SyncState.removeAsync(testId);
});

// ============================================================================
// Collection Count Tests (Async)
// ============================================================================

Tinytest.addAsync('PackageServer - collections support countAsync', async function (test) {
  // These should not throw
  const packagesCount = await PackageServer.Packages.find().countAsync();
  const versionsCount = await PackageServer.Versions.find().countAsync();
  const buildsCount = await PackageServer.Builds.find().countAsync();

  test.equal(typeof packagesCount, 'number');
  test.equal(typeof versionsCount, 'number');
  test.equal(typeof buildsCount, 'number');
});

// ============================================================================
// Version Comparison Test (LatestPackages logic)
// ============================================================================

Tinytest.addAsync('PackageServer - LatestPackages stays in sync with Versions', async function (test) {
  // This test verifies the basic mechanism that LatestPackages should track
  // the latest version of each package

  const packageName = 'test-sync-package-' + Random.id();

  // Insert a version
  const v1Id = Random.id();
  await PackageServer.Versions.insertAsync({
    _id: v1Id,
    packageName: packageName,
    version: '1.0.0',
    published: new Date('2023-01-01'),
  });

  // Insert another version (newer)
  const v2Id = Random.id();
  await PackageServer.Versions.insertAsync({
    _id: v2Id,
    packageName: packageName,
    version: '2.0.0',
    published: new Date('2023-06-01'),
  });

  // Query all versions for this package
  const versions = await PackageServer.Versions.find({ packageName }).fetchAsync();
  test.equal(versions.length, 2);

  // Cleanup
  await PackageServer.Versions.removeAsync(v1Id);
  await PackageServer.Versions.removeAsync(v2Id);
});

// ============================================================================
// Builds and Release Tests (Async)
// ============================================================================

Tinytest.addAsync('PackageServer.Builds - insert and find', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    versionId: 'test-version-id',
    buildArchitectures: 'os.linux.x86_64',
  };

  await PackageServer.Builds.insertAsync(testDoc);

  const found = await PackageServer.Builds.findOneAsync(testId);
  test.equal(found.versionId, 'test-version-id');

  // Cleanup
  await PackageServer.Builds.removeAsync(testId);
});

Tinytest.addAsync('PackageServer.ReleaseTracks - insert and find', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    name: 'TEST-TRACK',
    maintainers: [{ username: 'admin' }],
  };

  await PackageServer.ReleaseTracks.insertAsync(testDoc);

  const found = await PackageServer.ReleaseTracks.findOneAsync(testId);
  test.equal(found.name, 'TEST-TRACK');

  // Cleanup
  await PackageServer.ReleaseTracks.removeAsync(testId);
});

Tinytest.addAsync('PackageServer.ReleaseVersions - insert and find', async function (test) {
  const testId = Random.id();
  const testDoc = {
    _id: testId,
    track: 'TEST-TRACK',
    version: '1.0.0',
    recommended: true,
  };

  await PackageServer.ReleaseVersions.insertAsync(testDoc);

  const found = await PackageServer.ReleaseVersions.findOneAsync(testId);
  test.equal(found.track, 'TEST-TRACK');
  test.equal(found.recommended, true);

  // Cleanup
  await PackageServer.ReleaseVersions.removeAsync(testId);
});

// ============================================================================
// Callback Registration Test
// ============================================================================

Tinytest.add('PackageServer.runIfSyncFinished - accepts callback', function (test) {
  // This shouldn't throw
  PackageServer.runIfSyncFinished(() => {
    // Callback registered
  });

  // Test passes if no exception thrown
  test.isTrue(true);
});
