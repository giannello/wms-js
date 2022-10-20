import {Then, When} from "@cucumber/cucumber";
import assert from "assert";

When('I ask the stick to wave device {string}', async function (serial) {
    try {
        this['response'] = await this['wms'].wave(serial);
    } catch (e) {
        this['response'] = e;
    }
});

When('I ask the stick for the status of device {string}', async function (serial) {
    try {
        this['response'] = await this['wms'].getDeviceStatus(serial);
    } catch (e) {
        this['response'] = e;
    }
});

Then('the stick responds with position {float}, inclination {float}, isMoving {boolean} from device {string}', async function (position, inclination, isMoving, serial) {
    assert.strictEqual(this['response'].serial, serial);
    assert.strictEqual(this['response'].position, position);
    assert.strictEqual(this['response'].inclination, inclination);
    assert.strictEqual(this['response'].isMoving, isMoving);
});
