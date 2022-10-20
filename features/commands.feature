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

    Scenario: Get device status - valid serial, fully retracted, not moving
      When I ask the stick for the status of device "ABCDEF"
      Then the stick responds with position 0, inclination 0, isMoving false from device "ABCDEF"

    Scenario: Get device status - valid serial, fully extended, moving
      When I ask the stick for the status of device "FEDCBA"
      Then the stick responds with position 100, inclination 0, isMoving true from device "FEDCBA"

    Scenario: Get device status - invalid serial
      When I ask the stick for the status of device "ABCDE"
      Then the stick throws an error

    Scenario: Get device status - force stick timeout
      When I ask the stick for the status of device "DEAD01"
      Then the stick responds negatively

    Scenario: Get device status - force network timeout
      When I ask the stick for the status of device "DEAD02"
      Then the stick responds negatively
