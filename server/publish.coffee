Meteor.publish 'packages', ->
  Versions.find
    'dependencies.packageName': 'peerlibrary:blaze-components'
