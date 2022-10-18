Feature: Hardware information

  Rule: The hardware should handle broadcast messages in the network

    Background:
      Given a connection to the USB stick
      And I ask for the stick name

    Scenario:
      When the weather station "ABCDEF" broadcasts wind speed as 10
      Then the stick emits a weather broadcast event from serial "ABCDEF", with wind speed 16 m/s
