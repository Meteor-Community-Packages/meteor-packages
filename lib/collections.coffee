@LatestPackages = new Mongo.Collection 'meteor.LatestPackages'

if Meteor.isServer
  LatestPackages._ensureIndex
    packageName: 1
