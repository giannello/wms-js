Feature: Hardware information

  Rule: The hardware should respond to requests for basic information

    Background:
      Given a connection to the USB stick

    Scenario: ask for the stick name
      When I ask for the stick name
      Then the stick responds with "Mock WMS USB-Stick"
