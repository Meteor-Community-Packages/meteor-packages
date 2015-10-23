Fiber = Npm.require 'fibers'

SYNC_TOKEN_ID = 'syncToken'
LAST_UPDATED_ID = 'lastUpdated'

SyncState = new Mongo.Collection 'meteor.SyncState'

Packages = new Mongo.Collection 'meteor.Packages'
Versions = new Mongo.Collection 'meteor.Versions'
Builds = new Mongo.Collection 'meteor.Builds'
ReleaseTracks = new Mongo.Collection 'meteor.ReleaseTracks'
ReleaseVersions = new Mongo.Collection 'meteor.ReleaseVersions'

Versions._ensureIndex
  packageName: 1

# Version documents provided from Meteor API can contain dots in object keys which
# is not allowed by MongoDB, so we transform document to a version without them.
transformVersionDocument = (document) ->
  if document.dependencies
    document.dependencies = for packageName, dependency of document.dependencies
      _.extend dependency,
        packageName: packageName

  document

sync = (connection) ->
  loop
    syncToken = SyncState.findOne(SYNC_TOKEN_ID).syncToken
    result = connection.call 'syncNewPackageData', syncToken

    if result.resetData
      Packages.remove {}
      Versions.remove {}
      Builds.remove {}
      ReleaseTracks.remove {}
      ReleaseVersions.remove {}

    newPackages = 0
    updatedPackages = 0
    for packageRecord in result.collections?.packages or []
      try
        {numberAffected, insertedId} = Packages.upsert packageRecord._id, packageRecord
        if insertedId
          newPackages++
          updatedPackages += numberAffected - 1
        else
          updatedPackages += numberAffected
      catch error
        console.log error, packageRecord

    newVersions = 0
    updatedVersions = 0
    for version in result.collections?.versions or []
      try
        version = transformVersionDocument version
        {numberAffected, insertedId} = Versions.upsert version._id, version
        if insertedId
          newVersions++
          updatedVersions += numberAffected - 1
        else
          updatedVersions += numberAffected
      catch error
        console.log error, version

    newBuilds = 0
    updatedBuilds = 0
    for build in result.collections?.builds or []
      try
        {numberAffected, insertedId} = Builds.upsert build._id, build
        if insertedId
          newBuilds++
          updatedBuilds += numberAffected - 1
        else
          updatedBuilds += numberAffected
      catch error
        console.log error, build

    newReleaseTracks = 0
    updatedReleaseTracks = 0
    for releaseTrack in result.collections?.releaseTracks or []
      try
        {numberAffected, insertedId} = ReleaseTracks.upsert releaseTrack._id, releaseTrack
        if insertedId
          newReleaseTracks++
          updatedReleaseTracks += numberAffected - 1
        else
          updatedReleaseTracks += numberAffected
      catch error
        console.log error, releaseTrack

    newReleaseVersions = 0
    updatedReleaseVersions = 0
    for releaseVersion in result.collections?.releaseVersions or []
      try
        {numberAffected, insertedId} = ReleaseVersions.upsert releaseVersion._id, releaseVersion
        if insertedId
          newReleaseVersions++
          updatedReleaseVersions += numberAffected - 1
        else
          updatedReleaseVersions += numberAffected
      catch error
        console.log error, releaseVersion

    console.log "Packages - all: #{Packages.find().count()}, new: #{newPackages}, updated: #{updatedPackages}" if newPackages or updatedPackages
    console.log "Versions - all: #{Versions.find().count()}, new: #{newVersions}, updated: #{updatedVersions}" if newVersions or updatedVersions
    console.log "Builds - all: #{Builds.find().count()}, new: #{newBuilds}, updated: #{updatedBuilds}" if newBuilds or updatedBuilds
    console.log "ReleaseTracks - all: #{ReleaseTracks.find().count()}, new: #{newReleaseTracks}, updated: #{updatedReleaseTracks}" if newReleaseTracks or updatedReleaseTracks
    console.log "ReleaseVersions - all: #{ReleaseVersions.find().count()}, new: #{newReleaseVersions}, updated: #{updatedReleaseVersions}" if newReleaseVersions or updatedReleaseVersions

    # We store the new token only after all data in the result has been processed. This assures
    # that if this run has been prematurely terminated, we restart again correctly next time.
    SyncState.update
      _id: SYNC_TOKEN_ID
    ,
      $set:
        syncToken: result.syncToken

    return if result.upToDate

fieldsToModifier = (fields) ->
  modifier = {}

  for name, value of fields
    if _.isUndefined value
      modifier.$unset = {} unless modifier.$unset
      modifier.$unset[name] = ''
    else
      modifier.$set = {} unless modifier.$set
      modifier.$set[name] = value

  modifier

