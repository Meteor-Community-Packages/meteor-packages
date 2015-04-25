Meteor.startup ->
  Meteor.subscribe 'packages'

class ComponentsList extends BlazeComponent
  @register 'ComponentsList'

  template: ->
    'ComponentsList'

  components: ->
    Versions.find()

class Component extends BlazeComponent
  @register 'Component'

  template: ->
    'Component'
