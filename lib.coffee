class MeteorPackages
  @Packages = new Mongo.Collection 'MeteorPackages.Packages'
  @Versions = new Mongo.Collection 'MeteorPackages.Versions'
  @Builds = new Mongo.Collection 'MeteorPackages.Builds'
  @ReleaseTracks = new Mongo.Collection 'MeteorPackages.ReleaseTracks'
  @ReleaseVersions = new Mongo.Collection 'MeteorPackages.ReleaseVersions'

  @LatestPackages = new Mongo.Collection 'MeteorPackages.LatestPackages'

  @SyncState = new Mongo.Collection 'MeteorPackages.SyncState'