insertLatestPackage = (document) ->
  loop
    existingDocument = LatestPackages.findOne
      _id:
        $ne: document._id
      packageName: document.packageName

    if existingDocument
      if PackageVersion.lessThan existingDocument.version, document.version
        # We have an older version, remove it.
        LatestPackages.remove existingDocument._id
        continue
      else
        # We have a newer version, don't do anything.
        return
    else
      # We do not have any other version (anymore). Let's continue.
      break

  # TODO: Slight race condition here. There might be another document inserted between removal and this insertion.
  LatestPackages.insert document

latestPackagesObserve = ->
  console.log "Starting latest packages observe"

  try
    # We try to create the initial document.
    SyncState.insert
      _id: LAST_UPDATED_ID
      lastUpdated: null
  catch error
    throw error unless /E11000 duplicate key error index:.*SyncState\.\$_id/.test error.err

  timeoutHandle = null
  newestLastUpdated = null

  # Update sync state after 30 seconds of no updates. This assures that if there was a series of observe
  # callbacks called, we really processed them all. Otherwise we might set state but program might
  # terminate before we had a chance to process all observe callbacks. Which will mean that those
  # packages from pending observe callbacks will not be processed the next time the program runs.
  updateSyncState = (newLastUpdated) ->
    # We allow that in a series of observe callbacks the order of last updated timestamps is
    # not monotonic. In the case that last updated timestamps are not monotonic between
    # series of observe callbacks, we will have to (and do) restart the observe.
    if not newestLastUpdated or newestLastUpdated < newLastUpdated
      newestLastUpdated = newLastUpdated

    Meteor.clearTimeout timeoutHandle
    timeoutHandle = Meteor.setTimeout ->
      lastUpdated = newestLastUpdated
      newestLastUpdated = null

      SyncState.update
        _id: LAST_UPDATED_ID
      ,
        $set:
          lastUpdated: lastUpdated
    ,
      30 * 1000 # ms

  observeHandle = null
  currentLastUpdated = null

  startObserve = ->
    observeHandle?.stop()
    observeHandle = null


    if currentLastUpdated
      query =
        lastUpdated:
          $gte: currentLastUpdated
    else
      query = {}

    observeHandle = Versions.find(query).observeChanges
      added: (id, fields) ->
        insertLatestPackage _.extend {_id: id}, fields

        updateSyncState fields.lastUpdated.valueOf()

      changed: (id, fields) ->
        # Will possibly not update anything, if the change is for an older package.
        LatestPackages.update id, fieldsToModifier fields

        updateSyncState fields.lastUpdated.valueOf() if 'lastUpdated' of fields

      removed: (id) ->
        oldPackage = LatestPackages.findOne id

        # Package already removed?
        return unless oldPackage

        # We remove it.
        LatestPackages.remove id

        # We find the new latest package.
        Versions.find(packageName: oldPackage.packageName).forEach (document, index, cursor) ->
          insertLatestPackage document

  lastUpdatedNewer = ->
    # We do not do anything, versions observe will handle that.
    # But we have to start the observe the first time if it is not yet running.
    startObserve() unless observeHandle

  lastUpdatedOlder = ->
    # We have to restart the versions observe.
    startObserve()

  updateLastUpdated = (newLastUpdated) ->
    if not currentLastUpdated
      currentLastUpdated = newLastUpdated
      if currentLastUpdated
        lastUpdatedNewer()
      else
        # Not currentLastUpdated nor newLastUpdated were true, we have not
        # yet started the observe at all. Let's start it now.
        startObserve()
    else if not newLastUpdated
      currentLastUpdated = null
      lastUpdatedOlder() if currentLastUpdated
    else if currentLastUpdated > newLastUpdated
      currentLastUpdated = newLastUpdated
      lastUpdatedOlder()
    else if currentLastUpdated < newLastUpdated
      currentLastUpdated = newLastUpdated
      lastUpdatedNewer()

  SyncState.find(LAST_UPDATED_ID).observe
    added: (document) ->
      updateLastUpdated document.lastUpdated?.valueOf() or null

    changed: (document, oldDocument) ->
      updateLastUpdated document.lastUpdated?.valueOf() or null

    removed: (oldDocument) ->
      updateLastUpdated null

  console.log "Latest packages observe initialized"

subscribeToPackages = ->
  connection = DDP.connect 'packages.meteor.com'

  Defaults = new Mongo.Collection 'defaults', connection
  Changes = new Mongo.Collection 'changes', connection

  connection.subscribe 'defaults', ->
    try
      SyncState.insert
        _id: SYNC_TOKEN_ID
        syncToken: Defaults.findOne().syncToken
    catch error
      throw error unless /E11000 duplicate key error index:.*SyncState\.\$_id/.test error.err

    connection.subscribe 'changes', ->
      Changes.find().observe
        added: (document) ->
          sync connection
        changed: (document, oldDocument) ->
          sync connection

Meteor.startup ->
  new Fiber ->
    latestPackagesObserve()
    subscribeToPackages()
  .run()
