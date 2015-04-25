SyncToken = new Mongo.Collection 'SyncToken'
Packages = new Mongo.Collection 'Packages'
Builds = new Mongo.Collection 'Builds'
ReleaseTracks = new Mongo.Collection 'ReleaseTracks'
ReleaseVersions = new Mongo.Collection 'ReleaseVersions'

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

    for packageRecord in result.collections?.packages or []
      try
        Packages.upsert packageRecord._id, packageRecord
      catch error
        console.log error, packageRecord
    for version in result.collections?.versions or []
      try
        Versions.upsert version._id, version
      catch error
        console.log error, version
    for build in result.collections?.builds or []
      try
        Builds.upsert build._id, build
      catch error
        console.log error, build
    for releaseTrack in result.collections?.releaseTracks or []
      try
        ReleaseTracks.upsert releaseTrack._id, releaseTrack
      catch error
        console.log error, releaseTrack
    for releaseVersion in result.collections?.releaseVersions or []
      try
        ReleaseVersions.upsert releaseVersion._id, releaseVersion
      catch error
        console.log error, releaseVersion

    console.log "Packages", Packages.find().count(), "Versions", Versions.find().count(), "Builds", Builds.find().count(), "ReleaseTracks", ReleaseTracks.find().count(), "ReleaseVersions", ReleaseVersions.find().count()

    return if result.upToDate

Meteor.startup ->
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
