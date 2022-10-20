import {Then, When} from "@cucumber/cucumber";
import {once} from "node:events";
import * as assert from "assert";

When('the device {string} sends a network parameters change request for channel {string} and panId {string}', async function (serial, channel, panId) {
    this['wmsMock'].mockNetworkParametersChangeBroadcast(serial, channel, panId);
});

Then('the stick receives a request to change the network parameters to channel {float} and panId {string} from device {string}', async function (channel, panId, serial) {
    [this['response']] = await once(this['wms'].frameHandler, '5060');
    assert.strictEqual(this['response'].serial, serial);
    assert.strictEqual(this['response'].channel, channel);
    assert.strictEqual(this['response'].panId, panId);
});

When('the device {string} sends a scan request for panId {string}', async function (serial,  panId) {
    this['wmsMock'].mockReceivedScanRequest(serial, panId);
});

Then('the stick receives a scan request for panId {string} from device {string}', async function (panId, serial) {
    [this['response']] = await once(this['wms'].frameHandler, '7020');
    assert.strictEqual(this['response'].serial, serial);
    assert.strictEqual(this['response'].panId, panId);
});

When('I ask the stick to respond to a scan for panId {string} from device {string}', async function (panId, serial) {
    try {
        this['response'] = await this['wms'].respondToScanRequest(serial, panId);
    } catch (e) {
        this['response'] = e;
    }
});

When('the device {string} sends a network join request for channel {string} and panId {string} with encryption key {string}', async function (serial,  channel, panId, encryptionKey) {
    this['wmsMock'].mockNetworkJoin(serial, channel, panId, encryptionKey);
});

Then('the stick receives a network join request for channel {float} and panId {string} with encryption key {string} from device {string}', async function (channel, panId, encryptionKey, serial) {
    [this['response']] = await once(this['wms'].frameHandler, '5018');
    assert.strictEqual(this['response'].serial, serial);
    assert.strictEqual(this['response'].channel, channel);
    assert.strictEqual(this['response'].panId, panId);
    assert.strictEqual(this['response'].encryptionKey, encryptionKey);
});

When('the device {string} sends a wave request', async function (serial) {
    this['wmsMock'].mockReceivedWaveRequest(serial);
});

Then('the stick receives a wave request from device {string}', async function (serial) {
    [this['response']] = await once(this['wms'].frameHandler, '7050');
    assert.strictEqual(this['response'].serial, serial);
});
