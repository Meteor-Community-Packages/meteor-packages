Meteor.publish 'packages', ->
  Versions.find
    'dependencies.peerlibrary:blaze-components':
      $exists: true
