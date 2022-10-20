Feature: Network management

  Rule: The hardware should handle network management messages

    Background:
      Given a connection to the USB stick
      And I ask for the stick name

    Scenario: Network parameters change request
      When the device "ABCDEF" sends a network parameters change request for channel "0B" and panId "ABCD"
      Then the stick receives a request to change the network parameters to channel 11 and panId "ABCD" from device "ABCDEF"

    Scenario: Network parameters change request
      When the device "FEDCBA" sends a network parameters change request for channel "0D" and panId "FFFF"
      Then the stick receives a request to change the network parameters to channel 13 and panId "FFFF" from device "FEDCBA"

    Scenario: Received scan request
      When the device "ABCDEF" sends a scan request for panId "ABCD"
      Then the stick receives a scan request for panId "ABCD" from device "ABCDEF"

    Scenario: Received scan request
      When the device "FEDCBA" sends a scan request for panId "BEEF"
      Then the stick receives a scan request for panId "BEEF" from device "FEDCBA"

    Scenario: Scan response
      When I ask the stick to respond to a scan for panId "ABCD" from device "ABCDEF"
      Then the stick responds without errors

    Scenario: Scan response - force stick timeout
      When I ask the stick to respond to a scan for panId "ABCD" from device "DEAD01"
      Then the stick responds negatively

    Scenario: Scan response - force network timeout
      When I ask the stick to respond to a scan for panId "ABCD" from device "DEAD02"
      Then the stick responds negatively
