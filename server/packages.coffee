Fiber = Npm.require 'fibers'

SyncToken = new Mongo.Collection 'meteor.SyncToken'
Packages = new Mongo.Collection 'meteor.Packages'
Versions = new Mongo.Collection 'meteor.Versions'
Builds = new Mongo.Collection 'meteor.Builds'
ReleaseTracks = new Mongo.Collection 'meteor.ReleaseTracks'
ReleaseVersions = new Mongo.Collection 'meteor.ReleaseVersions'

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
    syncToken = SyncToken.findOne().syncToken
    result = connection.call 'syncNewPackageData', syncToken
    
    SyncToken.update
      _id: 'syncToken'
    ,
      $set:
        syncToken: result.syncToken

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

Meteor.startup ->
  new Fiber ->

    connection = DDP.connect 'packages.meteor.com'

    Defaults = new Mongo.Collection 'defaults', connection
    Changes = new Mongo.Collection 'changes', connection

    connection.subscribe 'defaults', ->
      try
        SyncToken.insert
          _id: 'syncToken'
          syncToken: Defaults.findOne().syncToken
      catch error
        throw error unless /E11000 duplicate key error index:.*SyncToken\.\$_id/.test error.err

      connection.subscribe 'changes', ->
        Changes.find().observe
          added: (document) ->
            sync connection
          changed: (document, oldDocument) ->
            sync connection
  .run()

  new Fiber ->

    console.log "Started computing latest packages"

    # We reinitialize latest packages collection.
    LatestPackages.remove {}
    Versions.find({}).observeChanges
      added: (id, fields) ->
        insertLatestPackage _.extend {_id: id}, fields

      changed: (id, fields) ->
        # Will possibly not update anything, if the change is for an older package.
        LatestPackages.update id, fieldsToModifier fields

      removed: (id) ->
        oldPackage = LatestPackages.findOne id

        # Package already removed?
        return unless oldPackage

        # We remove it.
        LatestPackages.remove id

        # We find the new latest package.
        Versions.find(packageName: oldPackage.packageName).forEach (document, index, cursor) ->
          insertLatestPackage document

    console.log "Finished computing latest packages"

  .run()