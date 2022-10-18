Feature: Network configuration

  Rule: The hardware should accept commands to change the network configuration

    Background:
      Given a connection to the USB stick

    Scenario: Valid channel and PAN ID
      When I configure the channel 11 and the PAN ID "BEEF"
      Then the stick responds without errors

    Scenario: Invalid channel
      When I configure the channel 1 and the PAN ID "BEE"
      Then the stick throws an error

    Scenario: PAN ID too large
      When I configure the channel 12 and the PAN ID "BEEEF"
      Then the stick throws an error

    Scenario: Invalid PAN ID
      When I configure the channel 20 and the PAN ID "BEGA"
      Then the stick throws an error

    Scenario: Valid encryption key
      When I configure the encryption key "012345678ABCDEF012345678ABCDEF01"
      Then the stick responds without errors

    Scenario: Too short encryption key
      When I configure the encryption key "01234"
      Then the stick throws an error

    Scenario: Invalid encryption key
      When I configure the encryption key "012345678ABCDEFG12345678ABCDEF"
      Then the stick throws an error
