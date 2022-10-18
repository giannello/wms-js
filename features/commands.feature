Feature: Commands

  Rule: The hardware should send commands to the devices

    Background:
      Given a connection to the USB stick

    Scenario: Wave device - valid serial
      When I ask the stick to wave device "ABCDEF"
      Then the stick responds without errors

    Scenario: Wave device - invalid serial
      When I ask the stick to wave device "ABCDE"
      Then the stick throws an error

    Scenario: Wave device - force stick timeout
      When I ask the stick to wave device "DEAD01"
      Then the stick responds negatively

    Scenario: Wave device - force network timeout
      When I ask the stick to wave device "DEAD02"
      Then the stick responds negatively
