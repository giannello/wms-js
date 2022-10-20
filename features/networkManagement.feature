Feature: Network management

  Rule: The hardware should handle network management messages

    Background:
      Given a connection to the USB stick

    Scenario: Network parameters change request
      When the device "ABCDEF" sends a network parameters change request for channel "0B" and panId "ABCD"
      Then the stick receives a request to change the network parameters to channel 11 and panId "ABCD" from device "ABCDEF"

    Scenario: Network parameters change request
      When the device "FEDCBA" sends a network parameters change request for channel "0D" and panId "FFFF"
      Then the stick receives a request to change the network parameters to channel 13 and panId "FFFF" from device "FEDCBA"
