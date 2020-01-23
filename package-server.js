import { Mongo } from 'meteor/mongo';

export class PackageServer {
  static Packages = new Mongo.Collection('PackageServer.Packages');
  static Versions = new Mongo.Collection('PackageServer.Versions');
  static Builds = new Mongo.Collection('PackageServer.Builds');
  static ReleaseTracks = new Mongo.Collection('PackageServer.ReleaseTracks');
  static ReleaseVersions = new Mongo.Collection('PackageServer.ReleaseVersions');
  static LatestPackages = new Mongo.Collection('PackageServer.LatestPackages');
  static SyncState = new Mongo.Collection('PackageServer.SyncState');
  static Stats = new Mongo.Collection('PackageServer.Stats');
}
