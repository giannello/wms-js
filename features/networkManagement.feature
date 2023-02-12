Feature: Network management

  Rule: The hardware should handle network management messages

    Background:
      Given a connection to the USB stick

    Scenario: Network parameters change request
      When the device "ABCDEF" sends a network parameters change request for channel 11 and panId "ABCD"
      Then the stick receives a request to change the network parameters to channel 11 and panId "ABCD" from device "ABCDEF"

    Scenario: Network parameters change request
      When the device "FEDCBA" sends a network parameters change request for channel 13 and panId "FFFF"
      Then the stick receives a request to change the network parameters to channel 13 and panId "FFFF" from device "FEDCBA"

    Scenario: Received wave request
      When the device "ABCDEF" sends a wave request
      Then the stick receives a wave request from device "ABCDEF"

    Scenario: Received wave request
      When the device "FEDCBA" sends a wave request
      Then the stick receives a wave request from device "FEDCBA"

    Scenario: Received scan request
      When the device "ABCDEF" sends a scan request for panId "ABCD"
      Then the stick receives a scan request for panId "ABCD" from device "ABCDEF"

    Scenario: Received scan request
      When the device "FEDCBA" sends a scan request for panId "BEEF"
      Then the stick receives a scan request for panId "BEEF" from device "FEDCBA"

    Scenario: Received scan response
      When the device "ABCDEF" of type 25 sends a scan response for panId "ABCD"
      Then the stick receives a scan response for panId "ABCD" from device "ABCDEF" of type 25

    Scenario: Send scan request
      When I ask the stick to scan the network for panId "ABCD"
      Then the stick sends a scan request for panId "ABCD"
       And the stick responds without errors

    Scenario: Send scan request - force stick timeout
      When I ask the stick to scan the network for panId "DED1"
      Then the stick sends a scan request for panId "DED1"
       And the stick responds negatively

    Scenario: Send scan response
      When I ask the stick to respond to a scan for panId "ABCD" from device "ABCDEF"
      Then the stick sends a scan response for panId "ABCD" from device "ABCDEF"
       And the stick responds without errors

    Scenario: Send scan response - force stick timeout
      When I ask the stick to respond to a scan for panId "ABCD" from device "DEAD01"
      Then the stick sends a scan response for panId "ABCD" from device "DEAD01"
       And the stick responds negatively

    Scenario: Send scan response - force network timeout
      When I ask the stick to respond to a scan for panId "ABCD" from device "DEAD02"
      Then the stick sends a scan response for panId "ABCD" from device "DEAD02"
       And the stick responds negatively

    Scenario: Network join request
      When the device "ABCDEF" sends a network join request for channel 12 and panId "BEEF" with encryption key "12345678123456781234567812345678"
      Then the stick receives a network join request for channel 12 and panId "BEEF" with encryption key "78563412785634127856341278563412" from device "ABCDEF"

    Scenario: Network join request
      When the device "FEDCBA" sends a network join request for channel 14 and panId "FEED" with encryption key "BEEFBEEF12341234DEADDEAD12341234"
      Then the stick receives a network join request for channel 14 and panId "FEED" with encryption key "34123412ADDEADDE34123412EFBEEFBE" from device "FEDCBA"
