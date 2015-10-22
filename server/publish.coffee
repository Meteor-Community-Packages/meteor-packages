Meteor.publish 'packages', ->
  LatestPackages.find
    'dependencies.packageName': 'peerlibrary:blaze-components'
